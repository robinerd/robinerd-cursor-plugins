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
  workspaceHash,
} from "../lib/store.js";
import { expandHomePath, sanitizeWorkspacePath } from "../lib/workspace.js";

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
    const expected = join(dataRoot, workspaceHash(key), "state.json");
    const raw = await readFile(expected, "utf8");
    assert.ok(raw.includes(key));
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
    assert.equal(dirs[0], workspaceHash(canonicalizeWorkspacePath(good)));

    const state = await getState(bad, { dataRoot });
    assert.equal(state.workspacePath, canonicalizeWorkspacePath(good));
    assert.equal(state.initiatives.length, 2);
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
    const canonicalHash = workspaceHash(canonicalizeWorkspacePath(good));
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
    assert.equal(state.workspacePath, canonicalizeWorkspacePath(good));
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
