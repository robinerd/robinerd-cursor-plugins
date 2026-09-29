# Initiative: Auto mode

Status: active  
Tier: feature  
Stage: 11-gate  
Skips: _(none)_  
Last updated: 2026-09-29  
Skips: _(none)_  
Last updated: 2026-09-25

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** The human running harness-2000 / praxis wants a **session instruction** (“auto mode”) so the agent stops nannying them on routine choices and slice gates, while still interrupting when the work might be the *wrong* work.
- **Framing:** Today `/ask-user` and the slice gate pause for almost every decision that could change plan output. That is correct when the human wants tight control. It is too expensive when they already trust the recommended path and would rather fix reversible mistakes later than sit through a quiz. The missing mode: **take recommended remaining decisions, mass-approve remaining slices, keep going** — except **hard-stop** on forks that could invalidate original intent, expand scope, or hit other systems/codebases they seem not to have considered. If such a risk might exist, **ask rather than assume**. Reversible / reasonably clear choices are **logged as assumptions** and listed in the **final summary**, not used as stop conditions.
- **Why now:** Operators already say things like “just pick the recommended option and mass-approve”; the plugin does not define that phrase, so agents either over-ask or silently invent a default. Encoding it in praxis makes the bias explicit and conservative on the expensive mistakes.
- **Success look like:** After the human says **auto mode** (plain language; no dedicated slash command), the agent does not wait on slice-by-slice approval or on AskQuestion for remaining decisions that have a recommended option and are safely reversible. It still stops (ask-user, `awaitingHuman`) when continuing could reasonably change *whether* or *how* they would want the initiative at all, or when blast radius/scope looks unconsidered. End of work includes an **assumptions / deferred-risk** list. Auto mode is not a license to skip §§1–6, subagent slice isolation, review, or verify.

**Locked:** 2026-09-25 (human: `lock_always_stop_gate`). Auto mode is **this initiative in this chat**, until the initiative is done/parked or the human revokes it. **Stage 11 always still asks the human** (accept / revise / replan / abandon) even in auto mode. Auto mode is not a license to skip §§1–6, subagent slice isolation, review, or verify.

---

## 2. Alternatives

- **Existing ways:** Slice gate already has **mass-approve remaining**. Humans can type “pick recommended.” Agents may still over-ask because praxis-core invariant 9/10 say to use AskQuestion and not invent defaults.
- **Comparison:** Informal chat instructions work only when the agent remembers them; they are not in the always-on rule. Weakening *all* AskQuestion would lose control for people who want the quiz.
- **Decision:** proceed — named opt-in mode in the plugin, default praxis unchanged.

## 3. Priority

- **Rank vs current backlog:** insert as current harness-2000 work (this session). Unrelated `harness-board` store/test dirty files stay out of this initiative.
- **Capacity / opportunity cost:** docs/process only if we keep it in skills/rules/commands; no runtime schema unless we later persist a board flag.
- **Decision:** top-of-queue.

## 4. System design

- **Products / codebases impacted:** `plugins/harness-2000` docs/process only. Consumer `plans/_TEMPLATE.md` stays in sync with the bundled template if §7 wording changes. **Not** harness-board schema/MCP/UI. **No** new slash command (human 2026-09-25: fold into ask-user + praxis-core).
- **Constraints:** Default praxis (ask before locking; slice gate) is unchanged until the human opts in. Auto mode is **this initiative + this chat** until done/parked/revoked. Stage 11 **always** still AskQuestion. Review/verify/subagent-per-slice stay mandatory. `awaitingHuman` only when the agent actually waits.
- **Interfaces / boundaries:**
  - **Trigger:** human says **auto mode** (or close paraphrase) in this chat after an initiative exists, or in the same message as the request. Record on the plan (§7): `Auto mode: on` + mass-approve remaining slice ids.
  - **Revoke:** human says to stop auto mode / go back to asking; record `Auto mode: off` and resume slice gate + AskQuestion.
  - **Recommended choice:** the option labeled `(Recommended)`, else the documented default in the skill currently running (e.g. start-work default `feature`). Apply it, write the choice + assumption on the plan, continue.
  - **Do not AskQuestion** in auto mode when: slice gate; planning/design choices with a recommended/default that is **reversible or locally fixable** afterward.
  - **Still AskQuestion** (escalate) when: (a) continuing could change whether they want the initiative, or want a different shape of it; (b) unconsidered extra products/codebases, large scope jump, or cross-system coupling; (c) no recommended/default and the fork is not safely reversible; (d) **unsure** whether (a–c) apply — prefer one extra question; (e) stage 11; (f) secrets / prod / other §6-marked human checks.
  - **Deferred log:** every auto-taken decision and residual risk goes on the plan (short bullets under §7) and is **listed in the final summary** at integrate / stage 11 ask.
  - **praxis-core:** extend invariants 9–10: auto mode is the exception to “do not invent a default,” with the escalate list above. Human gate is mass-approve when auto mode is on.
  - **ask-user:** auto-mode section is the source of truth; other skills keep pointing at ask-user rather than duplicating the rubric.
  - **implement-next / assess-release / praxis-help / README / status / template §7:** short pointers so agents do not re-ask the slice gate or skip the stage-11 question.
