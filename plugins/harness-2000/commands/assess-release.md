---
name: assess-release
description: Gate decision accept / revise / replan / abandon
---

Follow the **assess-release** skill. Record the gate on the active plan. On accept, set harness-board initiative status `done` via `initiative_upsert` when MCP is available.