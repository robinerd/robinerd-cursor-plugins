---
name: start-work
description: >-
  Start an initiative: pick tier, create plans/<id>.md from template, set stage/skips.
  Use when beginning non-trivial work or user says start work / new initiative.
  Stay in Agent mode — do not switch to Plan mode.
---

# Start work

1. Ask for short name + tier: `trivial | feature | breaking | spike` (default `feature`).
2. Copy `plans/_TEMPLATE.md` → `plans/<kebab-name>.md` (or plugin `templates/plans/_TEMPLATE.md` if repo template missing).
3. Fill front matter: Status `draft`, Tier, Stage `1-intake`, Skips per tier:
   - **trivial:** record skips for stages 2–6 if user confirms direct fix; else still open a thin plan.
   - **feature / breaking:** Skips none; complete §§1–6 in this Agent chat before coding.
   - **spike:** note time-box in Intent; Skips may include 10–11; do not treat spike output as shipped feature.
4. Stay in **Agent mode**. Do not switch to Plan mode. Offer next: `/define-feature` or fill §1 now.
