import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expandHomePath } from "./workspace.js";

/** @typedef {"planning" | "building" | "integrating" | "done" | "parked"} InitiativeStatus */
/** @typedef {"ready" | "approved" | "implement" | "review" | "verify" | "done" | "blocked"} SliceColumn */

/**
 * @typedef {object} Initiative
 * @property {string} id
 * @property {string} planPath
 * @property {string} title
 * @property {string} blurb
 * @property {string} [nextSteps]
 * @property {InitiativeStatus} status
 * @property {boolean} [awaitingHuman] Human reply needed; missing treated as false
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
 * Expand `~` / collapse `/~/`, then resolve to an absolute store key.
 * @param {string} workspacePath
 * @returns {string}
 */
export function canonicalizeWorkspacePath(workspacePath) {
  return resolve(expandHomePath(workspacePath));
}

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
  const key = canonicalizeWorkspacePath(workspacePath);
  return join(root, workspaceHash(key), "state.json");
}

/**
 * @param {string} workspacePath
 * @returns {BoardState}
 */
export function emptyState(workspacePath) {
  return {
    workspacePath: canonicalizeWorkspacePath(workspacePath),
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
  const key = canonicalizeWorkspacePath(workspacePath);
  const path = statePathFor(key, options);
  /** @type {BoardState} */
  let state;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    // Always pin to the canonical load key so saveState cannot redirect.
    state = normalizeState(key, parsed);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      state = emptyState(key);
    } else {
      throw err;
    }
  }
  return consolidateOrphans(state, options);
}

/**
 * @param {BoardState} state
 * @param {StoreOptions} [options]
 * @returns {Promise<void>}
 */
export async function saveState(state, options = {}) {
  const key = canonicalizeWorkspacePath(state.workspacePath);
  const path = statePathFor(key, options);
  await mkdir(dirname(path), { recursive: true });
  const next = {
    ...state,
    workspacePath: key,
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
    if (input.nextSteps !== undefined) {
      initiative.nextSteps = input.nextSteps;
    }
    // Preserve existing status when omitted on update.
    if (input.status !== undefined) {
      if (!INITIATIVE_STATUSES.has(input.status)) {
        throw new Error(`invalid initiative status: ${input.status}`);
      }
      initiative.status = input.status;
    }
    if (typeof input.awaitingHuman === "boolean") {
      initiative.awaitingHuman = input.awaitingHuman;
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
      nextSteps: input.nextSteps,
      status,
      awaitingHuman: input.awaitingHuman === true,
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
 * Prefer newer updatedAt when merging entities with the same id.
 * @template {{ id: string, updatedAt?: string }} T
 * @param {T[]} a
 * @param {T[]} b
 * @returns {T[]}
 */
function unionById(a, b) {
  /** @type {Map<string, T>} */
  const map = new Map();
  for (const item of [...a, ...b]) {
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    const prevAt = typeof prev.updatedAt === "string" ? prev.updatedAt : "";
    const nextAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
    map.set(item.id, nextAt >= prevAt ? item : prev);
  }
  return [...map.values()];
}

/**
 * @param {BoardState} a
 * @param {BoardState} b
 * @param {string} canonicalPath
 * @returns {BoardState}
 */
function mergeBoardStates(a, b, canonicalPath) {
  const updatedAt =
    (a.updatedAt || "") >= (b.updatedAt || "") ? a.updatedAt : b.updatedAt;
  return {
    workspacePath: canonicalPath,
    initiatives: unionById(a.initiatives, b.initiatives),
    slices: unionById(a.slices, b.slices),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

/**
 * Find buckets whose JSON workspacePath canonicalizes to K but folder !== hash(K),
 * merge into canonical state, persist, and delete orphans.
 * @param {BoardState} state
 * @param {StoreOptions} [options]
 * @returns {Promise<BoardState>}
 */
async function consolidateOrphans(state, options = {}) {
  const key = canonicalizeWorkspacePath(state.workspacePath);
  const canonicalHash = workspaceHash(key);
  const root = defaultDataRoot(options.dataRoot);

  /** @type {string[]} */
  let dirNames = [];
  try {
    dirNames = await readdir(root);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { ...state, workspacePath: key };
    }
    throw err;
  }

  /** @type {{ dir: string, state: BoardState }[]} */
  const orphans = [];
  for (const name of dirNames) {
    if (name === canonicalHash) continue;
    const orphanPath = join(root, name, "state.json");
    try {
      const raw = await readFile(orphanPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") continue;
      const obj = /** @type {Record<string, unknown>} */ (parsed);
      if (typeof obj.workspacePath !== "string") continue;
      if (canonicalizeWorkspacePath(obj.workspacePath) !== key) continue;
      orphans.push({
        dir: name,
        state: normalizeState(key, parsed),
      });
    } catch {
      // not a board bucket
    }
  }

  let merged = { ...state, workspacePath: key };
  if (orphans.length === 0) return merged;

  for (const orphan of orphans) {
    merged = mergeBoardStates(merged, orphan.state, key);
  }
  await saveState(merged, options);

  for (const orphan of orphans) {
    try {
      await rm(join(root, orphan.dir), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return merged;
}

/**
 * @param {string} workspacePath canonical load key — never prefer a mismatched JSON path
 * @param {unknown} parsed
 * @returns {BoardState}
 */
function normalizeState(workspacePath, parsed) {
  if (!parsed || typeof parsed !== "object") {
    return emptyState(workspacePath);
  }
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  return {
    workspacePath,
    initiatives: Array.isArray(obj.initiatives) ? /** @type {Initiative[]} */ (obj.initiatives) : [],
    slices: Array.isArray(obj.slices) ? /** @type {Slice[]} */ (obj.slices) : [],
    updatedAt:
      typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
  };
}
