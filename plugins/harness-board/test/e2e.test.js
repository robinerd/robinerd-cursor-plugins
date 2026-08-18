import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBoardServer } from "../lib/server.js";
import { loadState } from "../lib/store.js";
import { ACTIONS } from "../lib/transitions.js";

/** Fixed workspace path for this drive (store key); data lives under temp dataRoot. */
const WORKSPACE = "D:\\workspace\\harness-board-e2e";

/**
 * @param {string} url
 * @param {Record<string, unknown>} body
 */
async function postAction(url, body) {
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

/**
 * @param {string} url
 */
async function getState(url) {
  const res = await fetch(`${url}/api/state`);
  assert.equal(res.status, 200);
  return res.json();
}

/**
 * Bind ephemeral port in-process (no CLI spawn; quiet vs startBoardServer console.log).
 * @param {{ workspacePath: string, dataRoot: string }} options
 * @returns {Promise<{ server: import("node:http").Server, url: string, port: number }>}
 */
function listenBoard(options) {
  const host = "127.0.0.1";
  const server = createBoardServer(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind server"));
        return;
      }
      const port = addr.port;
      resolve({ server, url: `http://${host}:${port}`, port });
    });
  });
}

/**
 * @param {(ctx: { url: string, dataRoot: string, port: number }) => Promise<void>} fn
 */
async function withServer(fn) {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-e2e-"));
  /** @type {import("node:http").Server | null} */
  let server = null;
  try {
    const started = await listenBoard({
      workspacePath: WORKSPACE,
      dataRoot,
    });
    server = started.server;
    await fn({ url: started.url, dataRoot, port: started.port });
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await rm(dataRoot, { recursive: true, force: true });
  }
}

