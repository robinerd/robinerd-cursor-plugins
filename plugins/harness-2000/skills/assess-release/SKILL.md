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
5. Humans own accept/abandon for breaking changes; agent recommends only when unsure. **Even in auto mode**, still AskQuestion at this gate (ask-user escalate **(e)**). Do not skip the human.

## Board attention (`awaitingHuman`)

When harness-board MCP is available and the active initiative is known (`planPath` / id):

- **Entering the gate** (before/when asking): `initiative_upsert` with `awaitingHuman: true`. Keep title/`planPath`; do not wipe status. Soft-fail if MCP is unavailable. Always pass `workspace`. Auto mode does **not** skip this wait — still set `awaitingHuman` and ask the human.
- Clear `awaitingHuman` when the human **acknowledges** in chat — a decisive choice **or** a deferral such as “I’ll test on the device and let you know.” Work may stay `integrating`; slices may stay `blocked`.
- If another question follows immediately, set `awaitingHuman: true` again (follow **ask-user**).
- Do **not** treat a slice in the Blocked column as attention by itself.
