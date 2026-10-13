import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatBoardSummary,
  formatInitiativeCard,
} from "../lib/cards.js";
import { callBoardTool } from "../lib/mcp.js";

const WORKSPACE = "D:\\workspace\\harness-board-cards";

/** @type {import("../lib/store.js").BoardState} */
const fixtureState = {
  workspacePath: WORKSPACE,
  updatedAt: "2026-10-13T12:00:00.000Z",
  initiatives: [
    {
      id: "init-plan",
      planPath: "plans/a.md",
      title: "Planning initiative",
      blurb: "Plan blurb line.",
      nextSteps: "Do the plan thing.",
      status: "planning",
      awaitingHuman: false,
      updatedAt: "2026-10-13T12:00:00.000Z",
    },
    {
      id: "init-attn",
      planPath: "plans/b.md",
      title: "Needs human",
      blurb: "Attention blurb.",
      nextSteps: "Reply please.",
      status: "building",
      awaitingHuman: true,
      updatedAt: "2026-10-13T12:00:00.000Z",
    },
    {
      id: "init-done",
      planPath: "plans/c.md",
      title: "Finished",
      blurb: "Done blurb.",
      status: "done",
      updatedAt: "2026-10-13T12:00:00.000Z",
    },
    {
      id: "init-parked",
      planPath: "plans/d.md",
      title: "Parked work",
      blurb: "Parked blurb.",
      status: "parked",
      updatedAt: "2026-10-13T12:00:00.000Z",
    },
    {
      id: "init-skip",
      planPath: "plans/e.md",
      title: "[SKIPPED] Old",
      blurb: "skip",
      status: "planning",
      updatedAt: "2026-10-13T12:00:00.000Z",
    },
  ],
  slices: [
    {
      id: "s1",
      initiativeId: "init-attn",
      title: "Slice in implement",
      column: "implement",
      evidence: [],
      history: [],
    },
    {
      id: "s2",
      initiativeId: "init-attn",
      title: "Slice in review",
      column: "review",
      evidence: [],
      history: [],
    },
    {
      id: "s3",
      initiativeId: "init-plan",
      title: "Ready slice",
      column: "ready",
      evidence: [],
      history: [],
    },
  ],
};

test("formatBoardSummary: callout, attention, N1 break, no ### all", () => {
  const md = formatBoardSummary([fixtureState], {
    boardUiBase: "http://board.test",
  });
  assert.match(md, /^:::Board_Summary\n/);
  assert.match(md, /\n:::$/);
  assert.doesNotMatch(md, /### all\b/);
  assert.match(md, /### ❗ harness-board-cards/);
  assert.match(md, /\[\[↗\]\]\(http:\/\/board\.test\/\?workspace=/);
  assert.match(md, /\*\*❗ Needs human\*\*/);
  assert.match(md, /Attention blurb\.  \n  \*\*Next steps:\*\* Reply please\./);
  assert.match(md, /\*\*⏸ parked\*\*/);
  assert.doesNotMatch(md, /\*\*Finished\*\*/);
  assert.doesNotMatch(md, /\[SKIPPED\]/);
});

test("formatInitiativeCard: status, blobs, empty lanes", () => {
  const md = formatInitiativeCard(fixtureState, {
    initiativeId: "init-attn",
    boardName: "test-board",
  });
  assert.match(md, /^:::test-board\n/);
  assert.match(md, /\*\*Status:\*\* 👷 building/);
  assert.match(md, /<summary>🟡1 🟣1<\/summary>/);
  assert.match(md, /\| ⬜ \| ready \| — \|/);
  assert.match(md, /\| 🟡 \| implement \| Slice in implement \|/);
  assert.match(md, /\| 🟣 \| review \| Slice in review \|/);
  assert.doesNotMatch(md, /Next steps/);
});

test("formatInitiativeCard: no slices summary", () => {
  const md = formatInitiativeCard(fixtureState, {
    initiativeId: "init-plan",
  });
  assert.match(md, /<summary>⬜1<\/summary>/);
});

test("MCP board_summary + initiative_card smoke", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-cards-"));
  try {
    const env = { dataRoot };
    const upsert = await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE,
        planPath: "plans/smoke.md",
        title: "Smoke initiative",
        blurb: "Blurb.",
        nextSteps: "Next.",
        status: "planning",
        awaitingHuman: true,
      },
      env,
    );
    const initiativeId = upsert.initiative.id;
    await callBoardTool(
      "slice_add",
      { workspace: WORKSPACE, initiativeId, title: "Ready one" },
      env,
    );

    const summary = await callBoardTool(
      "board_summary",
      { workspace: WORKSPACE, boardUiBase: "http://127.0.0.1:4173" },
      env,
    );
    assert.equal(summary.ok, true);
    assert.match(summary.markdown, /:::Board_Summary/);
    assert.equal(summary.boards.length, 1);
    assert.equal(summary.boards[0].openCount, 1);

    const card = await callBoardTool(
      "initiative_card",
      { workspace: WORKSPACE, initiativeId },
      env,
    );
    assert.equal(card.ok, true);
    assert.match(card.markdown, /\*\*Status:\*\* ✏️ planning/);

    const missing = await callBoardTool(
      "initiative_card",
      { workspace: WORKSPACE, initiativeId: "nope" },
      env,
    );
    assert.equal(missing.ok, false);
    assert.match(missing.error, /not found/i);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
