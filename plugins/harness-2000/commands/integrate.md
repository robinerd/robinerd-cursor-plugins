---
name: integrate
description: Integration notes / PR hygiene after verify
---

# Integrate

Against the active plan:

1. Confirm review + §5 verify status (or recorded skips).
2. Help with PR summary, changelog, merge risks — do not expand scope.
3. Note integration in the plan; Stage → `10-integrate`.
4. When harness-board MCP is available, `initiative_upsert` with status `integrating` (soft-fail if unavailable). Always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead.
5. Suggest `/assess-release`.
