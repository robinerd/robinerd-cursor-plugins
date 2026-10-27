import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  addSlice,
  canonicalizeWorkspacePath,
  emptyState,
  getState,
  loadState,
  parseJsonDocument,
  saveState,
  statePathFor,
  upsertInitiative,
  workspaceBucketHash,
  workspaceHash,
  workspaceIdentityKey,
} from "../lib/store.js";
import {
  expandHomePath,
  resolveBoardWorkspacePath,
  sanitizeWorkspacePath,
} from "../lib/workspace.js";

test("workspaceHash is stable truncated sha256", () => {
  const a = workspaceHash("D:\\proj\\one");
  const b = workspaceHash("D:\\proj\\one");
  const c = workspaceHash("D:\\proj\\two");
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.notEqual(a, c);
});

test("expandHomePath expands ~/ and collapses /~/", () => {
  const home = homedir();
  assert.equal(expandHomePath("~/Documents/GitHub/cactus"), join(home, "Documents/GitHub/cactus"));
  assert.equal(expandHomePath("~"), home);
  const corrupt = join(home, "~", "Documents", "GitHub", "cactus");
  assert.equal(expandHomePath(corrupt), join(home, "Documents", "GitHub", "cactus"));
  assert.ok(!expandHomePath(corrupt).includes("/~/"));
});

