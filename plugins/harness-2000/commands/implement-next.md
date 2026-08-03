---
name: implement-next
description: Implement the next §6 slice via implementer subagent
---

# Implement next

1. Read active plan §6; identify the next unfinished slice (ask if unclear).
2. Confirm §1 and §4 are decided (or Skips record bypass). If not, stop and say so.
3. Switch mindset to Agent: invoke the **implementer** subagent with that slice + plan path only.
4. On `replanning_required`, run `/bounce-plan`. Otherwise suggest `/review-current`.
