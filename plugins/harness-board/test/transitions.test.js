import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { upsertInitiative } from "../lib/store.js";
import {
  ACTIONS,
  ALLOWED_BY_COLUMN,
  TransitionError,
  allowedActionsForColumn,
  deriveInitiativeStatus,
  humanUnblock,
  implementerStart,
  implementerSubmit,
  initiativeUpsert,
  park,
  reviewerVerdict,
  sliceAdd,
  sliceApprove,
  verifierVerdict,
} from "../lib/transitions.js";

/**
 * @param {() => Promise<void>} fn
 */
async function withTempRoot(fn) {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-tr-"));
  try {
    await fn(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

/**
 * @param {string} dataRoot
 */
async function seedInitiative(dataRoot) {
  const ws = "D:\\workspace\\transitions";
  const { initiative } = await initiativeUpsert(
    ws,
    {
      planPath: "plans/harness-board.md",
      title: "harness-board",
      blurb: "board plugin",
      status: "planning",
    },
    { dataRoot },
  );
  return { ws, initiative, opts: { dataRoot } };
}

test("upsertInitiative preserves status when omitted on update", async () => {
  await withTempRoot(async (dataRoot) => {
    const ws = "D:\\workspace\\status-preserve";
    const { initiative } = await upsertInitiative(
      ws,
      {
        planPath: "plans/x.md",
        title: "X",
        status: "building",
      },
      { dataRoot },
    );
    const again = await upsertInitiative(
      ws,
      {
        id: initiative.id,
        planPath: "plans/x.md",
        title: "X2",
      },
      { dataRoot },
    );
    assert.equal(again.initiative.status, "building");
    assert.equal(again.initiative.title, "X2");
  });
});

test("happy path: ready→…→done with history", async () => {
  await withTempRoot(async (dataRoot) => {
    const { ws, initiative, opts } = await seedInitiative(dataRoot);

    const { slice } = await sliceAdd(
      ws,
      { initiativeId: initiative.id, title: "S2 Transition engine" },
      opts,
    );
    assert.equal(slice.column, "ready");
    assert.equal(slice.history.length, 1);
    assert.equal(slice.history[0].action, ACTIONS.SLICE_ADD);

    let cur = await sliceApprove(ws, { sliceId: slice.id, note: "go" }, opts);
    assert.equal(cur.slice.column, "approved");
    assert.equal(cur.state.initiatives[0].status, "building");

    cur = await implementerStart(ws, { sliceId: slice.id }, opts);
    assert.equal(cur.slice.column, "implement");

    cur = await implementerSubmit(
      ws,
      {
        sliceId: slice.id,
        summary: "engine done",
        filesTouched: ["lib/transitions.js"],
      },
      opts,
    );
    assert.equal(cur.slice.column, "review");

    cur = await reviewerVerdict(
      ws,
      { sliceId: slice.id, verdict: "approve", findings: "ok" },
      opts,
    );
    assert.equal(cur.slice.column, "verify");

    cur = await verifierVerdict(
      ws,
      { sliceId: slice.id, verdict: "pass", evidence: { tests: "ok" } },
      opts,
    );
    assert.equal(cur.slice.column, "done");
    assert.equal(cur.slice.evidence.length, 1);
    assert.ok(cur.slice.history.length >= 6);
    assert.equal(cur.slice.history.at(-1).action, ACTIONS.VERIFIER_VERDICT);
    assert.equal(cur.slice.history.at(-1).to, "done");
  });
});

const LEGAL_EDGES = [
  {
    name: "slice_approve ready→approved",
    setup: ["ready"],
    run: (ws, id, opts) => sliceApprove(ws, { sliceId: id }, opts),
    to: "approved",
  },
  {
    name: "implementer_start approved→implement",
    setup: ["ready", "approve"],
    run: (ws, id, opts) => implementerStart(ws, { sliceId: id }, opts),
    to: "implement",
  },
  {
    name: "implementer_start implement→implement (retry)",
    setup: ["ready", "approve", "start"],
    run: (ws, id, opts) => implementerStart(ws, { sliceId: id }, opts),
    to: "implement",
  },
  {
    name: "implementer_submit implement→review",
    setup: ["ready", "approve", "start"],
    run: (ws, id, opts) =>
      implementerSubmit(
        ws,
        { sliceId: id, summary: "s", filesTouched: ["a.js"] },
        opts,
      ),
    to: "review",
  },
  {
    name: "reviewer approve→verify",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) =>
      reviewerVerdict(ws, { sliceId: id, verdict: "approve" }, opts),
    to: "verify",
  },
  {
    name: "reviewer revise→implement",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) =>
      reviewerVerdict(ws, { sliceId: id, verdict: "revise" }, opts),
    to: "implement",
  },
  {
    name: "reviewer bounce→blocked",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) =>
      reviewerVerdict(ws, { sliceId: id, verdict: "bounce" }, opts),
    to: "blocked",
  },
  {
    name: "verifier pass→done",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "pass" }, opts),
    to: "done",
  },
  {
    name: "verifier fail→implement",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "fail" }, opts),
    to: "implement",
  },
  {
    name: "verifier bounce→blocked",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "bounce" }, opts),
    to: "blocked",
  },
  {
    name: "verifier replan→blocked",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "replan" }, opts),
    to: "blocked",
  },
  {
    name: "human_unblock blocked→implement",
    setup: ["ready", "approve", "start", "submit", "reviewBounce"],
    run: (ws, id, opts) =>
      humanUnblock(ws, { sliceId: id, reason: "unblocked" }, opts),
    to: "implement",
  },
];

