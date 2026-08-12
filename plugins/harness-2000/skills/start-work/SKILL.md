---
name: start-work
description: >-
  Start an initiative: pick tier, create plans/<id>.md from template, set stage/skips.
  Use when beginning non-trivial work or user says start work / new initiative.
  Stay in Agent mode — do not switch to Plan mode. Clarify with ask-user / AskQuestion.
---

# Start work

Stay in **Agent mode**. Never switch to Plan mode.

1. Clarify short name + tier with **ask-user** / `AskQuestion` when not already given: `trivial | feature | breaking | spike` (default `feature`), plus `Custom: …`.
2. Ensure the plan template exists:
   - Prefer workspace `plans/_TEMPLATE.md`.
   - If missing, run **bootstrap-plans** (bundled template at `<pluginRoot>/templates/plans/_TEMPLATE.md` — resolve via `${CURSOR_PLUGIN_ROOT}` or `../../templates/plans/_TEMPLATE.md` from any harness-2000 skill dir). Do **not** look for `plugins/harness-2000/…` inside the consumer repo.
3. Copy `plans/_TEMPLATE.md` → `plans/<kebab-name>.md`.
4. Fill front matter: Status `draft`, Tier, Stage `1-intake`, Skips per tier:
   - **trivial:** record skips for stages 2–6 if user confirms direct fix; else still open a thin plan.
   - **feature / breaking:** Skips none; complete §§1–6 in this Agent chat before coding.
   - **spike:** note time-box in Intent; Skips may include 10–11; do not treat spike output as shipped feature.
5. **Harness-board (when MCP available):** after creating `plans/<id>.md`, call `initiative_upsert` with `title`, `planPath`, blurb from Intent (or short placeholder until §1 is filled), and status `planning`. Always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead. Soft-fail if MCP unavailable — note `board MCP unavailable` and continue.
6. Offer next: `/define-feature` or fill §1 now (use **ask-user** for open decisions).
