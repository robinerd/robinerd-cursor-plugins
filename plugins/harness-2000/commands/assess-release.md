---
name: assess-release
description: Gate decision accept / revise / replan / abandon
---

Follow the **assess-release** skill. Record the gate on the active plan. On accept, set harness-board initiative status `done` via `initiative_upsert` when MCP is available; always pass `workspace` (absolute path of the agent’s project root — or another workspace’s absolute path for cross-board work).