/**
 * @param {string} ws
 * @param {string} initiativeId
 * @param {{ dataRoot: string }} opts
 * @param {string[]} steps
 */
async function advance(ws, initiativeId, opts, steps) {
  let sliceId = null;
  for (const step of steps) {
    if (step === "ready") {
      const { slice } = await sliceAdd(
        ws,
        { initiativeId, title: "edge" },
        opts,
      );
      sliceId = slice.id;
    } else if (step === "approve") {
      await sliceApprove(ws, { sliceId }, opts);
    } else if (step === "start") {
      await implementerStart(ws, { sliceId }, opts);
    } else if (step === "submit") {
      await implementerSubmit(
        ws,
        { sliceId, summary: "work" },
        opts,
      );
    } else if (step === "reviewApprove") {
      await reviewerVerdict(ws, { sliceId, verdict: "approve" }, opts);
    } else if (step === "reviewBounce") {
      await reviewerVerdict(ws, { sliceId, verdict: "bounce" }, opts);
    } else {
      throw new Error(`unknown setup step: ${step}`);
    }
  }
  return sliceId;
}

for (const edge of LEGAL_EDGES) {
  test(`legal: ${edge.name}`, async () => {
    await withTempRoot(async (dataRoot) => {
      const { ws, initiative, opts } = await seedInitiative(dataRoot);
      const sliceId = await advance(ws, initiative.id, opts, edge.setup);
      const { slice } = await edge.run(ws, sliceId, opts);
      assert.equal(slice.column, edge.to);
      assert.equal(slice.history.at(-1).to, edge.to);
    });
  });
}

