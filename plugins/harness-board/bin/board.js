#!/usr/bin/env node
import { resolve } from "node:path";
import { startBoardServer } from "../lib/server.js";

/** @type {{ dataRoot?: string, workspacePath?: string }} */
const options = {};

if (process.env.HARNESS_BOARD_DATA_ROOT) {
  options.dataRoot = resolve(process.env.HARNESS_BOARD_DATA_ROOT);
}

if (process.env.HARNESS_BOARD_WORKSPACE) {
  options.workspacePath = resolve(process.env.HARNESS_BOARD_WORKSPACE);
}

const { server } = await startBoardServer(options);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
