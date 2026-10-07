import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { startBoardServer } from "../lib/server.js";
import { verifyMcpBearerAuth } from "../lib/mcp-http.js";

const WS_A = "D:\\hosts\\laptop\\my-repo";
const WS_B = "D:\\hosts\\server\\my-repo";

/**
 * @param {import("@modelcontextprotocol/sdk/client/index.js").Client} client
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function callTool(client, name, args) {
  const result = await client.callTool(
    { name, arguments: args },
    CallToolResultSchema,
  );
  assert.equal(result.isError, false, JSON.stringify(result));
  const text = result.content?.[0]?.text;
  assert.ok(typeof text === "string");
  return JSON.parse(text);
}

test("verifyMcpBearerAuth: no token configured allows any request", () => {
  assert.deepEqual(
    verifyMcpBearerAuth({ headers: {} }, undefined),
    { authorized: true },
  );
  assert.deepEqual(
    verifyMcpBearerAuth({ headers: { authorization: "Bearer x" } }, ""),
    { authorized: true },
  );
});

test("verifyMcpBearerAuth: rejects missing or wrong bearer", () => {
  const auth = verifyMcpBearerAuth({ headers: {} }, "secret");
  assert.equal(auth.authorized, false);
  assert.equal(auth.status, 401);

  const bad = verifyMcpBearerAuth(
    { headers: { authorization: "Bearer wrong" } },
    "secret",
  );
  assert.equal(bad.authorized, false);

  const ok = verifyMcpBearerAuth(
    { headers: { authorization: "Bearer secret" } },
    "secret",
  );
  assert.deepEqual(ok, { authorized: true });
});

test("MCP HTTP: rejects unauthenticated when token set", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "hb-mcp-http-"));
  const { server, url } = await startBoardServer({
    port: 0,
    dataRoot,
    mcpToken: "test-token",
  });
  try {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
        id: 1,
      }),
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("MCP HTTP: bearer accepted and board_get smoke", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "hb-mcp-http-"));
  const { server, url } = await startBoardServer({
    port: 0,
    dataRoot,
    mcpToken: "smoke-token",
  });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: {
        headers: { Authorization: "Bearer smoke-token" },
      },
    });
    const client = new Client({ name: "mcp-http-test", version: "0.0.1" });
    await client.connect(transport);

    const body = await callTool(client, "board_get", { workspace: WS_A });
    assert.equal(body.ok, true);
    assert.equal(body.state.slices.length, 0);

    await transport.close();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("MCP HTTP: mutation persists under slug bucket across paths", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "hb-mcp-http-"));
  const { server, url } = await startBoardServer({ port: 0, dataRoot });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
    const client = new Client({ name: "mcp-http-slug", version: "0.0.1" });
    await client.connect(transport);

    const upsert = await callTool(client, "initiative_upsert", {
      workspace: WS_A,
      planPath: "plans/remote.md",
      title: "Remote board",
      blurb: "http mcp",
    });
    assert.equal(upsert.ok, true);
    const initiativeId = upsert.initiative.id;

    const fromB = await callTool(client, "board_get", { workspace: WS_B });
    assert.equal(fromB.ok, true);
    assert.equal(fromB.state.initiatives.length, 1);
    assert.equal(fromB.state.initiatives[0].id, initiativeId);
    assert.equal(fromB.state.initiatives[0].title, "Remote board");

    await transport.close();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("startBoardServer: host option binds listen address", async () => {
  const { server, url } = await startBoardServer({ port: 0, host: "127.0.0.1" });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const addr = server.address();
    assert.ok(addr && typeof addr !== "string");
    assert.equal(addr.address, "127.0.0.1");
    const res = await fetch(`${url}/api/boards`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
