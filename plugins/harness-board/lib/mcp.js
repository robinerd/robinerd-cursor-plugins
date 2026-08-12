import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getState } from "./store.js";
import { dispatchAction } from "./server.js";
import { ACTIONS, TransitionError } from "./transitions.js";
import {
  isUnexpandedTemplate,
  resolveExplicitWorkspace,
} from "./workspace.js";

export {
  isUnexpandedTemplate,
  rememberActiveWorkspace,
  readActiveWorkspace,
  resolveExplicitWorkspace,
  sanitizeWorkspacePath,
} from "./workspace.js";

/** @typedef {import("./store.js").StoreOptions} StoreOptions */

/** Read tools (not transition actions). */
export const READ_TOOLS = Object.freeze(["board_get", "list_slices"]);

/** Named mutation tools — tool name binds role (no move_card). */
export const MUTATION_TOOLS = Object.freeze(Object.values(ACTIONS));

/** All exposed MCP tool names. */
export const TOOL_NAMES = Object.freeze([...READ_TOOLS, ...MUTATION_TOOLS]);

/** Required on every MCP tool schema. */
const workspaceArg = z.string();

/**
 * @returns {string[]}
 */
export function listToolNames() {
  return [...TOOL_NAMES];
}

/**
 * @param {unknown} err
 * @returns {{ ok: false, error: string, action?: string | null, column?: string | null, allowedActions?: string[], sliceId?: string | null }}
 */
