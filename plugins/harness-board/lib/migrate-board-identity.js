import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  atomicWriteFile,
  defaultDataRoot,
  parseJsonDocument,
  workspaceBucketHash,
} from "./store.js";
import {
  canonicalizeWorkspacePath,
  resolveBoardWorkspacePath,
  workspaceIdentityKey,
} from "./workspace.js";

/** @typedef {import("./store.js").BoardState} BoardState */
/** @typedef {import("./store.js").Initiative} Initiative */
/** @typedef {import("./store.js").Slice} Slice */

/** @typedef {{ hash: string, state: BoardState, recordedPath: string, boardRoot: string, masterHash: string }} ScannedBucket */

/** @typedef {{
 *   groupKey: string,
 *   boardRoot: string,
 *   masterHash: string,
 *   members: ScannedBucket[],
 *   merged: BoardState,
 *   removeHashes: string[],
 * }} MigrationGroupAction */

const INIT_RANK = {
  done: 5,
  integrating: 4,
  building: 3,
  planning: 2,
  parked: 1,
};

const SLICE_RANK = {
  done: 7,
  verify: 6,
  review: 5,
  implement: 4,
  approved: 3,
  ready: 2,
  blocked: 1,
};

/**
 * @param {Initiative} a
 * @param {Initiative} b
 * @returns {Initiative}
 */
export function pickInitiativeForMerge(a, b) {
  const ra = INIT_RANK[a.status] ?? 0;
  const rb = INIT_RANK[b.status] ?? 0;
  if (ra !== rb) return ra > rb ? a : b;
  const ta = Date.parse(a.updatedAt || 0);
  const tb = Date.parse(b.updatedAt || 0);
  if (ta !== tb) return ta > tb ? a : b;
  return JSON.stringify(a).length >= JSON.stringify(b).length ? a : b;
}

/**
 * @param {Slice} a
 * @param {Slice} b
 * @returns {Slice}
 */
export function pickSliceForMerge(a, b) {
  const ra = SLICE_RANK[a.column] ?? 0;
  const rb = SLICE_RANK[b.column] ?? 0;
  if (ra !== rb) return ra > rb ? a : b;
  const ea = (a.evidence?.length || 0) + (a.history?.length || 0);
  const eb = (b.evidence?.length || 0) + (b.history?.length || 0);
  if (ea !== eb) return ea > eb ? a : b;
  return JSON.stringify(a).length >= JSON.stringify(b).length ? a : b;
}

/**
 * @param {BoardState[]} states
 * @param {string} boardRoot
 * @returns {BoardState}
 */
