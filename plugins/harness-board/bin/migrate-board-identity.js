#!/usr/bin/env node
import { runMigrateBoardIdentityCli } from "../lib/migrate-board-identity.js";

const code = await runMigrateBoardIdentityCli(process.argv.slice(2));
process.exitCode = code;
