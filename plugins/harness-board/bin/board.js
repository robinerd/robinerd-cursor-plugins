#!/usr/bin/env node
import { resolve } from "node:path";
import { startBoardServer } from "../lib/server.js";

const workspacePath = resolve(
  process.env.HARNESS_BOARD_WORKSPACE || process.cwd(),
);
const dataRoot = process.env.HARNESS_BOARD_DATA_ROOT
  ? resolve(process.env.HARNESS_BOARD_DATA_ROOT)
  : undefined;

const { server } = await startBoardServer({
  workspacePath,
  dataRoot,
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
