import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  canonicalizeWorkspacePath,
  resolveBoardWorkspacePath,
  workspaceIdentityKey,
} from "./workspace.js";

export { canonicalizeWorkspacePath, resolveBoardWorkspacePath, workspaceIdentityKey };

/**
 * Hash/compare key after board-root resolve (worktrees, junction aliases).
 * @param {string} workspacePath
 * @returns {string}
 */
function boardWorkspaceIdentityKey(workspacePath) {
  return workspaceIdentityKey(resolveBoardWorkspacePath(workspacePath));
}

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
 * Folder name under the data root for this workspace (canonical + case-folded on Windows).
 * @param {string} workspacePath
 * @returns {string}
 */
export function workspaceBucketHash(workspacePath) {
  return workspaceHash(boardWorkspaceIdentityKey(workspacePath));
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
  return join(root, workspaceBucketHash(workspacePath), "state.json");
}

/**
 * @param {string} workspacePath
 * @returns {BoardState}
 */
export function emptyState(workspacePath) {
  return {
    workspacePath: resolveBoardWorkspacePath(workspacePath),
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
  const key = resolveBoardWorkspacePath(workspacePath);
  const path = statePathFor(workspacePath, options);
  /** @type {BoardState} */
  let state;
  try {
    // An open read handle blocks the rename on Windows; let queued writes land first.
    await pendingWrites.get(path)?.catch(() => {});
    const raw = await readFile(path, "utf8");
    const parsed = parseJsonDocument(raw);
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
  const key = resolveBoardWorkspacePath(state.workspacePath);
  const path = statePathFor(key, options);
  await mkdir(dirname(path), { recursive: true });
  const next = {
    ...state,
    workspacePath: key,
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Parse JSON; if a concurrent non-atomic write left trailing junk after the
 * first value, keep the leading document (V8 reports the junk position).
 * @param {string} raw
 * @returns {unknown}
 */
export function parseJsonDocument(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const match = /at position (\d+)/i.exec(err.message);
    if (!match) throw err;
    const pos = Number(match[1]);
    if (!Number.isFinite(pos) || pos <= 0 || pos >= raw.length) throw err;
    return JSON.parse(raw.slice(0, pos));
  }
}

/**
 * Write via temp file + rename so readers never see a torn or dual document.
 * @param {string} filePath
 * @param {string} contents
 * @returns {Promise<void>}
 */
export function atomicWriteFile(filePath, contents) {
  const prev = pendingWrites.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => writeViaTempRename(filePath, contents));
  pendingWrites.set(filePath, next);
  next.finally(() => {
    if (pendingWrites.get(filePath) === next) pendingWrites.delete(filePath);
  }).catch(() => {});
  return next;
}

/**
 * Per-path write queue: same-process renames onto one destination contend
 * with EPERM on Windows, and queueing keeps the last save the one on disk.
 * @type {Map<string, Promise<void>>}
 */
const pendingWrites = new Map();

/**
 * @param {string} filePath
 * @param {string} contents
 * @returns {Promise<void>}
 */
async function writeViaTempRename(filePath, contents) {
  const dir = dirname(filePath);
  const tmp = join(
    dir,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(tmp, contents, "utf8");
  try {
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 400, 500];

/**
 * Node's rename replaces the destination on Windows too, but fails with
 * EPERM/EACCES/EBUSY while another process has it open (e.g. a concurrent
 * readFile). Never delete the destination first: a reader in that gap would
 * see ENOENT, load an empty board, and a later save would wipe the real one.
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (!RENAME_RETRY_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err;
      // Jitter so retries don't stay phase-locked with a polling reader.
      const delay = RENAME_RETRY_DELAYS_MS[attempt] * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
  const key = resolveBoardWorkspacePath(state.workspacePath);
  const canonicalHash = workspaceBucketHash(key);
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
      if (boardWorkspaceIdentityKey(obj.workspacePath) !== boardWorkspaceIdentityKey(key)) {
        continue;
      }
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
