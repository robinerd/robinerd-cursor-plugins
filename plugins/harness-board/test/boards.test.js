import assert from "node:assert/strict";
import { mkdir, writeFile, utimes, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  boardHasActiveWork,
  boardHasAttention,
  initiativeNeedsAttention,
  listBoardSummaries,
  hashForWorkspace,
  resolveSelectedWorkspace,
} from "../lib/boards.js";
import { rememberActiveWorkspace } from "../lib/workspace.js";
import { workspaceHash } from "../lib/store.js";

/**
 * @param {string} dataRoot
 * @param {string} workspacePath
 * @param {number} mtimeMs
 * @param {{ id?: string, status: string, awaitingHuman?: boolean }[]} [initiatives]
 * @param {{ id?: string, initiativeId: string, column: string }[]} [slices]
 */
async function writeBoard(
  dataRoot,
  workspacePath,
  mtimeMs,
  initiatives = [],
  slices = [],
  folderHash = hashForWorkspace(workspacePath),
) {
  const hash = folderHash;
  const dir = join(dataRoot, hash);
  await mkdir(dir, { recursive: true });
  const stateFile = join(dir, "state.json");
  const payload = {
    workspacePath,
    initiatives: initiatives.map((i, idx) => ({
      id: i.id ?? `i${idx}`,
      planPath: "plans/x.md",
      title: `Init ${idx}`,
      blurb: "",
      status: i.status,
      ...(typeof i.awaitingHuman === "boolean"
        ? { awaitingHuman: i.awaitingHuman }
        : {}),
      updatedAt: new Date(mtimeMs).toISOString(),
    })),
    slices: slices.map((s, idx) => ({
      id: s.id ?? `s${idx}`,
      initiativeId: s.initiativeId,
      title: `Slice ${idx}`,
      column: s.column,
      evidence: [],
      history: [],
    })),
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
    assert.equal(boards[0].hasActiveWork, false);
    assert.equal(boards[0].hasAttention, false);
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

test("boardHasActiveWork: planning/building/integrating yes; done/parked/empty no", () => {
  assert.equal(boardHasActiveWork({ initiatives: [{ status: "planning" }] }), true);
  assert.equal(boardHasActiveWork({ initiatives: [{ status: "building" }] }), true);
  assert.equal(
    boardHasActiveWork({ initiatives: [{ status: "integrating" }] }),
    true,
  );
  assert.equal(boardHasActiveWork({ initiatives: [{ status: "done" }] }), false);
  assert.equal(boardHasActiveWork({ initiatives: [{ status: "parked" }] }), false);
  assert.equal(
    boardHasActiveWork({
      initiatives: [{ status: "done" }, { status: "parked" }],
    }),
    false,
  );
  assert.equal(
    boardHasActiveWork({
      initiatives: [{ status: "done" }, { status: "planning" }],
    }),
    true,
  );
  assert.equal(boardHasActiveWork({ initiatives: [] }), false);
  assert.equal(boardHasActiveWork({}), false);
  assert.equal(boardHasActiveWork(null), false);
});

test("listBoardSummaries hasActiveWork from initiative statuses; multiple boards active", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-active-"));
  try {
    const a = "/tmp/ws-a";
    const b = "/tmp/ws-b";
    const c = "/tmp/ws-c";
    await writeBoard(dataRoot, a, Date.UTC(2025, 0, 3), [{ status: "planning" }]);
    await writeBoard(dataRoot, b, Date.UTC(2025, 0, 2), [
      { status: "building" },
    ]);
    await writeBoard(dataRoot, c, Date.UTC(2025, 0, 1), [
      { status: "done" },
      { status: "parked" },
    ]);

    const boards = await listBoardSummaries(dataRoot);
    const byPath = Object.fromEntries(
      boards.map((x) => [x.workspacePath, x.hasActiveWork]),
    );
    assert.equal(byPath[a], true);
    assert.equal(byPath[b], true);
    assert.equal(byPath[c], false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("initiativeNeedsAttention: parked/done never; flag only, not blocked column", () => {
  assert.equal(
    initiativeNeedsAttention({ id: "a", status: "parked", awaitingHuman: true }),
    false,
  );
  assert.equal(
    initiativeNeedsAttention({ id: "a", status: "done", awaitingHuman: true }),
    false,
  );
  assert.equal(
    initiativeNeedsAttention({ id: "a", status: "integrating" }),
    false,
  );
  assert.equal(
    initiativeNeedsAttention({ id: "a", status: "planning", awaitingHuman: true }),
    true,
  );
  assert.equal(
    initiativeNeedsAttention({ id: "a", status: "building", awaitingHuman: true }),
    true,
  );
  assert.equal(
    initiativeNeedsAttention({
      id: "a",
      status: "integrating",
      awaitingHuman: true,
    }),
    true,
  );
  assert.equal(
    initiativeNeedsAttention({
      id: "a",
      status: "building",
      awaitingHuman: false,
    }),
    false,
  );
});

test("boardHasAttention ORs initiatives from awaitingHuman only", () => {
  assert.equal(
    boardHasAttention({
      initiatives: [
        { id: "quiet", status: "building" },
        { id: "loud", status: "planning", awaitingHuman: true },
      ],
      slices: [],
    }),
    true,
  );
  assert.equal(
    boardHasAttention({
      initiatives: [{ id: "quiet", status: "integrating" }],
      slices: [{ initiativeId: "other", column: "blocked" }],
    }),
    false,
  );
  assert.equal(
    boardHasAttention({
      initiatives: [{ id: "q", status: "building" }],
      slices: [{ initiativeId: "q", column: "blocked" }],
    }),
    false,
  );
  assert.equal(boardHasAttention({}), false);
  assert.equal(boardHasAttention(null), false);
});

test("listBoardSummaries hasAttention from awaitingHuman, not blocked slices", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-attn-"));
  try {
    const quiet = "/tmp/ws-quiet";
    const flagged = "/tmp/ws-flagged";
    const blocked = "/tmp/ws-blocked";
    await writeBoard(dataRoot, quiet, Date.UTC(2025, 0, 3), [
      { status: "integrating" },
    ]);
    await writeBoard(dataRoot, flagged, Date.UTC(2025, 0, 2), [
      { id: "f", status: "planning", awaitingHuman: true },
    ]);
    await writeBoard(
      dataRoot,
      blocked,
      Date.UTC(2025, 0, 1),
      [{ id: "b", status: "building", awaitingHuman: false }],
      [{ initiativeId: "b", column: "blocked" }],
    );

    const boards = await listBoardSummaries(dataRoot);
    const byPath = Object.fromEntries(
      boards.map((x) => [x.workspacePath, x.hasAttention]),
    );
    assert.equal(byPath[quiet], false);
    assert.equal(byPath[flagged], true);
    assert.equal(byPath[blocked], false);
    assert.equal("hasAttention" in boards[0], true);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("resolveSelectedWorkspace ignores active-workspace pointer; prefers requested then newest", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-sel-"));
  try {
    const older = "/tmp/sel-older";
    const newer = "/tmp/sel-newer";
    await writeBoard(dataRoot, older, Date.UTC(2024, 0, 1));
    await writeBoard(dataRoot, newer, Date.UTC(2025, 0, 1));
    rememberActiveWorkspace(older, dataRoot);

    const noRequest = await resolveSelectedWorkspace({ dataRoot });
    assert.equal(noRequest.workspacePath, newer);

    const requested = await resolveSelectedWorkspace({
      dataRoot,
      requested: older,
    });
    assert.equal(requested.workspacePath, older);

    const byDefault = await resolveSelectedWorkspace({
      dataRoot,
      defaultWorkspace: older,
    });
    assert.equal(byDefault.workspacePath, older);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("listBoardSummaries collapses drive-case and slash duplicates", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-dedupe-"));
  try {
    const lower = "d:\\workspace\\dup-board";
    const upper = "D:\\workspace\\dup-board";
    const slashed = "D:/workspace/dup-board/";
    await writeBoard(
      dataRoot,
      lower,
      Date.UTC(2024, 0, 1),
      [{ status: "done" }],
      [],
      hashForWorkspace(upper),
    );
    await writeBoard(
      dataRoot,
      upper,
      Date.UTC(2025, 0, 1),
      [{ status: "planning", awaitingHuman: true }],
      [],
      workspaceHash(upper),
    );
    await writeBoard(
      dataRoot,
      slashed,
      Date.UTC(2024, 6, 1),
      [{ status: "parked" }],
      [],
      workspaceHash(slashed),
    );

    const boards = await listBoardSummaries(dataRoot);
    assert.equal(boards.length, 1);
    assert.equal(boards[0].workspacePath, "D:\\workspace\\dup-board");
    assert.equal(boards[0].hash, hashForWorkspace(upper));
    assert.equal(boards[0].hasActiveWork, true);
    assert.equal(boards[0].hasAttention, true);

    const selected = await resolveSelectedWorkspace({
      dataRoot,
      requested: "  d:/workspace/dup-board\\  ",
    });
    assert.equal(selected.workspacePath, "D:\\workspace\\dup-board");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
