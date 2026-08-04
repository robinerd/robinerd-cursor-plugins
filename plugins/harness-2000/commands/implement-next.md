---
name: implement-next
description: Gate + implement next §6 slice via implementer subagent, then review/verify
---

# Implement next

Stay in **Agent mode**. Do not switch to Plan mode.

1. Read active plan §6; identify the next unfinished slice (use **ask-user** if unclear).
2. Confirm §1 and §4 are decided (or Skips record bypass). If not, stop and say so.
3. **Approval gate** (unless this session already has a recorded mass-approve for remaining slices): follow **ask-user** slice gate — `Approve this slice only` | `Mass-approve all remaining slices` | `Pause / revise plan` | `Custom: …`. Do not start coding without an answer.
4. Invoke the **implementer** subagent with **only** that slice + plan path (keep parent context lean). One slice per subagent run.
5. On `replanning_required` → `/bounce-plan`. On `blocked` → escalate to human via ask-user.
6. On `completed` → `/review-current` (fresh **code-reviewer**), then `/verify-current` (**behavior-verifier** vs §5 for this slice).
7. If §6 marked a human check for this slice (or review/verify is risky), pause with **ask-user** before the next slice.
8. If mass-approved and more slices remain, repeat from step 4 without re-asking; otherwise re-run the slice gate for the next slice.
9. Update plan Stage / §7 notes with evidence pointers after each cycle.
