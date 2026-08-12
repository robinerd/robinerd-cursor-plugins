---
name: start-work
description: Create initiative plan from template with tier presets
---

Follow the **start-work** skill. Create or open `plans/<id>.md`, set tier/skips. Stay in Agent mode (do not switch to Plan mode). Use **ask-user** for name/tier if needed. Resolve the bundled template from the plugin install root, not `plugins/harness-2000` in the workspace. After creating the plan, call harness-board `initiative_upsert` (status `planning`) when MCP is available; always pass `workspace` (absolute path of the agent’s project root — or another workspace’s absolute path for cross-board work); soft-fail otherwise.
