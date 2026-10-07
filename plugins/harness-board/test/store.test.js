import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addSlice,
  canonicalizeWorkspacePath,
  emptyState,
  getState,
  loadState,
  saveState,
  statePathFor,
  upsertInitiative,
  legacyWorkspaceBucketHash,
  workspaceBucketHash,
  workspaceHash,
  workspaceIdentityKey,
} from "../lib/store.js";
import { migrateSlugBuckets } from "../lib/migrate-slug.js";
import {
  expandHomePath,
  sanitizeWorkspacePath,
  workspaceFolderSlug,
  workspaceSlugIdentityKey,
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
    const key = canonicalizeWorkspacePath(ws);
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
    const key = canonicalizeWorkspacePath(ws);
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
  assert.equal(s.workspacePath, canonicalizeWorkspacePath("/tmp/ws"));
  assert.deepEqual(s.initiatives, []);
  assert.deepEqual(s.slices, []);
  assert.ok(typeof s.updatedAt === "string");
});

test("saveState writes under dataRoot/hash/state.json", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/tmp/save-path-ws";
    const key = canonicalizeWorkspacePath(ws);
    const state = emptyState(ws);
    await saveState(state, { dataRoot });
    const expected = join(dataRoot, workspaceBucketHash(key), "state.json");
    const raw = await readFile(expected, "utf8");
    assert.ok(raw.includes(key));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("same folder slug shares one bucket across different absolute paths", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const pathA = "/Users/alice/clones/robinerd-cursor-plugins";
    const pathB = "/Users/bob/work/robinerd-cursor-plugins";
    assert.equal(workspaceFolderSlug(pathA), "robinerd-cursor-plugins");
    assert.equal(workspaceSlugIdentityKey(pathA), workspaceSlugIdentityKey(pathB));
    assert.equal(workspaceBucketHash(pathA), workspaceBucketHash(pathB));

    await upsertInitiative(
      pathA,
      { planPath: "plans/a.md", title: "From A" },
      { dataRoot },
    );
    await upsertInitiative(
      pathB,
      { planPath: "plans/b.md", title: "From B" },
      { dataRoot },
    );

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], workspaceBucketHash(pathA));

    const state = await getState(pathB, { dataRoot });
    assert.equal(state.initiatives.length, 2);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("different folder slugs use different buckets", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const pathA = "/tmp/ws-alpha";
    const pathB = "/tmp/ws-beta";
    assert.notEqual(workspaceBucketHash(pathA), workspaceBucketHash(pathB));

    await upsertInitiative(pathA, { planPath: "plans/a.md", title: "A" }, { dataRoot });
    await upsertInitiative(pathB, { planPath: "plans/b.md", title: "B" }, { dataRoot });

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 2);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
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
  assert.notEqual(
    workspaceIdentityKey("/tmp/Foo"),
    workspaceIdentityKey("/tmp/foo"),
  );
  assert.notEqual(
    workspaceBucketHash("/tmp/Foo"),
    workspaceBucketHash("/tmp/foo"),
  );

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

test("legacy full-path bucket is invisible until migrate-slug runs", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "D:\\workspace\\legacy-migrate-fixture";
    const legacyHash = legacyWorkspaceBucketHash(ws);
    const slugHash = workspaceBucketHash(ws);
    assert.notEqual(legacyHash, slugHash);

    const legacyDir = join(dataRoot, legacyHash);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "state.json"),
      `${JSON.stringify(
        {
          workspacePath: ws,
          initiatives: [
            {
              id: "init-legacy-1",
              planPath: "plans/legacy.md",
              title: "Legacy only",
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

    const before = await getState(ws, { dataRoot });
    assert.equal(before.initiatives.length, 0);

    const result = await migrateSlugBuckets(dataRoot);
    assert.equal(result.bucketsScanned, 1);
    assert.equal(result.legacyDirsRemoved, 1);

    const after = await getState(ws, { dataRoot });
    assert.ok(after.initiatives.some((i) => i.id === "init-legacy-1"));

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], slugHash);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("migrate-slug merges legacy bucket with existing slug bucket by id", async () => {
  const dataRoot = await mkdtempSafe();
  try {
    const ws = "/opt/host/robinerd-cursor-plugins";
    const slugHash = workspaceBucketHash(ws);
    const legacyHash = legacyWorkspaceBucketHash(ws);

    await upsertInitiative(
      ws,
      { planPath: "plans/new.md", title: "Slug bucket" },
      { dataRoot },
    );

    const legacyDir = join(dataRoot, legacyHash);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "state.json"),
      `${JSON.stringify(
        {
          workspacePath: "/Users/laptop/robinerd-cursor-plugins",
          initiatives: [
            {
              id: "init-laptop-only",
              planPath: "plans/laptop.md",
              title: "From laptop path",
              blurb: "",
              status: "planning",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
          slices: [],
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await migrateSlugBuckets(dataRoot);

    const state = await getState("/Users/laptop/robinerd-cursor-plugins", { dataRoot });
    assert.equal(state.initiatives.length, 2);
    assert.ok(state.initiatives.some((i) => i.title === "Slug bucket"));
    assert.ok(state.initiatives.some((i) => i.id === "init-laptop-only"));

    const dirs = await boardDirs(dataRoot);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], slugHash);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

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