export function mergeStatesForIdentityMigration(states, boardRoot) {
  /** @type {Map<string, Initiative>} */
  const inits = new Map();
  /** @type {Map<string, Slice>} */
  const slices = new Map();
  for (const s of states) {
    for (const i of s.initiatives || []) {
      const prev = inits.get(i.id);
      inits.set(i.id, prev ? pickInitiativeForMerge(prev, i) : i);
    }
    for (const sl of s.slices || []) {
      const prev = slices.get(sl.id);
      slices.set(sl.id, prev ? pickSliceForMerge(prev, sl) : sl);
    }
  }
  return {
    workspacePath: canonicalizeWorkspacePath(boardRoot),
    initiatives: [...inits.values()].sort((a, b) =>
      (a.title || "").localeCompare(b.title || ""),
    ),
    slices: [...slices.values()].sort((a, b) =>
      (a.title || "").localeCompare(b.title || ""),
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {string} dataRoot
 * @returns {Promise<ScannedBucket[]>}
 */
export async function scanBoardBuckets(dataRoot) {
  /** @type {string[]} */
  let names = [];
  try {
    names = await readdir(dataRoot);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  /** @type {ScannedBucket[]} */
  const buckets = [];
  for (const name of names) {
    const statePath = join(dataRoot, name, "state.json");
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = parseJsonDocument(raw);
      if (!parsed || typeof parsed !== "object") continue;
      const obj = /** @type {Record<string, unknown>} */ (parsed);
      if (typeof obj.workspacePath !== "string" || !obj.workspacePath.trim()) {
        continue;
      }
      const recordedPath = canonicalizeWorkspacePath(obj.workspacePath);
      const boardRoot = resolveBoardWorkspacePath(recordedPath);
      const masterHash = workspaceBucketHash(boardRoot);
      buckets.push({
        hash: name,
        state: /** @type {BoardState} */ (parsed),
        recordedPath,
        boardRoot,
        masterHash,
      });
    } catch {
      // not a board bucket
    }
  }
  return buckets;
}

/**
 * @param {ScannedBucket[]} buckets
 * @returns {Map<string, ScannedBucket[]>}
 */
export function groupBucketsByBoardRoot(buckets) {
  /** @type {Map<string, ScannedBucket[]>} */
  const groups = new Map();
  for (const b of buckets) {
    const key = workspaceIdentityKey(b.boardRoot);
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  return groups;
}

/**
 * @param {ScannedBucket[]} members
 * @returns {MigrationGroupAction | null}
 */
function planGroupAction(members) {
  if (members.length === 0) return null;
  const boardRoot = members[0].boardRoot;
  const masterHash = members[0].masterHash;
  const needsWork =
    members.length > 1 ||
    members.some((m) => m.hash !== masterHash);
  if (!needsWork) return null;

  const merged = mergeStatesForIdentityMigration(
    members.map((m) => m.state),
    boardRoot,
  );
  const removeHashes = [
    ...new Set(
      members.map((m) => m.hash).filter((h) => h !== masterHash),
    ),
  ];
  return {
    groupKey: workspaceIdentityKey(boardRoot),
    boardRoot,
    masterHash,
    members,
    merged,
    removeHashes,
  };
}

/**
 * @param {string} dataRoot
 * @returns {Promise<MigrationGroupAction[]>}
 */
export async function planIdentityMigration(dataRoot) {
  const buckets = await scanBoardBuckets(dataRoot);
  const groups = groupBucketsByBoardRoot(buckets);
  /** @type {MigrationGroupAction[]} */
  const actions = [];
  for (const members of groups.values()) {
    const action = planGroupAction(members);
    if (action) actions.push(action);
  }
  actions.sort((a, b) => a.boardRoot.localeCompare(b.boardRoot));
  return actions;
}

/**
 * @param {string} dataRoot
 * @returns {Promise<string>}
 */
export async function backupDataRootBeforeMigrate(dataRoot) {
  const parent = dirname(dataRoot);
  const base = basename(dataRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupRoot = join(
    parent,
    `${base}-backup-${stamp}-pre-identity-migrate`,
  );
  await mkdir(parent, { recursive: true });
  await cp(dataRoot, backupRoot, { recursive: true, force: false });
  return backupRoot;
}

/**
 * @param {string} dataRoot
 * @param {MigrationGroupAction} action
 * @returns {Promise<void>}
 */
async function applyGroupAction(dataRoot, action) {
  const dest = join(dataRoot, action.masterHash, "state.json");
  await mkdir(dirname(dest), { recursive: true });
  await atomicWriteFile(dest, `${JSON.stringify(action.merged, null, 2)}\n`);
  for (const hash of action.removeHashes) {
    await rm(join(dataRoot, hash), { recursive: true, force: true });
  }
}

/**
 * @param {{ dataRoot?: string, apply?: boolean }} options
 * @returns {Promise<{ mode: "dry-run" | "apply", dataRoot: string, backupRoot?: string, actions: MigrationGroupAction[], report: object }>}
 */
export async function runIdentityMigration(options = {}) {
  const dataRoot = defaultDataRoot(options.dataRoot);
  const apply = options.apply === true;
  const actions = await planIdentityMigration(dataRoot);

  /** @type {string | undefined} */
  let backupRoot;
  if (apply) {
    if (actions.length === 0) {
      return {
        mode: "apply",
        dataRoot,
        actions,
        report: { message: "nothing to migrate", merges: [] },
      };
    }
    try {
      backupRoot = await backupDataRootBeforeMigrate(dataRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`backup failed; refusing to migrate: ${message}`);
    }
    for (const action of actions) {
      await applyGroupAction(dataRoot, action);
    }
  }

  const report = {
    dataRoot,
    mode: apply ? "apply" : "dry-run",
    backup: backupRoot ?? null,
    groupCount: actions.length,
    merges: actions.map((a) => ({
      boardRoot: a.boardRoot,
      masterHash: a.masterHash,
      removeHashes: a.removeHashes,
      sources: a.members.map((m) => ({
        hash: m.hash,
        recordedPath: m.recordedPath,
        initiatives: m.state.initiatives?.length ?? 0,
        slices: m.state.slices?.length ?? 0,
      })),
      merged: {
        initiatives: a.merged.initiatives.length,
        slices: a.merged.slices.length,
        workspacePath: a.merged.workspacePath,
      },
    })),
  };

  return {
    mode: apply ? "apply" : "dry-run",
    dataRoot,
    backupRoot,
    actions,
    report,
  };
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runMigrateBoardIdentityCli(argv) {
  let dataRoot;
  let apply = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--data-root") {
      const next = argv[++i];
      if (!next) {
        console.error("--data-root requires a path");
        return 1;
      }
      dataRoot = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: migrate-board-identity [--dry-run] [--apply] [--data-root PATH]

One-shot merge of harness-board buckets onto resolveBoardWorkspacePath identity.
Default: --dry-run when neither --apply nor --dry-run is given.
--apply always copies the data root to a timestamped backup first; aborts if backup fails.`);
      return 0;
    } else {
      console.error(`Unknown argument: ${arg}`);
      return 1;
    }
  }

  if (apply && dryRun) {
    console.error("Use only one of --apply or --dry-run");
    return 1;
  }

  const doApply = apply;
  try {
    const result = await runIdentityMigration({
      dataRoot,
      apply: doApply,
    });
    console.log(JSON.stringify(result.report, null, 2));
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