export function formatToolError(err) {
  if (err instanceof TransitionError) {
    return {
      ok: false,
      error: err.message,
      action: err.action,
      column: err.column,
      allowedActions: err.allowedActions,
      sliceId: err.sliceId,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

/**
 * @param {unknown} payload
 * @param {boolean} [isError]
 */
function textResult(payload, isError = false) {
  return {
    isError,
    content: [
      {
        type: /** @type {const} */ ("text"),
        text: `${JSON.stringify(payload, null, 2)}\n`,
      },
    ],
  };
}

/**
 * Resolve optional store data root from env (or overrides).
 * Does not resolve workspace — MCP tools take `workspace` from args only.
 * @param {{ dataRoot?: string }} [overrides]
 * @returns {StoreOptions}
 */
export function resolveBoardEnv(overrides = {}) {
  const dataRootRaw =
    overrides.dataRoot ?? process.env.HARNESS_BOARD_DATA_ROOT ?? undefined;
  /** @type {StoreOptions} */
  const storeOptions = {};
  if (dataRootRaw && !isUnexpandedTemplate(dataRootRaw)) {
    storeOptions.dataRoot = resolve(dataRootRaw);
  }
  return storeOptions;
}

/**
 * Shared tool handler used by the stdio MCP server and smoke tests.
 * Workspace comes from `args.workspace` only (required). Env may supply dataRoot.
 * Never reads HARNESS_BOARD_WORKSPACE or active-workspace.txt; never remembers active.
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {{ dataRoot?: string }} [env]
 */
export async function callBoardTool(name, args = {}, env = {}) {
  const storeOptions = resolveBoardEnv(env);
  const workspacePath = resolveExplicitWorkspace(args.workspace);
  const { workspace: _workspace, ...toolArgs } = args;

  if (name === "move_card") {
    throw new TransitionError(
      "unknown action: move_card; allowed: " + TOOL_NAMES.join(", "),
      { action: name, allowedActions: [...TOOL_NAMES] },
    );
  }

  if (name === "board_get") {
    const state = await getState(workspacePath, storeOptions);
    return { ok: true, state };
  }

  if (name === "list_slices") {
    const state = await getState(workspacePath, storeOptions);
    let slices = state.slices;
    if (typeof toolArgs.initiativeId === "string" && toolArgs.initiativeId) {
      slices = slices.filter((s) => s.initiativeId === toolArgs.initiativeId);
    }
    return { ok: true, slices };
  }

  if (!MUTATION_TOOLS.includes(name)) {
    throw new TransitionError(
      `unknown action: ${name}; allowed: ${TOOL_NAMES.join(", ")}`,
      { action: name, allowedActions: [...TOOL_NAMES] },
    );
  }

  // Tool name binds role — never let args.action override `name`.
  const result = await dispatchAction(
    workspacePath,
    { ...toolArgs, action: name },
    storeOptions,
  );
  return { ok: true, ...result };
}

/**
 * MCP tool wrapper: structured JSON text; TransitionError → isError + allowedActions.
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @param {{ dataRoot?: string }} [env]
 */
export async function handleMcpTool(name, args = {}, env = {}) {
  try {
    const payload = await callBoardTool(name, args, env);
    return textResult(payload, false);
  } catch (err) {
    return textResult(formatToolError(err), true);
  }
}

/**
 * Build stdio-ready McpServer with named board tools.
 * Tools require per-call `workspace`; env may only supply dataRoot for the store.
 * @param {{ dataRoot?: string }} [env]
 */
export function createHarnessBoardMcpServer(env = {}) {
  const server = new McpServer({
    name: "harness-board",
    version: "0.1.0",
  });

  const run = (name) => async (args) =>
    handleMcpTool(name, /** @type {Record<string, unknown>} */ (args ?? {}), env);

  server.tool(
    "board_get",
    "Read full harness-board state for the given workspace (initiatives + slices).",
    { workspace: workspaceArg },
    run("board_get"),
  );

  server.tool(
    "list_slices",
    "List slice cards for the given workspace; optional initiativeId filter.",
    { workspace: workspaceArg, initiativeId: z.string().optional() },
    run("list_slices"),
  );

  server.tool(
    "initiative_upsert",
    "Create or update an initiative swimlane header (orchestrator).",
    {
      workspace: workspaceArg,
      planPath: z.string(),
      title: z.string(),
      id: z.string().optional(),
      blurb: z.string().optional(),
      status: z
        .enum(["planning", "building", "integrating", "done", "parked"])
        .optional(),
    },
    run("initiative_upsert"),
  );

  server.tool(
    "slice_add",
    "Add a slice card in column ready (orchestrator).",
    {
      workspace: workspaceArg,
      initiativeId: z.string(),
      title: z.string(),
      notes: z.string().optional(),
      checklist: z.array(z.string()).optional(),
    },
    run("slice_add"),
  );

  server.tool(
    "slice_approve",
    "Approve a ready slice → approved (orchestrator).",
    {
      workspace: workspaceArg,
      sliceId: z.string(),
      note: z.string().optional(),
    },
    run("slice_approve"),
  );

  server.tool(
    "implementer_start",
    "Start or retry implement work: approved|implement → implement.",
    { workspace: workspaceArg, sliceId: z.string() },
    run("implementer_start"),
  );

  server.tool(
    "implementer_submit",
    "Submit implement work: implement → review.",
    {
      workspace: workspaceArg,
      sliceId: z.string(),
      summary: z.string(),
      filesTouched: z.array(z.string()).optional(),
    },
    run("implementer_submit"),
  );

  server.tool(
    "reviewer_verdict",
    "Reviewer verdict: approve→verify, revise→implement, bounce→blocked.",
    {
      workspace: workspaceArg,
      sliceId: z.string(),
      verdict: z.enum(["approve", "revise", "bounce"]),
      findings: z.unknown().optional(),
    },
    run("reviewer_verdict"),
  );

  server.tool(
    "verifier_verdict",
    "Verifier verdict: pass→done, fail→implement, bounce|replan→blocked.",
    {
      workspace: workspaceArg,
      sliceId: z.string(),
      verdict: z.enum(["pass", "fail", "bounce", "replan"]),
      evidence: z.unknown().optional(),
    },
    run("verifier_verdict"),
  );

  server.tool(
    "human_unblock",
    "Unblock a slice: blocked → implement.",
    {
      workspace: workspaceArg,
      sliceId: z.string(),
      reason: z.string().optional(),
    },
    run("human_unblock"),
  );

  server.tool(
    "park",
    "Park an initiative (explicit status).",
    {
      workspace: workspaceArg,
      initiativeId: z.string(),
      reason: z.string().optional(),
    },
    run("park"),
  );

  return server;
}
