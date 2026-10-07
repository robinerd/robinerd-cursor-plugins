import { readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalizeWorkspacePath } from "./workspace.js";
import {
  defaultDataRoot,
  mergeBoardStates,
  workspaceBucketHash,
} from "./store.js";

/**
 * @typedef {object} MigrateSlugResult
 * @property {number} bucketsScanned
 * @property {number} slugBucketsWritten
 * @property {number} legacyDirsRemoved
 */

/**
 * One-off migration: merge every board bucket into its slug-hash folder, delete legacy dirs.
 * Does not run automatically on board load.
 * @param {string} [dataRoot]
 * @returns {Promise<MigrateSlugResult>}
 */
export async function migrateSlugBuckets(dataRoot) {
  const root = defaultDataRoot(dataRoot);
  /** @type {string[]} */
  let dirNames = [];
  try {
    dirNames = await readdir(root);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { bucketsScanned: 0, slugBucketsWritten: 0, legacyDirsRemoved: 0 };
    }
    throw err;
  }

  /** @type {{ dir: string, state: import("./store.js").BoardState }[]} */
  const buckets = [];
  for (const name of dirNames) {
    const stateFile = join(root, name, "state.json");
    try {
      const raw = await readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") continue;
      const obj = /** @type {Record<string, unknown>} */ (parsed);
      if (typeof obj.workspacePath !== "string" || !obj.workspacePath.trim()) continue;
      const canonicalPath = canonicalizeWorkspacePath(obj.workspacePath);
      buckets.push({
        dir: name,
        state: {
          workspacePath: canonicalPath,
          initiatives: Array.isArray(obj.initiatives)
            ? /** @type {import("./store.js").Initiative[]} */ (obj.initiatives)
            : [],
          slices: Array.isArray(obj.slices)
            ? /** @type {import("./store.js").Slice[]} */ (obj.slices)
            : [],
          updatedAt:
            typeof obj.updatedAt === "string"
              ? obj.updatedAt
              : new Date().toISOString(),
        },
      });
    } catch {
      // skip non-board entries
    }
  }

  /** @type {Map<string, import("./store.js").BoardState>} */
  const bySlugHash = new Map();
  for (const { state } of buckets) {
    const slugHash = workspaceBucketHash(state.workspacePath);
    const existing = bySlugHash.get(slugHash);
    if (!existing) {
      bySlugHash.set(slugHash, { ...state });
      continue;
    }
    const canonicalPath =
      (state.updatedAt || "") >= (existing.updatedAt || "")
        ? state.workspacePath
        : existing.workspacePath;
    bySlugHash.set(
      slugHash,
      mergeBoardStates(existing, state, canonicalPath),
    );
  }

  for (const [slugHash, state] of bySlugHash) {
    const path = join(root, slugHash, "state.json");
    await mkdir(dirname(path), { recursive: true });
    const next = {
      ...state,
      workspacePath: canonicalizeWorkspacePath(state.workspacePath),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  const slugHashes = new Set(bySlugHash.keys());
  let legacyDirsRemoved = 0;
  for (const { dir } of buckets) {
    if (slugHashes.has(dir)) continue;
    try {
      await rm(join(root, dir), { recursive: true, force: true });
      legacyDirsRemoved += 1;
    } catch {
      // best-effort
    }
  }

  return {
    bucketsScanned: buckets.length,
    slugBucketsWritten: bySlugHash.size,
    legacyDirsRemoved,
  };
}
