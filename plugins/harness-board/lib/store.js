import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** @typedef {"planning" | "building" | "integrating" | "done" | "parked"} InitiativeStatus */
/** @typedef {"ready" | "approved" | "implement" | "review" | "verify" | "done" | "blocked"} SliceColumn */

/**
 * @typedef {object} Initiative
 * @property {string} id
 * @property {string} planPath
 * @property {string} title
 * @property {string} blurb
 * @property {InitiativeStatus} status
 * @property {string} updatedAt ISO-8601
 */

/**
 * @typedef {object} Slice
 * @property {string} id
 * @property {string} initiativeId
 * @property {string} title
 * @property {SliceColumn} column
 * @property {string} [notes]
 * @property {string[]} [checklist]
 * @property {unknown[]} evidence
 * @property {unknown[]} history
 */

/**
 * @typedef {object} BoardState
 * @property {string} workspacePath
 * @property {Initiative[]} initiatives
 * @property {Slice[]} slices
 * @property {string} updatedAt ISO-8601
 */

/**
 * @typedef {object} StoreOptions
 * @property {string} [dataRoot] Override root (default `~/.cursor/harness-board`)
 */

const INITIATIVE_STATUSES = new Set([
  "planning",
  "building",
  "integrating",
  "done",
  "parked",
]);

/**
 * @param {string} workspacePath
 * @returns {string}
 */
export function workspaceHash(workspacePath) {
  return createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
}

/**
 * @param {string} [dataRoot]
 * @returns {string}
 */
export function defaultDataRoot(dataRoot) {
  return dataRoot ?? join(homedir(), ".cursor", "harness-board");
}

/**
 * @param {string} workspacePath
 * @param {StoreOptions} [options]
 * @returns {string}
 */
export function statePathFor(workspacePath, options = {}) {
  const root = defaultDataRoot(options.dataRoot);
  return join(root, workspaceHash(workspacePath), "state.json");
}

/**
 * @param {string} workspacePath
 * @returns {BoardState}
 */
export function emptyState(workspacePath) {
  return {
    workspacePath,
    initiatives: [],
    slices: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {string} workspacePath
 * @param {StoreOptions} [options]
 * @returns {Promise<BoardState>}
 */
export async function loadState(workspacePath, options = {}) {
  const path = statePathFor(workspacePath, options);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(workspacePath, parsed);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return emptyState(workspacePath);
    }
    throw err;
  }
}

/**
 * @param {BoardState} state
 * @param {StoreOptions} [options]
 * @returns {Promise<void>}
 */
export async function saveState(state, options = {}) {
  const path = statePathFor(state.workspacePath, options);
  await mkdir(dirname(path), { recursive: true });
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/**
 * Load (or create empty), return current state.
 * @param {string} workspacePath
 * @param {StoreOptions} [options]
 * @returns {Promise<BoardState>}
 */
export async function getState(workspacePath, options = {}) {
  return loadState(workspacePath, options);
}

/**
 * Create or update an initiative by id (or by planPath when id omitted and a match exists).
 * @param {string} workspacePath
 * @param {Partial<Initiative> & { planPath: string, title: string }} input
 * @param {StoreOptions} [options]
 * @returns {Promise<{ state: BoardState, initiative: Initiative }>}
 */
export async function upsertInitiative(workspacePath, input, options = {}) {
  const state = await loadState(workspacePath, options);
  const now = new Date().toISOString();

  let initiative = null;
  if (input.id) {
    initiative = state.initiatives.find((i) => i.id === input.id) ?? null;
  }
  if (!initiative && input.planPath) {
    initiative = state.initiatives.find((i) => i.planPath === input.planPath) ?? null;
  }

  if (initiative) {
    initiative.planPath = input.planPath ?? initiative.planPath;
    initiative.title = input.title ?? initiative.title;
    initiative.blurb = input.blurb ?? initiative.blurb;
    // Preserve existing status when omitted on update.
    if (input.status !== undefined) {
      if (!INITIATIVE_STATUSES.has(input.status)) {
        throw new Error(`invalid initiative status: ${input.status}`);
      }
      initiative.status = input.status;
    }
    initiative.updatedAt = now;
  } else {
    const status = input.status ?? "planning";
    if (!INITIATIVE_STATUSES.has(status)) {
      throw new Error(`invalid initiative status: ${status}`);
    }
    initiative = {
      id: input.id ?? randomUUID(),
      planPath: input.planPath,
      title: input.title,
      blurb: input.blurb ?? "",
      status,
      updatedAt: now,
    };
    state.initiatives.push(initiative);
  }

  state.updatedAt = now;
  await saveState(state, options);
  return { state, initiative };
}

/**
 * Add a slice in column `ready`.
 * @param {string} workspacePath
 * @param {{ initiativeId: string, title: string, notes?: string, checklist?: string[] }} input
 * @param {StoreOptions} [options]
 * @returns {Promise<{ state: BoardState, slice: Slice }>}
 */
export async function addSlice(workspacePath, input, options = {}) {
  const state = await loadState(workspacePath, options);
  const initiative = state.initiatives.find((i) => i.id === input.initiativeId);
  if (!initiative) {
    throw new Error(`unknown initiativeId: ${input.initiativeId}`);
  }

  /** @type {Slice} */
  const slice = {
    id: randomUUID(),
    initiativeId: input.initiativeId,
    title: input.title,
    column: "ready",
    evidence: [],
    history: [],
  };
  if (input.notes !== undefined) slice.notes = input.notes;
  if (input.checklist !== undefined) slice.checklist = input.checklist;

  state.slices.push(slice);
  state.updatedAt = new Date().toISOString();
  await saveState(state, options);
  return { state, slice };
}

/**
 * @param {string} workspacePath
 * @param {unknown} parsed
 * @returns {BoardState}
 */
function normalizeState(workspacePath, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return emptyState(workspacePath);
  }
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  return {
    workspacePath:
      typeof obj.workspacePath === "string" ? obj.workspacePath : workspacePath,
    initiatives: Array.isArray(obj.initiatives) ? /** @type {Initiative[]} */ (obj.initiatives) : [],
    slices: Array.isArray(obj.slices) ? /** @type {Slice[]} */ (obj.slices) : [],
    updatedAt:
      typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
  };
}
