---
name: assess-release
description: >-
  Stage 11 gate: decide accept / revise / replan / abandon using plan + review + §5 evidence.
  Use after verify or /assess-release.
---

# Assess release

Using the active plan, review verdict, and §8 / verify output:

1. Summarize: Intent met? Design respected? §5 passed?
2. Gate: **accept** | **revise locally** | **replan** | **escalate to human** | **abandon**
3. Record the decision at the bottom of the plan (or §8).
4. When harness-board MCP is available and the gate is **accept**, `initiative_upsert` with status `done` (soft-fail if unavailable). Always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead. Other outcomes may leave status as-is or use `park` when parking.
5. Humans own accept/abandon for breaking changes; agent recommends only when unsure.