test("e2e happy path: upsert → … → done + HTML markers + persistence", async () => {
  await withServer(async ({ url, dataRoot }) => {
    const title = "E2E Board Initiative";
    const blurb = "Drive-script coverage for harness-board";
    const planPath = "plans/harness-board.md";
    const sliceTitle = "S4 Drive script";

    const upsert = await postAction(url, {
      action: ACTIONS.INITIATIVE_UPSERT,
      planPath,
      title,
      blurb,
      status: "planning",
    });
    assert.equal(upsert.status, 200);
    assert.equal(upsert.json.ok, true);
    const initiativeId = upsert.json.initiative.id;
    assert.ok(initiativeId);

    const add = await postAction(url, {
      action: ACTIONS.SLICE_ADD,
      initiativeId,
      title: sliceTitle,
    });
    assert.equal(add.status, 200);
    assert.equal(add.json.ok, true);
    const sliceId = add.json.slice.id;
    assert.equal(add.json.slice.column, "ready");

    const approve = await postAction(url, {
      action: ACTIONS.SLICE_APPROVE,
      sliceId,
      note: "mass-approve",
    });
    assert.equal(approve.status, 200);
    assert.equal(approve.json.slice.column, "approved");

    const start = await postAction(url, {
      action: ACTIONS.IMPLEMENTER_START,
      sliceId,
    });
    assert.equal(start.status, 200);
    assert.equal(start.json.slice.column, "implement");

    const submit = await postAction(url, {
      action: ACTIONS.IMPLEMENTER_SUBMIT,
      sliceId,
      summary: "e2e drive implemented",
      filesTouched: ["test/e2e.test.js"],
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.json.slice.column, "review");

    const review = await postAction(url, {
      action: ACTIONS.REVIEWER_VERDICT,
      sliceId,
      verdict: "approve",
      findings: [],
    });
    assert.equal(review.status, 200);
    assert.equal(review.json.slice.column, "verify");

    const verify = await postAction(url, {
      action: ACTIONS.VERIFIER_VERDICT,
      sliceId,
      verdict: "pass",
      evidence: { check: "e2e" },
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.json.slice.column, "done");

    const state = await getState(url);
    const slice = state.slices.find((s) => s.id === sliceId);
    assert.ok(slice);
    assert.equal(slice.column, "done");
    assert.equal(slice.title, sliceTitle);
    const initiative = state.initiatives.find((i) => i.id === initiativeId);
    assert.ok(initiative);
    assert.equal(initiative.title, title);
    assert.equal(initiative.blurb, blurb);
    assert.equal(initiative.planPath, planPath);

    const htmlRes = await fetch(`${url}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /E2E Board Initiative/);
    assert.match(html, /Drive-script coverage for harness-board/);
    assert.match(html, /data-plan-link/);
    assert.match(html, /plans\/harness-board\.md/);
    assert.match(html, /\/api\/plan\?/);

    // Path traversal must be rejected:
    const trav = await fetch(
      `${url}/api/plan?workspace=${encodeURIComponent(WORKSPACE)}&path=${encodeURIComponent("../secrets.txt")}`,
    );
    assert.equal(trav.status, 400);
    assert.match(
      html,
      new RegExp(
        `data-slice-id="${sliceId}"[^>]*data-column="done"|data-column="done"[^>]*data-slice-id="${sliceId}"`,
      ),
    );
    assert.match(html, /S4 Drive script/);
    assert.match(
      html,
      new RegExp(`data-initiative-id="${initiativeId}"`),
    );

    // Persistence: reload from same dataRoot without going through in-memory cache.
    const disk = await loadState(WORKSPACE, { dataRoot });
    assert.equal(disk.slices.find((s) => s.id === sliceId)?.column, "done");
    assert.equal(disk.initiatives.find((i) => i.id === initiativeId)?.title, title);

    const stateAgain = await getState(url);
    assert.equal(stateAgain.slices.find((s) => s.id === sliceId)?.column, "done");
  });
});

test("e2e attention: awaitingHuman dots persist on GET; Active-only has no marker", async () => {
  await withServer(async ({ url }) => {
    const upsert = await postAction(url, {
      action: ACTIONS.INITIATIVE_UPSERT,
      planPath: "plans/attention.md",
      title: "Needs a human",
      status: "planning",
      awaitingHuman: true,
    });
    assert.equal(upsert.status, 200);
    const initiativeId = upsert.json.initiative.id;
    assert.equal(upsert.json.initiative.awaitingHuman, true);

    const htmlRes = await fetch(`${url}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(
      html,
      new RegExp(
        `data-initiative-id="${initiativeId}"[^>]*data-attention="true"`,
      ),
    );
    assert.match(html, /class="nav-item[^"]*has-attention/);
    assert.match(html, /nav-item[^>]*data-attention="true"/);
    assert.match(html, /class="nav-dot"/);
    assert.match(html, /nav-pill/);

    const htmlAgain = await (await fetch(`${url}/`)).text();
    assert.match(
      htmlAgain,
      new RegExp(
        `data-initiative-id="${initiativeId}"[^>]*data-attention="true"`,
      ),
    );
    assert.match(htmlAgain, /nav-item[^>]*data-attention="true"/);

    const boardsRes = await fetch(`${url}/api/boards`);
    assert.equal(boardsRes.status, 200);
    const boardsJson = await boardsRes.json();
    assert.ok(boardsJson.boards.length >= 1);
    const board = boardsJson.boards[0];
    assert.equal(board.hasAttention, true);
    assert.equal(board.attention, true);
    assert.equal(board.active, true);
    assert.equal(board.hasActiveWork, true);

    const clear = await postAction(url, {
      action: ACTIONS.INITIATIVE_UPSERT,
      id: initiativeId,
      planPath: "plans/attention.md",
      title: "Needs a human",
      status: "planning",
      awaitingHuman: false,
    });
    assert.equal(clear.status, 200);
    assert.equal(clear.json.initiative.awaitingHuman, false);

    const activeOnly = await (await fetch(`${url}/`)).text();
    assert.match(activeOnly, /nav-pill/);
    assert.match(activeOnly, />active</);
    assert.doesNotMatch(activeOnly, /data-attention/);
    assert.doesNotMatch(activeOnly, /has-attention/);
    assert.doesNotMatch(activeOnly, /class="nav-dot"/);

    const boardsClear = await (await fetch(`${url}/api/boards`)).json();
    const boardClear = boardsClear.boards[0];
    assert.equal(boardClear.hasAttention, false);
    assert.equal(boardClear.attention, false);
    assert.equal(boardClear.active, true);
  });
});

test("e2e illegal: move_card rejected with allowedActions", async () => {
  await withServer(async ({ url }) => {
    const upsert = await postAction(url, {
      action: ACTIONS.INITIATIVE_UPSERT,
      planPath: "plans/x.md",
      title: "Illegal paths",
      blurb: "reject freeform moves",
    });
    assert.equal(upsert.status, 200);

    const rejected = await postAction(url, {
      action: "move_card",
      sliceId: "whatever",
      column: "done",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.ok, false);
    assert.match(rejected.json.error, /unknown action|move_card/i);
    assert.ok(Array.isArray(rejected.json.allowedActions));
    assert.ok(rejected.json.allowedActions.includes(ACTIONS.INITIATIVE_UPSERT));
    assert.ok(!rejected.json.allowedActions.includes("move_card"));
  });
});

test("e2e illegal: wrong-column action rejected with allowedActions", async () => {
  await withServer(async ({ url }) => {
    const upsert = await postAction(url, {
      action: ACTIONS.INITIATIVE_UPSERT,
      planPath: "plans/wrong-col.md",
      title: "Wrong column",
      blurb: "column guard",
    });
    const initiativeId = upsert.json.initiative.id;

    const add = await postAction(url, {
      action: ACTIONS.SLICE_ADD,
      initiativeId,
      title: "stuck in ready",
    });
    const sliceId = add.json.slice.id;
    assert.equal(add.json.slice.column, "ready");

    // implementer_submit only valid from implement
    const bad = await postAction(url, {
      action: ACTIONS.IMPLEMENTER_SUBMIT,
      sliceId,
      summary: "should fail",
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.ok, false);
    assert.match(bad.json.error, /not allowed from column ready/i);
    assert.equal(bad.json.column, "ready");
    assert.ok(Array.isArray(bad.json.allowedActions));
    assert.deepEqual(bad.json.allowedActions, [ACTIONS.SLICE_APPROVE]);
    assert.equal(bad.json.sliceId, sliceId);

    // Still ready after rejection
    const state = await getState(url);
    assert.equal(state.slices.find((s) => s.id === sliceId)?.column, "ready");
  });
});
