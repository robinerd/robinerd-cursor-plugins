import {
  addSlice as storeAddSlice,
  loadState,
  saveState,
  upsertInitiative as storeUpsertInitiative,
} from "./store.js";

/** @typedef {import("./store.js").BoardState} BoardState */
/** @typedef {import("./store.js").Initiative} Initiative */
/** @typedef {import("./store.js").InitiativeStatus} InitiativeStatus */
/** @typedef {import("./store.js").Slice} Slice */
/** @typedef {import("./store.js").SliceColumn} SliceColumn */
/** @typedef {import("./store.js").StoreOptions} StoreOptions */

/** Named actions — tool name binds role (no freeform move_card). */
export const ACTIONS = Object.freeze({
  INITIATIVE_UPSERT: "initiative_upsert",
  SLICE_ADD: "slice_add",
  SLICE_APPROVE: "slice_approve",
  IMPLEMENTER_START: "implementer_start",
  IMPLEMENTER_SUBMIT: "implementer_submit",
  REVIEWER_VERDICT: "reviewer_verdict",
  VERIFIER_VERDICT: "verifier_verdict",
  HUMAN_UNBLOCK: "human_unblock",
  PARK: "park",
});

/** @type {readonly SliceColumn[]} */
export const SLICE_COLUMNS = Object.freeze([
  "ready",
  "approved",
  "implement",
  "review",
  "verify",
  "done",
  "blocked",
]);

/** Columns that mean work is in flight → derive initiative `building`. */
const IN_FLIGHT_COLUMNS = new Set([
  "approved",
  "implement",
  "review",
  "verify",
  "blocked",
]);

/**
 * Slice-column → allowed named actions (initiative-level actions omitted).
 * @type {Readonly<Record<SliceColumn, readonly string[]>>}
 */
export const ALLOWED_BY_COLUMN = Object.freeze({
  ready: Object.freeze([ACTIONS.SLICE_APPROVE]),
  approved: Object.freeze([ACTIONS.IMPLEMENTER_START]),
  implement: Object.freeze([
    ACTIONS.IMPLEMENTER_START,
    ACTIONS.IMPLEMENTER_SUBMIT,
  ]),
  review: Object.freeze([ACTIONS.REVIEWER_VERDICT]),
  verify: Object.freeze([ACTIONS.VERIFIER_VERDICT]),
  done: Object.freeze([]),
  blocked: Object.freeze([ACTIONS.HUMAN_UNBLOCK]),
});

const REVIEWER_VERDICTS = new Set(["approve", "revise", "bounce"]);
const VERIFIER_VERDICTS = new Set(["pass", "fail", "bounce", "replan"]);

/**
 * Structured transition failure with allowed actions for the current column.
 */
