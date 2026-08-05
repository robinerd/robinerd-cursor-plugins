import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addSlice,
  emptyState,
  getState,
  loadState,
  saveState,
  statePathFor,
  upsertInitiative,
  workspaceHash,
} from "../lib/store.js";

test("workspaceHash is stable truncated sha256", () => {
  const a = workspaceHash("D:\\proj\\one");
  const b = workspaceHash("D:\\proj\\one");
  const c = workspaceHash("D:\\proj\\two");
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.notEqual(a, c);
});

test("load missing file yields empty state", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-"));
  try {
    const ws = "D:\\workspace\\missing-fixture";
    const state = await loadState(ws, { dataRoot });
    assert.deepEqual(state.initiatives, []);
    assert.deepEqual(state.slices, []);
    assert.equal(state.workspacePath, ws);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("save/load round-trip + upsertInitiative + addSlice", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-"));
  try {
    const ws = "D:\\workspace\\round-trip";
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

    const reloaded = await getState(ws, { dataRoot });
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
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("emptyState shape", () => {
  const s = emptyState("/tmp/ws");
  assert.equal(s.workspacePath, "/tmp/ws");
  assert.deepEqual(s.initiatives, []);
  assert.deepEqual(s.slices, []);
  assert.ok(typeof s.updatedAt === "string");
});

test("saveState writes under dataRoot/hash/state.json", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-"));
  try {
    const ws = "/tmp/save-path-ws";
    const state = emptyState(ws);
    await saveState(state, { dataRoot });
    const expected = join(dataRoot, workspaceHash(ws), "state.json");
    const raw = await readFile(expected, "utf8");
    assert.ok(raw.includes(ws));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
