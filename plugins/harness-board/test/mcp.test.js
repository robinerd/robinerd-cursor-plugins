import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const WORKSPACE_B = "D:\\workspace\\harness-board-mcp-b";

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
      { workspace: WORKSPACE, sliceId: "x", column: "done" },
      { dataRoot },
    );
    assert.equal(move.isError, true);
    const moveBody = JSON.parse(move.content[0].text);
    assert.equal(moveBody.ok, false);
    assert.match(moveBody.error, /move_card/);
    assert.ok(Array.isArray(moveBody.allowedActions));
    assert.ok(moveBody.allowedActions.includes("slice_approve"));

    const bad = await handleMcpTool(
      "slice_approve",
      { workspace: WORKSPACE },
      { dataRoot },
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

test("missing or invalid workspace returns structured error", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  const prev = process.env.HARNESS_BOARD_WORKSPACE;
  process.env.HARNESS_BOARD_WORKSPACE = WORKSPACE;
  try {
    const missing = await handleMcpTool("board_get", {}, { dataRoot });
    assert.equal(missing.isError, true);
    const missingBody = JSON.parse(missing.content[0].text);
    assert.equal(missingBody.ok, false);
    assert.match(missingBody.error, /workspace is required/i);

    const empty = await handleMcpTool(
      "board_get",
      { workspace: "  " },
      { dataRoot },
    );
    assert.equal(empty.isError, true);
    assert.match(
      JSON.parse(empty.content[0].text).error,
      /workspace is required/i,
    );

    const unexpanded = await handleMcpTool(
      "board_get",
      { workspace: "${workspaceFolder}" },
      { dataRoot },
    );
    assert.equal(unexpanded.isError, true);
    assert.match(
      JSON.parse(unexpanded.content[0].text).error,
      /unexpanded template/i,
    );
  } finally {
    if (prev === undefined) delete process.env.HARNESS_BOARD_WORKSPACE;
    else process.env.HARNESS_BOARD_WORKSPACE = prev;
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("board_get + mutation happy path via shared handlers", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const env = { dataRoot };
    const empty = await callBoardTool(
      "board_get",
      { workspace: WORKSPACE },
      env,
    );
    assert.equal(empty.ok, true);
    assert.equal(empty.state.slices.length, 0);

    const upsert = await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE,
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
      { workspace: WORKSPACE, initiativeId, title: "S5 MCP" },
      env,
    );
    assert.equal(add.ok, true);
    assert.equal(add.slice.column, "ready");

    const listed = await callBoardTool(
      "list_slices",
      { workspace: WORKSPACE, initiativeId },
      env,
    );
    assert.equal(listed.ok, true);
    assert.equal(listed.slices.length, 1);
    assert.equal(listed.slices[0].title, "S5 MCP");

    const board = await callBoardTool(
      "board_get",
      { workspace: WORKSPACE },
      env,
    );
    assert.equal(board.state.initiatives.length, 1);
    assert.equal(board.state.slices.length, 1);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("cross-workspace A vs B use independent store buckets", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const env = { dataRoot };
    await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE,
        planPath: "plans/a.md",
        title: "Board A",
        blurb: "a",
      },
      env,
    );
    await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE_B,
        planPath: "plans/b.md",
        title: "Board B",
        blurb: "b",
      },
      env,
    );

    const a = await callBoardTool("board_get", { workspace: WORKSPACE }, env);
    const b = await callBoardTool(
      "board_get",
      { workspace: WORKSPACE_B },
      env,
    );
    assert.equal(a.state.initiatives.length, 1);
    assert.equal(a.state.initiatives[0].title, "Board A");
    assert.equal(b.state.initiatives.length, 1);
    assert.equal(b.state.initiatives[0].title, "Board B");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("MCP path does not write active-workspace.txt", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  const pointer = join(dataRoot, "active-workspace.txt");
  try {
    await callBoardTool(
      "board_get",
      { workspace: WORKSPACE },
      { dataRoot },
    );
    await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE,
        planPath: "plans/mcp.md",
        title: "No pointer",
        blurb: "x",
      },
      { dataRoot },
    );
    let exists = true;
    try {
      await access(pointer, constants.F_OK);
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("tool name binds role: args.action cannot override tool name", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-mcp-"));
  try {
    const env = { dataRoot };
    const upsert = await callBoardTool(
      "initiative_upsert",
      {
        workspace: WORKSPACE,
        planPath: "plans/mcp.md",
        title: "Bind",
        blurb: "x",
      },
      env,
    );
    const initiativeId = upsert.initiative.id;
    const add = await callBoardTool(
      "slice_add",
      { workspace: WORKSPACE, initiativeId, title: "override attempt" },
      env,
    );
    const sliceId = add.slice.id;

    // Caller tries to escalate to verifier_verdict via args — must stay slice_approve.
    const result = await handleMcpTool(
      "slice_approve",
      { workspace: WORKSPACE, sliceId, action: "verifier_verdict", verdict: "pass" },
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
  const { homedir } = await import("node:os");
  const {
    isUnexpandedTemplate,
    sanitizeWorkspacePath,
    rememberActiveWorkspace,
    resolveExplicitWorkspace,
  } = await import("../lib/mcp.js");

  assert.equal(isUnexpandedTemplate("${workspaceFolder}"), true);
  assert.equal(
    isUnexpandedTemplate("C:\\Users\\robin\\${workspaceFolder}"),
    true,
  );
  assert.equal(isUnexpandedTemplate("D:\\robinerd-cursor-plugins"), false);

  const dataRoot = await mkdtemp(join(tmpdir(), "harness-board-ws-"));
  const project = resolve("D:\\robinerd-cursor-plugins");
  rememberActiveWorkspace(project, dataRoot);

  assert.equal(
    sanitizeWorkspacePath("${workspaceFolder}", resolve(homedir()), dataRoot),
    project,
  );
  assert.equal(
    sanitizeWorkspacePath(
      "C:\\Users\\robin\\${workspaceFolder}",
      resolve(homedir()),
      dataRoot,
    ),
    project,
  );
  assert.equal(
    sanitizeWorkspacePath(project, resolve(homedir()), dataRoot),
    project,
  );

  assert.equal(resolveExplicitWorkspace(project), project);
  assert.throws(
    () => resolveExplicitWorkspace("${workspaceFolder}"),
    /unexpanded template/i,
  );
  assert.throws(() => resolveExplicitWorkspace(""), /workspace is required/i);

  await rm(dataRoot, { recursive: true, force: true });
});
