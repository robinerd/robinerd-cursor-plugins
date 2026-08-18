import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { defaultDataRoot, workspaceBucketHash } from "./store.js";
import {
  canonicalizeWorkspacePath,
  looksWindowsPath,
  workspaceIdentityKey,
} from "./workspace.js";

/** Initiative statuses that mark a board as having Active work (UI). */
const ACTIVE_INITIATIVE_STATUSES = new Set([
  "planning",
  "building",
  "integrating",
]);

/**
 * @typedef {object} BoardSummary
 * @property {string} hash
 * @property {string} workspacePath
 * @property {number} mtimeMs
 * @property {string} mtimeIso
 * @property {boolean} hasActiveWork true when ≥1 initiative is planning/building/integrating
 * @property {boolean} hasAttention computed: any initiative needs human attention
 */

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function boardHasActiveWork(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const initiatives = /** @type {{ initiatives?: unknown }} */ (parsed)
    .initiatives;
  if (!Array.isArray(initiatives)) return false;
  return initiatives.some(
    (i) =>
      i &&
      typeof i === "object" &&
      typeof /** @type {{ status?: unknown }} */ (i).status === "string" &&
      ACTIVE_INITIATIVE_STATUSES.has(
        /** @type {{ status: string }} */ (i).status,
      ),
  );
}

/**
 * Unacknowledged chat wait only — slice columns (including blocked) do not count.
 * @param {{ status?: unknown, awaitingHuman?: unknown }} initiative
 * @returns {boolean}
 */
export function initiativeNeedsAttention(initiative) {
  if (!initiative || typeof initiative !== "object") return false;
  const status = initiative.status;
  if (status === "parked" || status === "done") return false;
  return initiative.awaitingHuman === true;
}

/**
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function boardHasAttention(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = /** @type {{ initiatives?: unknown, slices?: unknown }} */ (
    parsed
  );
  if (!Array.isArray(obj.initiatives)) return false;
  return obj.initiatives.some((i) =>
    initiativeNeedsAttention(
      /** @type {{ status?: unknown, awaitingHuman?: unknown }} */ (i),
    ),
  );
}

/**
 * List all persisted boards under the data root, newest activity first.
 * Sort key is state.json mtime (no deep project parse). Label uses top-level
 * workspacePath from the JSON when present. Active work is derived from
 * initiative statuses in state.json.
 * @param {string} [dataRoot]
 * @returns {Promise<BoardSummary[]>}
 */
export async function listBoardSummaries(dataRoot) {
  const root = defaultDataRoot(dataRoot);
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  /** @type {BoardSummary[]} */
  const boards = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const stateFile = join(root, ent.name, "state.json");
    try {
      const st = await stat(stateFile);
      let workspacePath = ent.name;
      let hasActiveWork = false;
      let hasAttention = false;
      try {
        const raw = await readFile(stateFile, "utf8");
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.workspacePath === "string" &&
          parsed.workspacePath.trim()
        ) {
          workspacePath = displayWorkspacePath(parsed.workspacePath);
        }
        hasActiveWork = boardHasActiveWork(parsed);
        hasAttention = boardHasAttention(parsed);
      } catch {
        // keep hash as label; no active work if unreadable JSON
      }
      boards.push({
        hash: ent.name,
        workspacePath,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
        hasActiveWork,
        hasAttention,
      });
    } catch {
      // missing/unreadable state.json — skip
    }
  }

  boards.sort((a, b) => b.mtimeMs - a.mtimeMs || a.workspacePath.localeCompare(b.workspacePath));
  return dedupeBoardSummaries(boards);
}

/**
 * Resolve which workspace to show: explicit → default option → newest mtime.
 * Does not use active-workspace.txt (UI selection is independent of Active marks).
 * @param {{
 *   dataRoot?: string,
 *   requested?: string | null,
 *   defaultWorkspace?: string | null,
 * }} opts
 * @returns {Promise<{ workspacePath: string | null, boards: BoardSummary[] }>}
 */
export async function resolveSelectedWorkspace(opts = {}) {
  const boards = await listBoardSummaries(opts.dataRoot);
  const byIdentity = new Map(
    boards.map((b) => [workspaceIdentityKey(b.workspacePath), b]),
  );
  const byHash = new Map(boards.map((b) => [b.hash, b]));

  /**
   * @param {string | null | undefined} value
   * @returns {string | null}
   */
  function match(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (byHash.has(trimmed)) return byHash.get(trimmed).workspacePath;
    const ident = workspaceIdentityKey(trimmed);
    if (byIdentity.has(ident)) return byIdentity.get(ident).workspacePath;
    // Allow selecting a workspace that has no state file yet (e2e / first write).
    return canonicalizeWorkspacePath(trimmed);
  }

  const requested = match(opts.requested);
  if (requested) return { workspacePath: requested, boards };

  const fallback = match(opts.defaultWorkspace);
  if (fallback) return { workspacePath: fallback, boards };

  if (boards.length > 0) {
    return { workspacePath: boards[0].workspacePath, boards };
  }

  return { workspacePath: fallback ?? null, boards };
}

/**
 * @param {string} workspacePath
 * @returns {string}
 */
export function hashForWorkspace(workspacePath) {
  return workspaceBucketHash(workspacePath);
}

/**
 * Canonicalize when the value is an absolute POSIX or Windows path; leave
 * hash-folder fallback labels alone.
 * @param {string} workspacePath
 * @returns {string}
 */
function displayWorkspacePath(workspacePath) {
  const trimmed = workspacePath.trim();
  if (looksWindowsPath(trimmed) || posix.isAbsolute(trimmed)) {
    return canonicalizeWorkspacePath(trimmed);
  }
  return trimmed;
}

/**
 * One sidebar row per logical workspace (drive case, slashes, trailing junk).
 * @param {BoardSummary[]} boards
 * @returns {BoardSummary[]}
 */
function dedupeBoardSummaries(boards) {
  /** @type {Map<string, BoardSummary>} */
  const byIdentity = new Map();
  for (const board of boards) {
    const ident =
      looksWindowsPath(board.workspacePath) ||
      posix.isAbsolute(String(board.workspacePath).trim())
        ? workspaceIdentityKey(board.workspacePath)
        : board.hash;
    const existing = byIdentity.get(ident);
    if (!existing) {
      byIdentity.set(ident, board);
      continue;
    }
    byIdentity.set(ident, mergeDuplicateBoards(existing, board));
  }
  const deduped = [...byIdentity.values()];
  deduped.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.workspacePath.localeCompare(b.workspacePath),
  );
  return deduped;
}

/**
 * @param {BoardSummary} a
 * @param {BoardSummary} b
 * @returns {BoardSummary}
 */
function mergeDuplicateBoards(a, b) {
  const wantHash = workspaceBucketHash(a.workspacePath);
  const aCanonical = a.hash === wantHash;
  const bCanonical = b.hash === wantHash;
  const primary =
    aCanonical && !bCanonical
      ? a
      : bCanonical && !aCanonical
        ? b
        : a.mtimeMs >= b.mtimeMs
          ? a
          : b;
  const mtimeMs = Math.max(a.mtimeMs, b.mtimeMs);
  const newer = a.mtimeMs >= b.mtimeMs ? a : b;
  return {
    ...primary,
    mtimeMs,
    mtimeIso: newer.mtimeIso,
    hasActiveWork: a.hasActiveWork || b.hasActiveWork,
    hasAttention: a.hasAttention || b.hasAttention,
  };
}