- **Risks:** Agents under-escalate (treat intent forks as “fix later”) or over-ask (auto mode does nothing). Mitigate: conservative escalate-if-unsure; concrete examples in ask-user; deferred log so missed stops are at least visible. Phrase matching is fuzzy — document “auto mode” plus obvious paraphrases (“use auto mode”, “run in auto mode”).
- **Decision:** design change needed (agent-facing policy in existing files). Locked 2026-09-25 (`ask_user_only`).

## 5. Verification design

- **End-to-end acceptance (docs read-back):**
  1. `skills/ask-user/SKILL.md` defines trigger, recommended-choice rule, escalate vs defer rubric (intent / unconsidered blast radius / unsure → ask; reversible → log), mass-approve equivalent, deferred log + final summary, stage 11 still asks, `awaitingHuman` only on real waits.
  2. `rules/praxis-core.mdc` states auto mode as the opt-in exception to inventing defaults / per-slice human gate; does not drop review/verify/subagent isolation.
  3. `commands/implement-next.md` skips the slice AskQuestion when auto mode is recorded; still `slice_approve` on the board.
  4. `skills/assess-release/SKILL.md` still sets `awaitingHuman` and asks the human at stage 11 even in auto mode.
  5. `commands/praxis-help.md`, `README.md`, `commands/status.md`, both plan templates (§7) mention auto mode without adding a slash command.
- **Integration / regression:** No JS tests. Confirm no new `commands/auto-mode.md`. Unrelated harness-board dirty files are not part of this change.
- **CI / delivery:** none for this plugin (docs). Verifier reads the files against the checklist above.
- **Out of scope for v1:** automated eval of agent judgment; persisting auto mode on the board; a dedicated slash command; changing default praxis for chats that never said auto mode.

## 6. Work breakdown (AI-oriented)

- **Slices:**
  1. **`auto-mode-docs`** — Write the auto-mode policy in `skills/ask-user/SKILL.md` and `rules/praxis-core.mdc` (invariants 9–10 / cheat sheet), then pointers in `implement-next`, `assess-release`, `praxis-help`, `README`, `status`, `templates/plans/_TEMPLATE.md`, workspace `plans/_TEMPLATE.md`. No new slash command. Must not contradict §§1/4/5.
- **Context each slice needs:** this plan §§1/4/5; current ask-user + praxis-core text.
- **What stays human:** stage 11 on *this* initiative; live-agent judgment after install is not verified in CI.
- **What agents may do:** edit the listed markdown; record assumptions on this plan.
- **Stop / escalate conditions:** any urge to add board fields, a slash command, or to skip stage 11 → bounce; do not “just add it.”

**Locked:** 2026-09-28 (human: one slice covering all listed markdown).

## 7. Implementation notes

Filled or refined when moving from §§1–6 decisions into implementation (still in Agent mode).

- Approach: policy source of truth in `plugins/harness-2000/skills/ask-user/SKILL.md`; praxis-core invariants 9–10 + cheat sheet; short pointers only in implement-next, assess-release, praxis-help, README, status, both plan templates §7. No JS, no board schema, no `commands/auto-mode.md`.
- Key files or modules (expected).
- Bounce triggers → update §4 (or earlier) if reality diverges.
- **Approvals:** per-slice — `auto-mode-docs` (`fa01f4cd-84c0-4b3f-985e-72235ccfa6e4`) approved 2026-09-29. One implementer subagent per slice; review + verify between slices.

## 8. Verification record

- **Review:** [code-reviewer](dee08460-2f7e-4651-9036-9168c8558d9a) **approve** (2026-09-29). Fit to §1/§4/§6; no bounce. Board slice moved review → verify.
- **Verify:** [behavior-verifier](fea2a280-2b6b-4369-9b73-7524e5e254fb) **pass** (2026-09-29). Docs read-back of §5.1–6 all pass; no `commands/auto-mode.md`; harness-board store dirt out of slice. Board slice **done**.
- **Integrate:** docs-only. Human asked to keep board status **integrating**; open a PR for merge + Cursor reload/test. Unrelated dirty `plugins/harness-board/lib/store.js` + `test/store.test.js` stay out of this PR.

## Gate (stage 11)

- **Decision:** _(deferred)_ keep **integrating** — human will merge the PR, reload the plugin, and test in Cursor.  
- **Notes:** Agent recommends **accept** after that live test. Do not mark the initiative `done` until they say so.
