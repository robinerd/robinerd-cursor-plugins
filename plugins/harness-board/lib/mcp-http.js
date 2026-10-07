import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHarnessBoardMcpServer } from "./mcp.js";

/** @typedef {import("./store.js").StoreOptions} StoreOptions */

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {string | undefined | null} expectedToken
 * @returns {{ authorized: true } | { authorized: false, status: number, message: string }}
 */
export function verifyMcpBearerAuth(req, expectedToken) {
  if (!expectedToken) {
    return { authorized: true };
  }
  const raw = req.headers.authorization;
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      authorized: false,
      status: 401,
      message: "Authorization required",
    };
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match || match[1].trim() !== expectedToken) {
    return {
      authorized: false,
      status: 401,
      message: "Invalid bearer token",
    };
  }
  return { authorized: true };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
export function sendMcpAuthError(res, status, message) {
  if (res.headersSent) return;
  const body = `${JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32001, message },
    id: null,
  })}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Bearer realm="harness-board-mcp"',
  });
  res.end(body);
}

/**
 * Stateless Streamable HTTP MCP — one transport + server per request.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {unknown} [parsedBody]
 * @param {StoreOptions} [storeOptions]
 */
export async function handleBoardMcpHttp(
  req,
  res,
  parsedBody,
  storeOptions = {},
) {
  /** @type {{ dataRoot?: string }} */
  const env = {};
  if (storeOptions.dataRoot) env.dataRoot = storeOptions.dataRoot;

  const mcpServer = createHarnessBoardMcpServer(env);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);
  try {
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    res.on("close", () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    });
  }
}
