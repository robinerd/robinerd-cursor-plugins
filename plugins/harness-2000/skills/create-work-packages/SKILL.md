---
name: create-work-packages
description: >-
  Fill plan §6 work breakdown into executable slices for agents/humans.
  Use after §1–§5 (or recorded skips) or /create-work-packages.
  Confirm slice shape with ask-user. Stay in Agent mode.
---

# Create work packages (§6 only)

Stay in **Agent mode**.

Edit **only** `## 6. Work breakdown` (Stage → `6-breakdown`).

- Ordered slices with boundaries and dependencies — small enough for **one implementer subagent turn** each.
- Context each slice needs; what stays human vs agent.
- Stop/escalate conditions (when to reopen §1–§4).
- Mark which slices need a human check after verify (secrets, prod, ambiguous UX, breaking).
- If slice boundaries are ambiguous, use **ask-user** before locking §6.
- After §6 is written, remind: implementation starts only via `/implement-next` with the slice gate (approve one | mass-approve remaining).
- **Harness-board (when MCP available):** after writing §6 slices, call `slice_add` for each slice onto the initiative (use `board_get` / `list_slices` if you need the initiative id). Soft-fail if MCP unavailable — note `board MCP unavailable` and continue.
