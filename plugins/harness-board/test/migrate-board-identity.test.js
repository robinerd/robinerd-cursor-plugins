import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  mergeStatesForIdentityMigration,
  pickInitiativeForMerge,
  pickSliceForMerge,
  planIdentityMigration,
  runIdentityMigration,
} from "../lib/migrate-board-identity.js";
import {
  resolveBoardWorkspacePath,
  workspaceBucketHash,
  workspaceHash,
  workspaceIdentityKey,
  canonicalizeWorkspacePath,
} from "../lib/store.js";

test("pickInitiativeForMerge prefers higher status", () => {
  const a = {
    id: "i1",
    planPath: "p",
    title: "A",
    blurb: "",
    status: "planning",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const b = { ...a, status: "building", updatedAt: "2019-01-01T00:00:00.000Z" };
  assert.equal(pickInitiativeForMerge(a, b).status, "building");
});

test("pickSliceForMerge prefers higher column rank", () => {
  const a = {
    id: "s1",
    initiativeId: "i1",
    title: "S",
    column: "ready",
    evidence: [],
    history: [],
  };
  const b = { ...a, column: "implement" };
  assert.equal(pickSliceForMerge(a, b).column, "implement");
});

test("mergeStatesForIdentityMigration unions by id", () => {
  const merged = mergeStatesForIdentityMigration(
    [
      {
        workspacePath: "/a",
        initiatives: [
          {
            id: "i1",
            planPath: "p1",
            title: "One",
            blurb: "",
            status: "planning",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        slices: [],
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        workspacePath: "/b",
        initiatives: [
          {
            id: "i2",
            planPath: "p2",
            title: "Two",
            blurb: "",
            status: "building",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        slices: [],
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
    "/main/root",
  );
  assert.equal(merged.workspacePath, canonicalizeWorkspacePath("/main/root"));
  assert.equal(merged.initiatives.length, 2);
});

test("dry-run reports split worktree buckets without writing", async (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const dataRoot = await mkdtemp(join(tmpdir(), "hb-migrate-dry-"));
  const root = await mkdtemp(join(tmpdir(), "hb-migrate-repo-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  await mkdir(main);
  git(main, "init");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "t");
  await writeFile(join(main, "f.txt"), "x\n");
  git(main, "add", "f.txt");
  git(main, "commit", "-m", "init");
  git(main, "branch", "feature");
  git(main, "worktree", "add", linked, "feature");

  const mainKey = resolveBoardWorkspacePath(main);
  const legacyMainHash = workspaceHash(workspaceIdentityKey(main));
  const legacyLinkedHash = workspaceHash(workspaceIdentityKey(linked));
  const masterHash = workspaceBucketHash(main);

  try {
    await writeLegacyBucket(dataRoot, legacyMainHash, main, {
      initiatives: [
        {
          id: "init-main",
          planPath: "plans/a.md",
          title: "From main bucket",
          blurb: "",
          status: "building",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      slices: [],
    });
    await writeLegacyBucket(dataRoot, legacyLinkedHash, linked, {
      initiatives: [
        {
          id: "init-linked",
          planPath: "plans/b.md",
          title: "From linked bucket",
          blurb: "",
          status: "planning",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      slices: [],
    });

    const actions = await planIdentityMigration(dataRoot);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].masterHash, masterHash);
    assert.equal(actions[0].merged.initiatives.length, 2);
    assert.equal(legacyMainHash, masterHash);
    assert.ok(actions[0].removeHashes.includes(legacyLinkedHash));
    assert.equal(actions[0].removeHashes.length, 1);

    const dry = await runIdentityMigration({ dataRoot, apply: false });
    assert.equal(dry.mode, "dry-run");
    const dirs = await boardDirHashes(dataRoot);
    assert.equal(dirs.length, 2);

    assert.equal(resolveBoardWorkspacePath(main), mainKey);
  } finally {
    try {
      git(main, "worktree", "remove", linked, "--force");
    } catch {
      // best-effort
    }
    await rm(dataRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("apply backs up and merges split buckets to master hash", async (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const parent = await mkdtemp(join(tmpdir(), "hb-migrate-parent-"));
  const dataRoot = join(parent, "harness-board");
  await mkdir(dataRoot, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "hb-migrate-repo2-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  await mkdir(main);
  git(main, "init");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "t");
  await writeFile(join(main, "f.txt"), "x\n");
  git(main, "add", "f.txt");
  git(main, "commit", "-m", "init");
  git(main, "branch", "feature");
  git(main, "worktree", "add", linked, "feature");

  const mainKey = resolveBoardWorkspacePath(main);
  const legacyMainHash = workspaceHash(workspaceIdentityKey(main));
  const legacyLinkedHash = workspaceHash(workspaceIdentityKey(linked));
  const masterHash = workspaceBucketHash(main);

  try {
    await writeLegacyBucket(dataRoot, legacyMainHash, main, {
      initiatives: [
        {
          id: "init-main",
          planPath: "plans/a.md",
          title: "From main bucket",
          blurb: "",
          status: "building",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      slices: [],
    });
    await writeLegacyBucket(dataRoot, legacyLinkedHash, linked, {
      initiatives: [
        {
          id: "init-linked",
          planPath: "plans/b.md",
          title: "From linked bucket",
          blurb: "",
          status: "planning",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      slices: [],
    });

    const result = await runIdentityMigration({ dataRoot, apply: true });
    assert.equal(result.mode, "apply");
    assert.ok(result.backupRoot);
    const backupEntries = await readdir(dirname(dataRoot));
    assert.ok(
      backupEntries.some((n) => n.includes("pre-identity-migrate")),
    );

    const dirs = await boardDirHashes(dataRoot);
    assert.deepEqual(dirs, [masterHash]);
    const onDisk = JSON.parse(
      await readFile(join(dataRoot, masterHash, "state.json"), "utf8"),
    );
    assert.equal(onDisk.workspacePath, mainKey);
    assert.equal(onDisk.initiatives.length, 2);
  } finally {
    try {
      git(main, "worktree", "remove", linked, "--force");
    } catch {
      // best-effort
    }
    await rm(parent, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * @param {string} dataRoot
 * @param {string} hash
 * @param {string} workspacePath
 * @param {{ initiatives: object[], slices: object[] }} body
 */
async function writeLegacyBucket(dataRoot, hash, workspacePath, body) {
  const dir = join(dataRoot, hash);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify(
      {
        workspacePath: canonicalizeWorkspacePath(workspacePath),
        initiatives: body.initiatives,
        slices: body.slices,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/**
 * @param {string} dataRoot
 * @returns {Promise<string[]>}
 */
async function boardDirHashes(dataRoot) {
  const names = await readdir(dataRoot);
  /** @type {string[]} */
  const dirs = [];
  for (const name of names) {
    try {
      await readFile(join(dataRoot, name, "state.json"), "utf8");
      dirs.push(name);
    } catch {
      // skip
    }
  }
  return dirs.sort();
}

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} cwd @param {...string} args */
function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}
