#!/usr/bin/env node
/**
 * MCP stdio entry. Cursor plugin cache does not include node_modules,
 * so we npm-install into the plugin root on first run (stdout kept quiet
 * so install noise cannot corrupt the MCP protocol).
 *
 * Tool targeting uses per-call `workspace` args — HARNESS_BOARD_WORKSPACE
 * is not used for store selection.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = join(
  pluginRoot,
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
);

function ensureDeps() {
  if (existsSync(sdkDir)) return;
  const result = spawnSync(
    "npm",
    ["install", "--omit=dev", "--no-fund", "--no-audit"],
    {
      cwd: pluginRoot,
      // MCP speaks on stdout — never write install logs there.
      stdio: ["ignore", "ignore", "pipe"],
      shell: true,
      env: process.env,
    },
  );
  if (result.status !== 0) {
    const detail = result.stderr?.toString?.() || "npm install failed";
    console.error(
      `[harness-board] Failed to install MCP dependencies in ${pluginRoot}:\n${detail}`,
    );
    process.exit(1);
  }
  if (!existsSync(sdkDir)) {
    console.error(
      `[harness-board] npm install finished but @modelcontextprotocol/sdk is still missing under ${pluginRoot}`,
    );
    process.exit(1);
  }
}

ensureDeps();

const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);
const { createHarnessBoardMcpServer, isUnexpandedTemplate } = await import(
  "../lib/mcp.js"
);

const dataRootEnv = process.env.HARNESS_BOARD_DATA_ROOT;
const dataRoot =
  dataRootEnv && !isUnexpandedTemplate(dataRootEnv)
    ? resolve(dataRootEnv)
    : undefined;

const server = createHarnessBoardMcpServer(
  dataRoot ? { dataRoot } : {},
);
const transport = new StdioServerTransport();
await server.connect(transport);
