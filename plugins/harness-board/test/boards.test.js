import assert from "node:assert/strict";
import { mkdir, writeFile, utimes, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listBoardSummaries, hashForWorkspace } from "../lib/boards.js";

/**
 * @param {string} dataRoot
 * @param {string} workspacePath
 * @param {number} mtimeMs
 */
async function writeBoard(dataRoot, workspacePath, mtimeMs) {
  const hash = hashForWorkspace(workspacePath);
  const dir = join(dataRoot, hash);
  await mkdir(dir, { recursive: true });
  const stateFile = join(dir, "state.json");
  const payload = {
    workspacePath,
    initiatives: [],
    slices: [],
    updatedAt: new Date(mtimeMs).toISOString(),
  };
  await writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const atime = new Date(mtimeMs);
  const mtime = new Date(mtimeMs);
  await utimes(stateFile, atime, mtime);
  return hash;
}

test("listBoardSummaries sorts by state.json mtime newest first", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-list-"));
  try {
    const older = "D:\\workspace\\board-older";
    const newer = "D:\\workspace\\board-newer";
    const mid = "D:\\workspace\\board-mid";

    await writeBoard(dataRoot, older, Date.UTC(2024, 0, 1, 12, 0, 0));
    await writeBoard(dataRoot, mid, Date.UTC(2024, 5, 15, 12, 0, 0));
    await writeBoard(dataRoot, newer, Date.UTC(2025, 0, 1, 12, 0, 0));

    const boards = await listBoardSummaries(dataRoot);
    assert.equal(boards.length, 3);
    assert.deepEqual(
      boards.map((b) => b.workspacePath),
      [newer, mid, older],
    );
    assert.ok(boards[0].mtimeMs > boards[1].mtimeMs);
    assert.ok(boards[1].mtimeMs > boards[2].mtimeMs);
    assert.equal(boards[0].hash, hashForWorkspace(newer));
    assert.match(boards[0].mtimeIso, /^2025-/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("listBoardSummaries returns [] when data root missing", async () => {
  const boards = await listBoardSummaries(
    join(tmpdir(), `harness-board-missing-${Date.now()}`),
  );
  assert.deepEqual(boards, []);
});
