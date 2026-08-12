import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultDataRoot, workspaceHash } from "./store.js";

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
      try {
        const raw = await readFile(stateFile, "utf8");
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.workspacePath === "string" &&
          parsed.workspacePath.trim()
        ) {
          workspacePath = parsed.workspacePath.trim();
        }
        hasActiveWork = boardHasActiveWork(parsed);
      } catch {
        // keep hash as label; no active work if unreadable JSON
      }
      boards.push({
        hash: ent.name,
        workspacePath,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
        hasActiveWork,
      });
    } catch {
      // missing/unreadable state.json — skip
    }
  }

  boards.sort((a, b) => b.mtimeMs - a.mtimeMs || a.workspacePath.localeCompare(b.workspacePath));
  return boards;
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
  const byPath = new Map(
    boards.map((b) => [b.workspacePath.replace(/\\/g, "/").toLowerCase(), b]),
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
    const norm = trimmed.replace(/\\/g, "/").toLowerCase();
    if (byPath.has(norm)) return byPath.get(norm).workspacePath;
    // Allow selecting a workspace that has no state file yet (e2e / first write).
    return trimmed;
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
  return workspaceHash(workspacePath);
}
