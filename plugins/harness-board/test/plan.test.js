import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBoardServer, resolveSafePlanPath, toFileUrl } from "../lib/server.js";

test("resolveSafePlanPath allows under workspace, rejects traversal", () => {
  const root = "D:\\proj";
  const ok = resolveSafePlanPath(root, "plans/foo.md");
  assert.ok(ok);
  assert.match(ok.replace(/\\/g, "/"), /proj\/plans\/foo\.md$/i);

  assert.equal(resolveSafePlanPath(root, "../outside.md"), null);
  assert.equal(resolveSafePlanPath(root, "D:\\other\\x.md"), null);
  assert.equal(resolveSafePlanPath(root, "D:/other/x.md"), null);
  assert.equal(resolveSafePlanPath("  D:\\proj\\  ", "plans\\\\foo.md"), ok);
  assert.equal(resolveSafePlanPath("d:/proj", "plans/foo.md")?.toLowerCase(), ok.toLowerCase());
});

test("toFileUrl formats windows paths", () => {
  assert.equal(toFileUrl("D:\\a\\b.md"), "file:///D:/a/b.md");
});

test("GET /api/plan serves plan under workspace", async () => {
  const dataRoot = join(tmpdir(), `harness-board-plan-${Date.now()}`);
  const workspace = join(dataRoot, "project");
  await mkdir(join(workspace, "plans"), { recursive: true });
  await writeFile(
    join(workspace, "plans", "demo.md"),
    "# Demo plan\n\nHello.\n",
    "utf8",
  );

  const server = createBoardServer({ workspacePath: workspace, dataRoot });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
  });
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}`;
    const res = await fetch(
      `${url}/api/plan?workspace=${encodeURIComponent(workspace)}&path=plans/demo.md`,
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Demo plan/);
    assert.match(html, /Hello/);
    assert.match(html, /file:\/\/\//);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await rm(dataRoot, { recursive: true, force: true });
  }
});
