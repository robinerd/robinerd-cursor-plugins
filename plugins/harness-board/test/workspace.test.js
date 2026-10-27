import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalizeWorkspacePath,
  discoverMainWorktreeRoot,
  parseMainWorktreeFromPorcelain,
  resolveBoardWorkspacePath,
} from "../lib/workspace.js";

test("parseMainWorktreeFromPorcelain returns first worktree line", () => {
  const sample = [
    "worktree /repo/main",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /repo/linked",
    "HEAD def",
  ].join("\n");
  assert.equal(parseMainWorktreeFromPorcelain(sample), "/repo/main");
  assert.equal(parseMainWorktreeFromPorcelain(""), null);
});

test("resolveBoardWorkspacePath missing path returns canonical only", () => {
  const missing = join(tmpdir(), "harness-board-missing", "no-such-dir");
  const canonical = canonicalizeWorkspacePath(missing);
  assert.equal(resolveBoardWorkspacePath(missing), canonical);
});

test("resolveBoardWorkspacePath non-git directory returns realpath canonical", async () => {
  const root = await mkdtemp(join(tmpdir(), "hb-ws-nogit-"));
  try {
    const resolved = resolveBoardWorkspacePath(root);
    assert.equal(resolved, canonicalizeWorkspacePath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveBoardWorkspacePath follows directory symlink to same identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "hb-ws-link-"));
  const real = join(root, "real");
  const alias = join(root, "alias");
  await mkdir(real);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(real, alias, linkType);
  try {
    assert.equal(
      resolveBoardWorkspacePath(alias),
      resolveBoardWorkspacePath(real),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveBoardWorkspacePath maps linked git worktree to main root", async (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "hb-ws-wt-"));
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

  try {
    const mainKey = canonicalizeWorkspacePath(main);
    assert.equal(resolveBoardWorkspacePath(main), mainKey);
    assert.equal(resolveBoardWorkspacePath(linked), mainKey);
    assert.equal(discoverMainWorktreeRoot(linked), mainKey);
  } finally {
    try {
      git(main, "worktree", "remove", linked, "--force");
    } catch {
      // best-effort cleanup
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverMainWorktreeRoot soft-fails for non-git directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "hb-ws-nogit2-"));
  try {
    assert.equal(discoverMainWorktreeRoot(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveBoardWorkspacePath soft-fails when git worktree list fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "hb-ws-fakegit-"));
  const fakeGit = join(root, ".git");
  await mkdir(fakeGit);
  await writeFile(join(fakeGit, "HEAD"), "ref: refs/heads/main\n");
  try {
    const physical = canonicalizeWorkspacePath(root);
    assert.equal(resolveBoardWorkspacePath(root), physical);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
