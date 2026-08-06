import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultDataRoot, workspaceHash } from "./store.js";

/**
 * @typedef {object} BoardSummary
 * @property {string} hash
 * @property {string} workspacePath
 * @property {number} mtimeMs
 * @property {string} mtimeIso
 */

/**
 * List all persisted boards under the data root, newest activity first.
 * Sort key is state.json mtime (no deep project parse). Label uses top-level
 * workspacePath from the JSON when present.
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
      } catch {
        // keep hash as label
      }
      boards.push({
        hash: ent.name,
        workspacePath,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
      });
    } catch {
      // missing/unreadable state.json — skip
    }
  }

  boards.sort((a, b) => b.mtimeMs - a.mtimeMs || a.workspacePath.localeCompare(b.workspacePath));
  return boards;
}

/**
 * Resolve which workspace to show: explicit → default option → active pointer → newest mtime.
 * @param {{
 *   dataRoot?: string,
 *   requested?: string | null,
 *   defaultWorkspace?: string | null,
 *   activeWorkspace?: string | null,
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

  const active = match(opts.activeWorkspace);
  if (active && byPath.has(active.replace(/\\/g, "/").toLowerCase())) {
    return { workspacePath: active, boards };
  }

  const fallback = match(opts.defaultWorkspace);
  if (fallback) return { workspacePath: fallback, boards };

  if (boards.length > 0) {
    return { workspacePath: boards[0].workspacePath, boards };
  }

  return { workspacePath: fallback ?? active ?? null, boards };
}

/**
 * @param {string} workspacePath
 * @returns {string}
 */
export function hashForWorkspace(workspacePath) {
  return workspaceHash(workspacePath);
}