test("sanitizeWorkspacePath expands ~/ without /~/", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const sanitized = sanitizeWorkspacePath(
      "~/Documents/GitHub/cactus",
      join(homedir(), "fallback-unused"),
      dataRoot,
    );
    assert.equal(sanitized, join(homedir(), "Documents/GitHub/cactus"));
    assert.ok(!sanitized.includes("/~/"));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("canonicalizeWorkspacePath collapses literal tilde segment", () => {
  const home = homedir();
  const good = join(home, "Documents", "GitHub", "cactus");
  const bad = join(home, "~", "Documents", "GitHub", "cactus");
  assert.equal(canonicalizeWorkspacePath(bad), good);
  assert.equal(canonicalizeWorkspacePath(`~/Documents/GitHub/cactus`), good);
  assert.ok(!canonicalizeWorkspacePath(bad).includes("/~/"));
});

test("load missing file yields empty state", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/missing-fixture";
    const key = resolveBoardWorkspacePath(ws);
    const state = await loadState(ws, { dataRoot });
    assert.deepEqual(state.initiatives, []);
    assert.deepEqual(state.slices, []);
    assert.equal(state.workspacePath, key);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("save/load round-trip + upsertInitiative + addSlice", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/round-trip";
    const key = resolveBoardWorkspacePath(ws);
    const { initiative } = await upsertInitiative(
      ws,
      {
        planPath: "plans/demo.md",
        title: "Demo",
        blurb: "A short blurb",
        status: "planning",
      },
      { dataRoot },
    );
    assert.ok(initiative.id);
    assert.equal(initiative.status, "planning");

    const { slice } = await addSlice(
      ws,
      { initiativeId: initiative.id, title: "S1 Plugin skeleton" },
      { dataRoot },
    );
    assert.equal(slice.column, "ready");
    assert.deepEqual(slice.evidence, []);
    assert.deepEqual(slice.history, []);

    const path = statePathFor(ws, { dataRoot });
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    assert.equal(onDisk.initiatives.length, 1);
    assert.equal(onDisk.slices.length, 1);
    assert.equal(onDisk.workspacePath, key);

    const reloaded = await getState(ws, { dataRoot });
    assert.equal(reloaded.workspacePath, key);
    assert.equal(reloaded.initiatives[0].title, "Demo");
    assert.equal(reloaded.slices[0].title, "S1 Plugin skeleton");
    assert.equal(reloaded.slices[0].column, "ready");

    const again = await upsertInitiative(
      ws,
      {
        id: initiative.id,
        planPath: "plans/demo.md",
        title: "Demo updated",
        blurb: "Updated",
        status: "building",
      },
      { dataRoot },
    );
    assert.equal(again.state.initiatives.length, 1);
    assert.equal(again.initiative.status, "building");
    assert.equal(again.initiative.title, "Demo updated");
    assert.equal(again.initiative.awaitingHuman, false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("upsertInitiative persist and preserve awaitingHuman", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/awaiting-human";
    const createdFalse = await upsertInitiative(
      ws,
      {
        planPath: "plans/ah.md",
        title: "AH",
      },
      { dataRoot },
    );
    assert.equal(createdFalse.initiative.awaitingHuman, false);

    const createdTrue = await upsertInitiative(
      ws,
      {
        planPath: "plans/ah-true.md",
        title: "AH true",
        awaitingHuman: true,
      },
      { dataRoot },
    );
    assert.equal(createdTrue.initiative.awaitingHuman, true);

    const omitted = await upsertInitiative(
      ws,
      {
        id: createdTrue.initiative.id,
        planPath: "plans/ah-true.md",
        title: "AH true renamed",
      },
      { dataRoot },
    );
    assert.equal(omitted.initiative.awaitingHuman, true);
    assert.equal(omitted.initiative.title, "AH true renamed");

    const cleared = await upsertInitiative(
      ws,
      {
        id: createdTrue.initiative.id,
        planPath: "plans/ah-true.md",
        title: "AH true renamed",
        awaitingHuman: false,
      },
      { dataRoot },
    );
    assert.equal(cleared.initiative.awaitingHuman, false);

    const reloaded = await getState(ws, { dataRoot });
    const row = reloaded.initiatives.find((i) => i.id === createdTrue.initiative.id);
    assert.equal(row?.awaitingHuman, false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("emptyState shape", () => {
  const s = emptyState("/tmp/ws");
  assert.equal(s.workspacePath, resolveBoardWorkspacePath("/tmp/ws"));
  assert.deepEqual(s.initiatives, []);
  assert.deepEqual(s.slices, []);
  assert.ok(typeof s.updatedAt === "string");
});

test("saveState writes under dataRoot/hash/state.json", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/save-path-ws";
    const key = resolveBoardWorkspacePath(ws);
    const state = emptyState(ws);
    await saveState(state, { dataRoot });
    const expected = join(dataRoot, workspaceBucketHash(ws), "state.json");
    const raw = await readFile(expected, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.workspacePath, key);
    assert.equal(raw.trimEnd().endsWith("}"), true);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("parseJsonDocument keeps leading object when trailing junk remains", () => {
  const good = {
    workspacePath: "/tmp/ws",
    initiatives: [],
    slices: [],
    updatedAt: "2026-09-21T21:00:45.723Z",
  };
  const body = `${JSON.stringify(good, null, 2)}\n`;
  const junk = ` ]\n    }\n  ],\n  "updatedAt": "2026-09-21T21:00:45.722Z"\n}\n`;
  const parsed = parseJsonDocument(body + junk);
  assert.deepEqual(parsed, good);
  assert.throws(() => JSON.parse(body + junk), /non-whitespace|Unexpected/);
});

test("loadState recovers state.json with trailing junk from torn write", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/torn-write";
    const key = resolveBoardWorkspacePath(ws);
    const path = statePathFor(ws, { dataRoot });
    await mkdir(dirname(path), { recursive: true });
    const good = {
      workspacePath: key,
      initiatives: [
        {
          id: "i1",
          planPath: "plans/a.md",
          title: "Kept",
          blurb: "",
          status: "planning",
          updatedAt: "2026-09-21T21:00:45.723Z",
        },
      ],
      slices: [],
      updatedAt: "2026-09-21T21:00:45.723Z",
    };
    const torn =
      `${JSON.stringify(good, null, 2)}\n` +
      ` ]\n    }\n  ],\n  "updatedAt": "2026-09-21T21:00:45.722Z"\n}\n`;
    await writeFile(path, torn, "utf8");
    assert.throws(() => JSON.parse(torn), SyntaxError);

    const state = await loadState(ws, { dataRoot });
    assert.equal(state.workspacePath, key);
    assert.equal(state.initiatives.length, 1);
    assert.equal(state.initiatives[0].title, "Kept");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("concurrent saveState leaves a single parseable state.json", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/concurrent-save";
    const { initiative } = await upsertInitiative(
      ws,
      { planPath: "plans/c.md", title: "Base" },
      { dataRoot },
    );
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        upsertInitiative(
          ws,
          {
            id: initiative.id,
            planPath: "plans/c.md",
            title: `Concurrent ${i}`,
            blurb: `b${i}`,
          },
          { dataRoot },
        ),
      ),
    );
    const path = statePathFor(ws, { dataRoot });
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.initiatives.length, 1);
    assert.match(parsed.initiatives[0].title, /^Concurrent \d+$/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("readers never see a missing state.json during concurrent saves", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/workspace/save-vs-load";
    const { initiative } = await upsertInitiative(
      ws,
      { planPath: "plans/r.md", title: "Base" },
      { dataRoot },
    );
    let saving = true;
    const writers = Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        upsertInitiative(
          ws,
          { id: initiative.id, planPath: "plans/r.md", title: `W${i}` },
          { dataRoot },
        ),
      ),
    ).finally(() => {
      saving = false;
    });
    const path = statePathFor(ws, { dataRoot });
    let loads = 0;
    let rawReads = 0;
    const loaders = Array.from({ length: 4 }, async () => {
      while (saving) {
        const state = await loadState(ws, { dataRoot });
        assert.equal(state.initiatives.length, 1, "load saw an empty board");
        loads++;
      }
    });
    // Bypasses the in-process write queue, like the board UI server process.
    // Polling much faster than this starves Windows rename (open files can't be replaced).
    const rawReader = (async () => {
      while (saving) {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        assert.equal(parsed.initiatives.length, 1);
        rawReads++;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })();
    await Promise.all([writers, ...loaders, rawReader]);
    assert.ok(loads > 0 && rawReads > 0);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("load then save stay on one canonical bucket", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const home = homedir();
    const good = join(home, "Documents", "GitHub", "cactus-canon-test");
    const bad = join(home, "~", "Documents", "GitHub", "cactus-canon-test");
    assert.notEqual(workspaceHash(bad), workspaceHash(canonicalizeWorkspacePath(good)));

    await upsertInitiative(
      bad,
      { planPath: "plans/a.md", title: "From bad path" },
      { dataRoot },
    );
    await upsertInitiative(
      good,
      { planPath: "plans/b.md", title: "From good path" },
      { dataRoot },
    );

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], workspaceBucketHash(good));

    const state = await getState(bad, { dataRoot });
    assert.equal(state.workspacePath, resolveBoardWorkspacePath(good));
    assert.equal(state.initiatives.length, 2);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("distinct non-git directories keep separate store buckets", async () => {
  const dataRoot = await mkdtempSafe();
  const a = await mkdtemp(join(tmpdir(), "hb-store-a-"));
  const b = await mkdtemp(join(tmpdir(), "hb-store-b-"));
  try {
    await upsertInitiative(a, { planPath: "plans/a.md", title: "A" }, { dataRoot });
    await upsertInitiative(b, { planPath: "plans/b.md", title: "B" }, { dataRoot });
    assert.notEqual(
      workspaceBucketHash(a),
      workspaceBucketHash(b),
    );
    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 2);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("directory alias shares store bucket with resolved real path", async () => {
  const dataRoot = await mkdtempSafe();
  const root = await mkdtemp(join(tmpdir(), "hb-store-alias-"));
  const real = join(root, "real");
  const alias = join(root, "alias");
  await mkdir(real);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(real, alias, linkType);
  try {
    await upsertInitiative(real, { planPath: "plans/r.md", title: "Real" }, { dataRoot });
    const fromAlias = await loadState(alias, { dataRoot });
    assert.equal(fromAlias.workspacePath, resolveBoardWorkspacePath(real));
    assert.equal(fromAlias.initiatives.length, 1);
    assert.equal(statePathFor(alias, { dataRoot }), statePathFor(real, { dataRoot }));
    assert.equal((await boardDirs(dataRoot)).length, 1);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("linked git worktree load/save uses main root bucket", async (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const dataRoot = await mkdtempSafe();
  const root = await mkdtemp(join(tmpdir(), "hb-store-wt-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  await mkdir(main);
  git(main, "init");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "t");
  await writeFile(join(main, "f.txt"), "x\n");
  git(main, "add", "f.txt");
  git(main, "commit", "-m", "init");
  git(main, "branch", "feature");
  git(main, "worktree", "add", linked, "feature");

  try {
    const mainKey = resolveBoardWorkspacePath(main);
    await upsertInitiative(
      main,
      { planPath: "plans/wt.md", title: "From main" },
      { dataRoot },
    );
    const fromLinked = await loadState(linked, { dataRoot });
    assert.equal(fromLinked.workspacePath, mainKey);
    assert.equal(fromLinked.initiatives.length, 1);
    assert.equal(statePathFor(linked, { dataRoot }), statePathFor(main, { dataRoot }));

    await upsertInitiative(
      linked,
      { planPath: "plans/wt2.md", title: "From linked" },
      { dataRoot },
    );
    const reloaded = await getState(main, { dataRoot });
    assert.equal(reloaded.workspacePath, mainKey);
    assert.equal(reloaded.initiatives.length, 2);
    assert.equal((await boardDirs(dataRoot)).length, 1);
  } finally {
    try {
      git(main, "worktree", "remove", linked, "--force");
    } catch {
      // best-effort cleanup
    }
    await rm(dataRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("canonicalizeWorkspacePath unifies drive case, slashes, trailing junk", () => {
  const canonical = "D:\\workspace\\foo";
  const variants = [
    "d:\\workspace\\foo",
    "D:/workspace/foo",
    "d:/workspace/foo/",
    "D:\\workspace\\foo\\",
    "  d:\\workspace\\foo\\  ",
    "  D:/workspace/foo/  ",
    "\\\\?\\D:\\workspace\\foo",
    "\\\\?\\d:\\workspace\\foo\\",
  ];
  for (const v of variants) {
    assert.equal(canonicalizeWorkspacePath(v), canonical, v);
    assert.equal(workspaceIdentityKey(v), workspaceIdentityKey(canonical), v);
    assert.equal(workspaceBucketHash(v), workspaceBucketHash(canonical), v);
  }

  assert.equal(
    canonicalizeWorkspacePath("/tmp/foo/"),
    canonicalizeWorkspacePath("/tmp/foo"),
  );
  assert.equal(
    canonicalizeWorkspacePath("  /tmp/foo/  "),
    canonicalizeWorkspacePath("/tmp/foo"),
  );
  if (process.platform !== "win32") {
    assert.notEqual(
      workspaceIdentityKey("/tmp/Foo"),
      workspaceIdentityKey("/tmp/foo"),
    );
  }

  assert.equal(
    canonicalizeWorkspacePath("\\\\server\\share\\proj\\"),
    "\\\\server\\share\\proj",
  );
  assert.equal(
    workspaceIdentityKey("\\\\Server\\Share\\proj"),
    workspaceIdentityKey("\\\\server\\share\\proj\\"),
  );
});

test("D: vs d: and slash variants share one store bucket", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const a = "d:\\workspace\\case-dup";
    const b = "D:/workspace/case-dup/";
    const c = "  D:\\workspace\\case-dup\\  ";
    await upsertInitiative(a, { planPath: "plans/a.md", title: "From d:" }, { dataRoot });
    await upsertInitiative(b, { planPath: "plans/b.md", title: "From D:/" }, { dataRoot });
    await upsertInitiative(c, { planPath: "plans/c.md", title: "From padded" }, { dataRoot });

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], workspaceBucketHash(a));

    const state = await getState("D:\\workspace\\case-dup", { dataRoot });
    assert.equal(state.workspacePath, "D:\\workspace\\case-dup");
    assert.equal(state.initiatives.length, 3);
    assert.equal(statePathFor(a, { dataRoot }), statePathFor(b, { dataRoot }));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("orphan drive-letter bucket merges into canonical and is deleted", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const pretty = "D:\\workspace\\orphan-case";
    const oldRaw = "D:\\workspace\\orphan-case";
    const oldHash = workspaceHash(oldRaw);
    const canonicalHash = workspaceBucketHash(pretty);
    assert.notEqual(oldHash, canonicalHash);

    const orphanDir = join(dataRoot, oldHash);
    await mkdir(orphanDir, { recursive: true });
    await writeFile(
      join(orphanDir, "state.json"),
      `${JSON.stringify(
        {
          workspacePath: oldRaw,
          initiatives: [
            {
              id: "init-case-orphan",
              planPath: "plans/orphan.md",
              title: "Case orphan",
              blurb: "",
              status: "planning",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          slices: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const state = await getState(pretty, { dataRoot });
    assert.equal(state.workspacePath, pretty);
    assert.ok(state.initiatives.some((i) => i.id === "init-case-orphan"));

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], canonicalHash);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("orphan tilde bucket merges into canonical and is deleted", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const home = homedir();
    const good = join(home, "Documents", "GitHub", "cactus-orphan-test");
    // Pre-canonical bug: resolve does not expand ~, so this hashed differently.
    const badRaw = `${home}/~/Documents/GitHub/cactus-orphan-test`;
    const orphanHash = workspaceHash(badRaw);
    const canonicalHash = workspaceBucketHash(good);
    assert.notEqual(orphanHash, canonicalHash);

    const orphanDir = join(dataRoot, orphanHash);
    await mkdir(orphanDir, { recursive: true });
    await writeFile(
      join(orphanDir, "state.json"),
      `${JSON.stringify(
        {
          workspacePath: good,
          initiatives: [
            {
              id: "init-orphan-1",
              planPath: "plans/orphan.md",
              title: "Orphan initiative",
              blurb: "",
              status: "planning",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          slices: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const { initiative } = await upsertInitiative(
      good,
      { planPath: "plans/new.md", title: "Canonical upsert" },
      { dataRoot },
    );
    assert.ok(initiative.id);

    const state = await getState(badRaw, { dataRoot });
    assert.equal(state.workspacePath, resolveBoardWorkspacePath(good));
    assert.ok(state.initiatives.some((i) => i.id === "init-orphan-1"));
    assert.ok(state.initiatives.some((i) => i.title === "Canonical upsert"));

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], canonicalHash);
    assert.equal(statePathFor(good, { dataRoot }), statePathFor(badRaw, { dataRoot }));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} cwd @param {...string} args */
function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

/** @returns {Promise<string>} */
async function mkdtempSafe() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "harness-board-"));
}

/**
 * @param {string} dataRoot
 * @returns {Promise<string[]>}
 */
async function boardDirs(dataRoot) {
  const names = await readdir(dataRoot);
  /** @type {string[]} */
  const dirs = [];
  for (const name of names) {
    try {
      await readFile(join(dataRoot, name, "state.json"), "utf8");
      dirs.push(name);
    } catch {
      // skip non-bucket entries (e.g. active-workspace.txt)
    }
  }
  return dirs;
}
