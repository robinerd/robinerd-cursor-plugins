import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MUTATION_TOOLS,
  READ_TOOLS,
  TOOL_NAMES,
  callBoardTool,
  formatToolError,
  handleMcpTool,
  listToolNames,
} from "../lib/mcp.js";
import { ACTIONS, TransitionError } from "../lib/transitions.js";

const WORKSPACE = "D:\\workspace\\harness-board-mcp";

test("MCP tool names: read + mutations, no move_card", () => {
  const names = listToolNames();
  assert.deepEqual(names, [...TOOL_NAMES]);
  assert.ok(READ_TOOLS.includes("board_get"));
  assert.ok(READ_TOOLS.includes("list_slices"));
  for (const action of Object.values(ACTIONS)) {
    assert.ok(MUTATION_TOOLS.includes(action), `missing ${action}`);
    assert.ok(names.includes(action), `list missing ${action}`);
  }
  assert.equal(names.includes("move_card"), false);
  assert.equal(names.includes("board_start"), false);
});

test("illegal move_card and bad args return structured allowedActions", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const move = await handleMcpTool(
      "move_card",
      { sliceId: "x", column: "done" },
      { workspacePath: WORKSPACE, dataRoot },
    );
    assert.equal(move.isError, true);
    const moveBody = JSON.parse(move.content[0].text);
    assert.equal(moveBody.ok, false);
    assert.match(moveBody.error, /move_card/);
    assert.ok(Array.isArray(moveBody.allowedActions));
    assert.ok(moveBody.allowedActions.includes("slice_approve"));

    const bad = await handleMcpTool(
      "slice_approve",
      {},
      { workspacePath: WORKSPACE, dataRoot },
    );
    assert.equal(bad.isError, true);
    const badBody = JSON.parse(bad.content[0].text);
    assert.equal(badBody.ok, false);
    assert.match(badBody.error, /sliceId/);
    assert.ok(Array.isArray(badBody.allowedActions));

    const formatted = formatToolError(
      new TransitionError("nope", {
        action: "slice_approve",
        column: "review",
        allowedActions: ["reviewer_verdict"],
      }),
    );
    assert.deepEqual(formatted.allowedActions, ["reviewer_verdict"]);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("board_get + mutation happy path via shared handlers", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const env = { workspacePath: WORKSPACE, dataRoot };
    const empty = await callBoardTool("board_get", {}, env);
    assert.equal(empty.ok, true);
    assert.equal(empty.state.slices.length, 0);

    const upsert = await callBoardTool(
      "initiative_upsert",
      {
        planPath: "plans/mcp.md",
        title: "MCP Initiative",
        blurb: "smoke",
      },
      env,
    );
    assert.equal(upsert.ok, true);
    const initiativeId = upsert.initiative.id;

    const add = await callBoardTool(
      "slice_add",
      { initiativeId, title: "S5 MCP" },
      env,
    );
    assert.equal(add.ok, true);
    assert.equal(add.slice.column, "ready");

    const listed = await callBoardTool(
      "list_slices",
      { initiativeId },
      env,
    );
    assert.equal(listed.ok, true);
    assert.equal(listed.slices.length, 1);
    assert.equal(listed.slices[0].title, "S5 MCP");

    const board = await callBoardTool("board_get", {}, env);
    assert.equal(board.state.initiatives.length, 1);
    assert.equal(board.state.slices.length, 1);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("tool name binds role: args.action cannot override tool name", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const env = { workspacePath: WORKSPACE, dataRoot };
    const upsert = await callBoardTool(
      "initiative_upsert",
      { planPath: "plans/mcp.md", title: "Bind", blurb: "x" },
      env,
    );
    const initiativeId = upsert.initiative.id;
    const add = await callBoardTool(
      "slice_add",
      { initiativeId, title: "override attempt" },
      env,
    );
    const sliceId = add.slice.id;

    // Caller tries to escalate to verifier_verdict via args — must stay slice_approve.
    const result = await handleMcpTool(
      "slice_approve",
      { sliceId, action: "verifier_verdict", verdict: "pass" },
      env,
    );
    assert.equal(result.isError, false, result.content?.[0]?.text);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.ok, true);
    assert.equal(body.slice.column, "approved");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("sanitizeWorkspacePath rejects unexpanded ${workspaceFolder}", async () => {
  const { resolve } = await import("node:path");
  const { isUnexpandedTemplate, sanitizeWorkspacePath } = await import(
    "../lib/mcp.js"
  );
  assert.equal(isUnexpandedTemplate("${workspaceFolder}"), true);
  assert.equal(
    isUnexpandedTemplate("C:\\Users\\robin\\${workspaceFolder}"),
    true,
  );
  assert.equal(isUnexpandedTemplate("D:\\robinerd-cursor-plugins"), false);
  const fallback = "D:\\robinerd-cursor-plugins";
  assert.equal(
    sanitizeWorkspacePath("${workspaceFolder}", fallback),
    resolve(fallback),
  );
  assert.equal(
    sanitizeWorkspacePath("C:\\Users\\robin\\${workspaceFolder}", fallback),
    resolve(fallback),
  );
});
