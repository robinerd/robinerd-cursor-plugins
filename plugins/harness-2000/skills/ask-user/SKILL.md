---
name: ask-user
description: >-
  Ask the human interactive clarifying questions (multi-choice + Custom).
  Use during §§1–6 planning/design when Intent, design, verification, or slices
  need a decision; before each implementation slice (or mass-approve); and
  whenever the user must choose. Prefer AskQuestion over prose lists. Stay in Agent mode.
  Opt-in auto mode (plain language, not a slash command) is defined in this skill.
---

# Ask user (interactive)

Stay in **Agent mode**. Do **not** switch to Plan mode to ask questions.

## When to use

- Clarifying §1 Intent, §4 System design, §5 Verification, or §6 slices
- Ambiguous product/tech tradeoffs before writing plan sections
- **Gate before implementation:** approve next slice vs mass-approve remaining
- Any fixed-choice decision where a freeform escape is useful
- **Auto mode** (below) is the opt-in exception: skip AskQuestion for slice gate and for recommended/default choices that are reversible or locally fixable; still ask on the escalate list

## How

1. Prefer the **`AskQuestion`** tool when available (native multi-choice UI).
2. One question per assistant turn. Short prompt; short option labels.
3. Always include exactly one freeform escape: **`Custom: …`** (user types the rest in chat after picking it, or types freely if the UI allows).
4. Do **not** also add "Other" / "Something else" — only `Custom: …`.
5. If `AskQuestion` is unavailable, ask the same options as a short prose list ending with `Custom: …`, then wait.

## Board attention (`awaitingHuman`)

When harness-board MCP is available and the active initiative is known (`planPath` / id):

- **Before** `AskQuestion` (or the prose fallback wait): `initiative_upsert` with `awaitingHuman: true`. Keep the existing `title` and `planPath`; do **not** wipe `status`. Soft-fail if MCP is unavailable.
- **After** the human replies in that chat: set `awaitingHuman: false`. That includes a non-answer such as “Sure, let me get back to you later.” A slice may stay `blocked`; the wait is still **acknowledged**. If another question follows immediately, set `true` again.
- Always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead.
- Set `awaitingHuman` **only when actually waiting** on the human. Do **not** set it for questions skipped under auto mode.

Do **not** treat a slice in the Blocked column as attention by itself.

## Auto mode (source of truth)

Opt-in session instruction for **this initiative in this chat**. There is **no** `/auto-mode` (or other) slash command — the human says it in plain language.

**Trigger:** the human says **“auto mode”** or a close paraphrase (**use auto mode**, **run in auto mode**) in this chat. Scope: this initiative until it is **done**, **parked**, or **revoked**.

**Record** on the living plan **§7**:

- `Auto mode: on`
- mass-approve remaining slice ids (same effect as slice-gate **Mass-approve all remaining slices**)

**Revoke:** the human says to **stop auto mode** / go back to asking. Record `Auto mode: off` on §7; resume AskQuestion and the per-slice gate.

**Recommended choice:** pick the option labeled **`(Recommended)`**, else the **documented default in the skill currently running** (e.g. start-work default **feature**). Apply it, log the choice + assumption on plan §7, continue.

**Do not AskQuestion** in auto mode for:

- the **slice gate**
- planning/design choices that have a recommended/default and are **reversible or locally fixable** afterward

**Still AskQuestion** when:

- **(a)** continuing could change whether they want the initiative, or want a different **shape** of it
- **(b)** unconsidered extra products/codebases, a large scope jump, or cross-system coupling
- **(c)** no recommended/default and the fork is not safely reversible
- **(d)** **unsure** whether (a–c) apply — prefer one extra question
- **(e)** **stage 11 always** (accept / revise / replan / abandon) even in auto mode
- **(f)** secrets, prod, or other **§6-marked human checks**

**Deferred log:** every auto-taken decision and residual risk goes on plan **§7** (short bullets). **List them in the final summary** at `/integrate` and at the stage 11 ask.

Auto mode does **not** skip §§1–6, review, verify, or one-slice-per-implementer. Default praxis (ask before locking; slice gate) is unchanged until the human opts in.

**Examples (judgment, not exhaustive):**

- Reversible / log: pick start-work default `feature`; take `(Recommended)` slice-boundary wording; mass-approve remaining after auto mode is recorded.
- Ask: adding another repo/product they did not mention; changing who the feature is for; shipping to prod; no default and the choice cannot be cheaply undone; **unsure** → ask.

Other skills and commands **point here**; do not duplicate a conflicting rubric.

## Slice gate (required before coding)

Before starting implementation (or before each remaining slice unless mass-approved **or auto mode is recorded on §7**), ask:

**Prompt:** `Approve implementation for slice "<id/title>"?`

**Options:**

- `Approve this slice only` — run one implementer → review → verify cycle, then re-ask for the next slice
- `Mass-approve all remaining slices` — still implement **one slice per subagent** with review/verify between slices; skip re-asking until blocked or done
- `Pause / revise plan` — do not code; bounce or edit §§1–6
- `Custom: …`

Record the choice on the plan (§7 or a short “Approvals” note): per-slice vs mass-approved, which slice ids.

In auto mode, skip this AskQuestion; still record mass-approve remaining slice ids on §7. Orchestrator still calls `slice_approve` on the board for each slice before implement (see `/implement-next`).

## Planning clarifications

When drafting or finishing §§1–6, if a decision would change the plan output, stop and ask with `AskQuestion` before locking that section — **unless** auto mode applies and the choice has a recommended/default that is reversible or locally fixable (then apply, log on §7, continue). If (a–f) above apply, still ask. Examples when not in auto mode: tier, “no design change?”, acceptance depth, slice boundaries, what stays human.

## After the answer

Apply the choice to the living plan, then continue the stage. Do **not** invent a default when the human was asked. Auto mode is the opt-in exception: apply recommended/default per **Auto mode** above, then log. Then clear `awaitingHuman` as in **Board attention** above (any acknowledgement) after a real wait — not after skipped questions.