const ILLEGAL_EDGES = [
  {
    name: "slice_approve from implement",
    setup: ["ready", "approve", "start"],
    run: (ws, id, opts) => sliceApprove(ws, { sliceId: id }, opts),
    expectColumn: "implement",
    expectAllowed: ALLOWED_BY_COLUMN.implement,
  },
  {
    name: "implementer_submit from ready",
    setup: ["ready"],
    run: (ws, id, opts) =>
      implementerSubmit(ws, { sliceId: id, summary: "nope" }, opts),
    expectColumn: "ready",
    expectAllowed: ALLOWED_BY_COLUMN.ready,
  },
  {
    name: "implementer_start from review",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) => implementerStart(ws, { sliceId: id }, opts),
    expectColumn: "review",
    expectAllowed: ALLOWED_BY_COLUMN.review,
  },
  {
    name: "reviewer_verdict from verify",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      reviewerVerdict(ws, { sliceId: id, verdict: "approve" }, opts),
    expectColumn: "verify",
    expectAllowed: ALLOWED_BY_COLUMN.verify,
  },
  {
    name: "verifier_verdict from review",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "pass" }, opts),
    expectColumn: "review",
    expectAllowed: ALLOWED_BY_COLUMN.review,
  },
  {
    name: "human_unblock from ready",
    setup: ["ready"],
    run: (ws, id, opts) => humanUnblock(ws, { sliceId: id }, opts),
    expectColumn: "ready",
    expectAllowed: ALLOWED_BY_COLUMN.ready,
  },
  {
    name: "unknown reviewer verdict",
    setup: ["ready", "approve", "start", "submit"],
    run: (ws, id, opts) =>
      reviewerVerdict(ws, { sliceId: id, verdict: "ship_it" }, opts),
    expectColumn: "review",
    expectAllowed: ALLOWED_BY_COLUMN.review,
    match: /unknown reviewer verdict/,
  },
  {
    name: "unknown verifier verdict",
    setup: ["ready", "approve", "start", "submit", "reviewApprove"],
    run: (ws, id, opts) =>
      verifierVerdict(ws, { sliceId: id, verdict: "meh" }, opts),
    expectColumn: "verify",
    expectAllowed: ALLOWED_BY_COLUMN.verify,
    match: /unknown verifier verdict/,
  },
];

for (const edge of ILLEGAL_EDGES) {
  test(`illegal: ${edge.name}`, async () => {
    await withTempRoot(async (dataRoot) => {
      const { ws, initiative, opts } = await seedInitiative(dataRoot);
      const sliceId = await advance(ws, initiative.id, opts, edge.setup);
      await assert.rejects(
        () => edge.run(ws, sliceId, opts),
        (err) => {
          assert.ok(err instanceof TransitionError);
          assert.equal(err.column, edge.expectColumn);
          assert.deepEqual(err.allowedActions, [...edge.expectAllowed]);
          if (edge.match) assert.match(err.message, edge.match);
          else assert.match(err.message, /allowed:/);
          return true;
        },
      );
    });
  });
}

test("park sets initiative parked; derive preserves parked", async () => {
  await withTempRoot(async (dataRoot) => {
    const { ws, initiative, opts } = await seedInitiative(dataRoot);
    await sliceAdd(ws, { initiativeId: initiative.id, title: "S1" }, opts);
    const { initiative: parked } = await park(
      ws,
      { initiativeId: initiative.id, reason: "pause" },
      opts,
    );
    assert.equal(parked.status, "parked");
    assert.equal(
      deriveInitiativeStatus(parked, [
        {
          id: "x",
          initiativeId: initiative.id,
          title: "t",
          column: "implement",
          evidence: [],
          history: [],
        },
      ]),
      "parked",
    );
  });
});

test("allowedActionsForColumn matches table", () => {
  assert.deepEqual(allowedActionsForColumn("ready"), [ACTIONS.SLICE_APPROVE]);
  assert.deepEqual(allowedActionsForColumn("done"), []);
  assert.deepEqual(allowedActionsForColumn("blocked"), [
    ACTIONS.HUMAN_UNBLOCK,
  ]);
});

test("deriveInitiativeStatus: planning→building on in-flight; no auto done", () => {
  const init = {
    id: "i1",
    planPath: "p",
    title: "t",
    blurb: "",
    status: "planning",
    updatedAt: "",
  };
  assert.equal(
    deriveInitiativeStatus(init, [
      {
        id: "s",
        initiativeId: "i1",
        title: "a",
        column: "ready",
        evidence: [],
        history: [],
      },
    ]),
    "planning",
  );
  assert.equal(
    deriveInitiativeStatus(init, [
      {
        id: "s",
        initiativeId: "i1",
        title: "a",
        column: "review",
        evidence: [],
        history: [],
      },
    ]),
    "building",
  );
  assert.equal(
    deriveInitiativeStatus(
      { ...init, status: "integrating" },
      [
        {
          id: "s",
          initiativeId: "i1",
          title: "a",
          column: "done",
          evidence: [],
          history: [],
        },
      ],
    ),
    "integrating",
  );
});
