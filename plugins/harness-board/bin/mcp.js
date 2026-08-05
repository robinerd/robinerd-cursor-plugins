#!/usr/bin/env node
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHarnessBoardMcpServer } from "../lib/mcp.js";

const workspacePath = resolve(
  process.env.HARNESS_BOARD_WORKSPACE || process.cwd(),
);
const dataRoot = process.env.HARNESS_BOARD_DATA_ROOT
  ? resolve(process.env.HARNESS_BOARD_DATA_ROOT)
  : undefined;

const server = createHarnessBoardMcpServer({ workspacePath, dataRoot });
const transport = new StdioServerTransport();
await server.connect(transport);
