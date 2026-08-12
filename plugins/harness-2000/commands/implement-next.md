---
name: implement-next
description: Gate + implement next §6 slice via implementer subagent, then review/verify
---

# Implement next

Stay in **Agent mode**. Do not switch to Plan mode.

1. Read active plan §6; identify the next unfinished slice (use **ask-user** if unclear). Prefer **harness-board** `list_slices` / `board_get` for runtime column status when MCP is available; plan.md stays Intent/design. Always pass `workspace` (absolute path of the agent’s project root) on every board tool call. To operate on another board, pass that workspace’s absolute path instead.
2. Confirm §1 and §4 are decided (or Skips record bypass). If not, stop and say so.
3. **Approval gate** (unless this session already has a recorded mass-approve for remaining slices): follow **ask-user** slice gate — `Approve this slice only` | `Mass-approve all remaining slices` | `Pause / revise plan` | `Custom: …`. Do not start coding without an answer.
4. **After human approval** (when board MCP available): call `slice_approve` for that board slice id (include `workspace`). Soft-fail if unavailable — note `board MCP unavailable` and continue. Optionally set initiative status `building` via `initiative_upsert` when first slice enters the build loop (same `workspace` rule).
5. Invoke the **implementer** subagent with **only** that slice + plan path + **board slice id** (keep parent context lean). One slice per subagent run. Implementer must use `implementer_start` / `implementer_submit` when board MCP is available (with `workspace` on each call).
6. On `replanning_required` → `/bounce-plan`. On `blocked` → escalate to human via ask-user (`human_unblock` / `park` on board when available, with `workspace`).
7. On `completed` → `/review-current` (fresh **code-reviewer**), then `/verify-current` (**behavior-verifier** vs §5 for this slice) — pass the same board slice id.
8. If §6 marked a human check for this slice (or review/verify is risky), pause with **ask-user** before the next slice.
9. If mass-approved and more slices remain, repeat from step 4 without re-asking; otherwise re-run the slice gate for the next slice.
10. Update plan Stage / §7 notes with evidence pointers after each cycle (do not thrash plan.md as the runtime column source of truth when the board is available).
