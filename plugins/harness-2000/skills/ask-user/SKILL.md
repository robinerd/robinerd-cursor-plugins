---
name: ask-user
description: >-
  Ask the human interactive clarifying questions (multi-choice + Custom).
  Use during §§1–6 planning/design when Intent, design, verification, or slices
  need a decision; before each implementation slice (or mass-approve); and
  whenever the user must choose. Prefer AskQuestion over prose lists. Stay in Agent mode.
---

# Ask user (interactive)

Stay in **Agent mode**. Do **not** switch to Plan mode to ask questions.

## When to use

- Clarifying §1 Intent, §4 System design, §5 Verification, or §6 slices
- Ambiguous product/tech tradeoffs before writing plan sections
- **Gate before implementation:** approve next slice vs mass-approve remaining
- Any fixed-choice decision where a freeform escape is useful

## How

1. Prefer the **`AskQuestion`** tool when available (native multi-choice UI).
2. One question per assistant turn. Short prompt; short option labels.
3. Always include exactly one freeform escape: **`Custom: …`** (user types the rest in chat after picking it, or types freely if the UI allows).
4. Do **not** also add "Other" / "Something else" — only `Custom: …`.
5. If `AskQuestion` is unavailable, ask the same options as a short prose list ending with `Custom: …`, then wait.

## Board attention (`awaitingHuman`)

When harness-board MCP is available and the active initiative is known (`planPath` / id):

- **Before** `AskQuestion` (or the prose fallback wait): `initiative_upsert` with `awaitingHuman: true`. Keep the existing `title` and `planPath`; do **not** wipe `status`. Soft-fail if MCP is unavailable.
- **After** the human answers: set `awaitingHuman: false` **only if they are no longer on the hook**. If another question follows immediately, leave or set `true`.
- Always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead.

Blocked slices already show the attention dot without this flag.

## Slice gate (required before coding)

Before starting implementation (or before each remaining slice unless mass-approved), ask:

**Prompt:** `Approve implementation for slice "<id/title>"?`

**Options:**

- `Approve this slice only` — run one implementer → review → verify cycle, then re-ask for the next slice
- `Mass-approve all remaining slices` — still implement **one slice per subagent** with review/verify between slices; skip re-asking until blocked or done
- `Pause / revise plan` — do not code; bounce or edit §§1–6
- `Custom: …`

Record the choice on the plan (§7 or a short “Approvals” note): per-slice vs mass-approved, which slice ids.

## Planning clarifications

When drafting or finishing §§1–6, if a decision would change the plan output, stop and ask with `AskQuestion` before locking that section. Examples: tier, “no design change?”, acceptance depth, slice boundaries, what stays human.

## After the answer

Apply the choice to the living plan, then continue the stage. Do **not** invent a default when the human was asked. Then clear or keep `awaitingHuman` as in **Board attention** above.