export class TransitionError extends Error {
  /**
   * @param {string} message
   * @param {{ action?: string, column?: string | null, allowedActions?: string[], sliceId?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "TransitionError";
    this.action = details.action ?? null;
    this.column = details.column ?? null;
    this.allowedActions = details.allowedActions ?? [];
    this.sliceId = details.sliceId ?? null;
  }
}

/**
 * @param {SliceColumn | string | null | undefined} column
 * @returns {string[]}
 */
export function allowedActionsForColumn(column) {
  if (!column || !(column in ALLOWED_BY_COLUMN)) return [];
  return [...ALLOWED_BY_COLUMN[/** @type {SliceColumn} */ (column)]];
}

/**
 * Derive coarse initiative status where obvious.
 * Upgrades planning→building when slices are in flight; never auto-sets
 * integrating/done (orchestrator sets those). Preserves parked.
 *
 * @param {Initiative} initiative
 * @param {Slice[]} slices
 * @returns {InitiativeStatus}
 */
export function deriveInitiativeStatus(initiative, slices) {
  if (initiative.status === "parked") return "parked";
  if (
    initiative.status === "integrating" ||
    initiative.status === "done"
  ) {
    return initiative.status;
  }

  const mine = slices.filter((s) => s.initiativeId === initiative.id);
  const inFlight = mine.some((s) => IN_FLIGHT_COLUMNS.has(s.column));
  if (inFlight) return "building";
  return initiative.status === "building" ? "building" : "planning";
}

/**
 * @param {BoardState} state
 * @param {string} initiativeId
 */
function applyDerivedInitiativeStatus(state, initiativeId) {
  const initiative = state.initiatives.find((i) => i.id === initiativeId);
  if (!initiative) return;
  const next = deriveInitiativeStatus(initiative, state.slices);
  if (next !== initiative.status) {
    initiative.status = next;
    initiative.updatedAt = new Date().toISOString();
  }
}

/**
 * @param {string} action
 * @param {Slice} slice
 * @param {SliceColumn} from
 * @param {SliceColumn} to
 * @param {Record<string, unknown>} [extra]
 */
function appendHistory(slice, action, from, to, extra = {}) {
  slice.history.push({
    at: new Date().toISOString(),
    action,
    from,
    to,
    ...extra,
  });
}

/**
 * @param {string} workspacePath
 * @param {string} sliceId
 * @param {StoreOptions} [options]
 */
async function loadSliceContext(workspacePath, sliceId, options = {}) {
  const state = await loadState(workspacePath, options);
  const slice = state.slices.find((s) => s.id === sliceId);
  if (!slice) {
    throw new TransitionError(`unknown sliceId: ${sliceId}`, {
      sliceId,
      allowedActions: [],
    });
  }
  return { state, slice };
}

/**
 * @param {string} action
 * @param {Slice} slice
 * @param {readonly string[]} expectedFrom
 */
function assertFromColumn(action, slice, expectedFrom) {
  if (!expectedFrom.includes(slice.column)) {
    const allowed = allowedActionsForColumn(slice.column);
    throw new TransitionError(
      `action ${action} not allowed from column ${slice.column}; allowed: ${allowed.join(", ") || "(none)"}`,
      {
        action,
        column: slice.column,
        allowedActions: allowed,
        sliceId: slice.id,
      },
    );
  }
}

/**
 * Create/update initiative header (orchestrator).
 * @param {string} workspacePath
 * @param {Partial<Initiative> & { planPath: string, title: string }} input
 * @param {StoreOptions} [options]
 */
export async function initiativeUpsert(workspacePath, input, options = {}) {
  return storeUpsertInitiative(workspacePath, input, options);
}

/**
 * Add a slice in column `ready` and record history.
 * @param {string} workspacePath
 * @param {{ initiativeId: string, title: string, notes?: string, checklist?: string[] }} input
 * @param {StoreOptions} [options]
 */
export async function sliceAdd(workspacePath, input, options = {}) {
  const { state, slice } = await storeAddSlice(workspacePath, input, options);
  appendHistory(slice, ACTIONS.SLICE_ADD, "ready", "ready", {
    title: slice.title,
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  await saveState(state, options);
  return { state, slice };
}

/**
 * ready → approved
 * @param {string} workspacePath
 * @param {{ sliceId: string, note?: string }} input
 * @param {StoreOptions} [options]
 */
export async function sliceApprove(workspacePath, input, options = {}) {
  const action = ACTIONS.SLICE_APPROVE;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["ready"]);
  const from = slice.column;
  slice.column = "approved";
  appendHistory(slice, action, from, "approved", {
    note: input.note ?? "",
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * approved | implement → implement
 * @param {string} workspacePath
 * @param {{ sliceId: string }} input
 * @param {StoreOptions} [options]
 */
export async function implementerStart(workspacePath, input, options = {}) {
  const action = ACTIONS.IMPLEMENTER_START;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["approved", "implement"]);
  const from = slice.column;
  slice.column = "implement";
  appendHistory(slice, action, from, "implement");
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * implement → review
 * @param {string} workspacePath
 * @param {{ sliceId: string, summary: string, filesTouched?: string[] }} input
 * @param {StoreOptions} [options]
 */
export async function implementerSubmit(workspacePath, input, options = {}) {
  const action = ACTIONS.IMPLEMENTER_SUBMIT;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["implement"]);
  if (typeof input.summary !== "string" || !input.summary.trim()) {
    throw new TransitionError("implementer_submit requires summary", {
      action,
      column: slice.column,
      allowedActions: allowedActionsForColumn(slice.column),
      sliceId: slice.id,
    });
  }
  const from = slice.column;
  const filesTouched = Array.isArray(input.filesTouched)
    ? input.filesTouched
    : [];
  slice.column = "review";
  appendHistory(slice, action, from, "review", {
    summary: input.summary,
    filesTouched,
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * review → verify | implement | blocked
 * @param {string} workspacePath
 * @param {{ sliceId: string, verdict: "approve" | "revise" | "bounce", findings?: unknown }} input
 * @param {StoreOptions} [options]
 */
export async function reviewerVerdict(workspacePath, input, options = {}) {
  const action = ACTIONS.REVIEWER_VERDICT;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["review"]);

  const verdict = input.verdict;
  if (!REVIEWER_VERDICTS.has(verdict)) {
    throw new TransitionError(
      `unknown reviewer verdict: ${verdict}; allowed: approve, revise, bounce`,
      {
        action,
        column: slice.column,
        allowedActions: allowedActionsForColumn(slice.column),
        sliceId: slice.id,
      },
    );
  }

  /** @type {SliceColumn} */
  let to;
  if (verdict === "approve") to = "verify";
  else if (verdict === "revise") to = "implement";
  else to = "blocked";

  const from = slice.column;
  slice.column = to;
  appendHistory(slice, action, from, to, {
    verdict,
    findings: input.findings ?? null,
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * verify → done | implement | blocked
 * @param {string} workspacePath
 * @param {{ sliceId: string, verdict: "pass" | "fail" | "bounce" | "replan", evidence?: unknown }} input
 * @param {StoreOptions} [options]
 */
export async function verifierVerdict(workspacePath, input, options = {}) {
  const action = ACTIONS.VERIFIER_VERDICT;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["verify"]);

  const verdict = input.verdict;
  if (!VERIFIER_VERDICTS.has(verdict)) {
    throw new TransitionError(
      `unknown verifier verdict: ${verdict}; allowed: pass, fail, bounce, replan`,
      {
        action,
        column: slice.column,
        allowedActions: allowedActionsForColumn(slice.column),
        sliceId: slice.id,
      },
    );
  }

  /** @type {SliceColumn} */
  let to;
  if (verdict === "pass") to = "done";
  else if (verdict === "fail") to = "implement";
  else to = "blocked"; // bounce | replan

  const from = slice.column;
  slice.column = to;
  if (input.evidence !== undefined) {
    slice.evidence.push(input.evidence);
  }
  appendHistory(slice, action, from, to, {
    verdict,
    evidence: input.evidence ?? null,
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * blocked → implement (resume after human/escalate).
 * @param {string} workspacePath
 * @param {{ sliceId: string, reason?: string }} input
 * @param {StoreOptions} [options]
 */
export async function humanUnblock(workspacePath, input, options = {}) {
  const action = ACTIONS.HUMAN_UNBLOCK;
  const { state, slice } = await loadSliceContext(
    workspacePath,
    input.sliceId,
    options,
  );
  assertFromColumn(action, slice, ["blocked"]);
  const from = slice.column;
  slice.column = "implement";
  appendHistory(slice, action, from, "implement", {
    reason: input.reason ?? "",
  });
  applyDerivedInitiativeStatus(state, slice.initiativeId);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * Park an initiative (explicit status).
 * @param {string} workspacePath
 * @param {{ initiativeId: string, reason?: string }} input
 * @param {StoreOptions} [options]
 */
export async function park(workspacePath, input, options = {}) {
  const state = await loadState(workspacePath, options);
  const initiative = state.initiatives.find((i) => i.id === input.initiativeId);
  if (!initiative) {
    throw new TransitionError(
      `unknown initiativeId: ${input.initiativeId}`,
      { action: ACTIONS.PARK, allowedActions: [] },
    );
  }
  initiative.status = "parked";
  initiative.updatedAt = new Date().toISOString();
  state.updatedAt = initiative.updatedAt;
  await saveState(state, options);
  return { state, initiative, reason: input.reason ?? "" };
}
