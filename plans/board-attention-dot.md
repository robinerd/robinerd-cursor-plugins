# Initiative: Board attention dot

Status: done  
Tier: feature  
Stage: 11-gate  
Skips: _(none)_  
Last updated: 2026-08-18

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Operators scanning the harness board need a glanceable cue when an **agent (or other in-flight task) is waiting for their direct reply** — typically AskQuestion in the matching Cursor chat — so they can jump to that chat instead of treating every Active board as equally urgent.
- **Framing:** **Active** already means work is in flight (planning / building / integrating). That is too coarse: parked work, phone testing, merge/PR follow-up, and “agent stuck on a question” all look similar. The new signal is an unread-style **attention dot** for **unacknowledged** waits in the matching chat (AskQuestion / human gate). It must **not** clear on viewing the board. It **does** clear when the human replies in that chat — including a non-answer such as “Sure, let me get back to you later.” A slice remaining in the Blocked column is not itself a reason to show the dot.
- **Why now:** Multi-board sidebar + Active pills make ongoing work visible, but not *which* board/initiative is blocked on the human.
- **Success look like:** The dot is on while an agent is waiting for a first acknowledgement in the current chat (planning, building, integrating, slice gates — same rule). Sidebar ORs initiatives. Viewing the board does not clear it. Any chat acknowledgement (answer or “I’ll get back to you”) clears it even if work stays blocked/integrating. Parked / done never show the dot. Blocked-column cards alone never show the dot.

**Locked:** 2026-08-17 (human: AskQuestion hang triggers regardless of Planning/Building/Integrating; not a separate board-level unread flag; sidebar = OR of initiatives).  
**Bounce:** 2026-08-17 — post-slice release gate turns the dot on.  
**Bounce:** 2026-08-18 — Blocked column does **not** auto-derive the dot. Any chat acknowledgement (including deferral) clears `awaitingHuman`; slice may stay blocked.

---

## 2. Alternatives

- **Existing ways:** Active pill from initiative status; Blocked column already visible if you open the swimlane.
- **Comparison:** Active is the wrong granularity. Relying only on the Blocked column misses AskQuestion during planning (no slices yet) and requires opening the board. A browser “unread” that clears on view would hide still-waiting work.
- **Decision:** proceed — derive/show attention per initiative; aggregate on the board row.

---

## 3. Priority

- **Rank vs current backlog:** insert as current top-of-queue UI/UX on harness-board (this session).
- **Capacity / opportunity cost:** small surface (derive + CSS + one MCP field + ask-user skill); does not change slice columns.
- **Decision:** top-of-queue.

---

## 4. System design

- **Products / codebases impacted:** `plugins/harness-board` (store, boards list, HTML UI, MCP `initiative_upsert`); `plugins/harness-2000` ask-user skill (set/clear the initiative field around AskQuestion).
- **Constraints:** View-only UI stays view-only. No “mark read on open” of the board page. Compatible with existing `state.json` (missing field = false). Parked/done suppress the dot even if a stale flag remains. Slice `blocked` is unrelated to the dot.
- **Interfaces / boundaries:**
  - Persist **`awaitingHuman: boolean`** on the **initiative** (not on the board summary as a stored field). Default `false`. Set/cleared via `initiative_upsert` (orchestrator / ask-user), same as title/blurb/status.
  - **Derive** `initiativeNeedsAttention(initiative)`:
    1. If status is `parked` or `done` → false.
    2. Else true iff `awaitingHuman === true`.
    3. Do **not** inspect slice columns.
  - **Board sidebar:** `hasAttention` = any initiative on that board satisfies (2) under (1). Computed when listing `state.json`; **not** a second persisted board flag. `/api/boards` may echo the computed boolean (like `hasActiveWork` / `active`).
  - **UI:** unread-style disc (not a second “ACTIVE” word) on (a) sidebar `nav-item` (b) initiative title row. Independent of selected vs Active. Poll/reload already refreshes HTML when mtime changes.
  - **ask-user skill:** before AskQuestion, `initiative_upsert` with `awaitingHuman: true` (when board MCP + known plan/initiative). After **any** human acknowledgement in that chat — a real answer **or** a non-answer such as “Sure, let me get back to you later” — set `awaitingHuman: false`. If another question follows immediately in the same turn, set `true` again. Soft-fail if MCP unavailable.
  - **assess-release / post-slice gate:** when entering the gate, set `awaitingHuman: true`. Clear on the same acknowledgement rule (including deferrals). Work may stay `integrating` / slices may stay `blocked`.
  - Slice-approve / other human gates that already use ask-user inherit the flag; no `ready` or `blocked` column heuristic.
- **Risks:** Agents forgetting to set/clear `awaitingHuman` → missed or sticky dots. Mitigate: skill text; missing flag is false. Sticky true until next upsert is acceptable (still waiting or agent died mid-question).
- **Decision:** design change needed (initiative field + derive + UI + skill). Locked 2026-08-17; bounce 2026-08-18 dropped blocked-column derive and made acknowledgement (not decisive outcome) the clear rule.

---

## 5. Verification design

- **End-to-end acceptance:**
  - Unit: `initiativeNeedsAttention` / `boardHasAttention` — parked/done never; integrating+no flag false; planning/building/integrating + `awaitingHuman` true; building + blocked slice **without** flag false; board OR across initiatives; viewing is not an input (no API to clear on GET `/`).
  - HTML: initiative with attention has a stable marker (e.g. `data-attention`); sidebar item has the same when `hasAttention`; no marker when only Active.
  - Upsert round-trip: `awaitingHuman` persists; omitted on update preserves previous value (same pattern as status).
- **Integration / regression:** existing boards/e2e tests still pass (Active pills unchanged). Optional e2e: POST upsert awaitingHuman → GET `/` contains attention marker; GET again still has it.
- **CI / delivery:** `npm test` in `plugins/harness-board`.
- **Out of scope for v1:** detecting AskQuestion without agents calling upsert; dots on individual slice cards; notifying OS/Cursor chrome outside this HTML UI.

---

## 6. Work breakdown (AI-oriented)

- **Slices:**
  1. **`model-derive`** — Initiative `awaitingHuman` in store upsert + MCP schema; `initiativeNeedsAttention` / `boardHasAttention` (or equivalent names) in `lib/boards.js`; list summaries include computed `hasAttention`; tests in `test/store.test.js` + `test/boards.test.js`. No HTML.
  2. **`ui-dot`** — Sidebar + initiative header unread-style dots; `data-attention` markers; `/api/boards` annotation; CSS; server/e2e coverage that GET does not clear.
  3. **`ask-user-skill`** — harness-2000 `ask-user` **and** `assess-release` skills (+ brief README): set `awaitingHuman` around AskQuestion; **clear on any chat acknowledgement** (including deferral); do not derive from Blocked.
- **Context each slice needs:** `plans/board-attention-dot.md` §4–§5; `plugins/harness-board/lib/{store,boards,server,mcp}.js`; existing Active UI as the pattern to mirror (not replace).
- **What stays human:** visual spot-check of the live board after plugin reload; confirm AskQuestion in a real chat sets the dot (slice 3).
- **What agents may do:** implement slices 1–3, run §5 tests, draft README bullets.
- **Stop / escalate:** if Cursor exposes a native “agent waiting on AskQuestion” API, bounce §4 instead of inventing a second store.

---

## 7. Implementation notes

- Approach / sequence: model → UI → skill.
- Key files: `lib/store.js`, `lib/boards.js`, `lib/mcp.js`, `lib/server.js`, `plugins/harness-2000/skills/ask-user/SKILL.md`.
- Bounce triggers → update §4 if a native wait signal appears.
- **Bounce log:** 2026-08-17 post-slice gate turns attention on. 2026-08-18 blocked column does not auto-dot; acknowledgement (incl. “get back later”) clears the flag.
- **Approvals:** slices locked as model-derive → ui-dot → ask-user-skill. **Mass-approve all remaining** (2026-08-17): d27aedb9 (model-derive), dd6c085e (ui-dot), 9457bce1 (ask-user-skill). Still one implementer per slice.

## 8. Verification record

- **model-derive:** store + boards tests 19/19; reviewer approve; verifier pass. Board slice `d27aedb9` done.
- **ui-dot:** e2e attention persist on GET; Active-only no marker; `/api/boards` `attention`. Reviewer approve; verifier pass. Slice `dd6c085e` done.
- **ask-user-skill:** skills + README match §4. Reviewer approve; verifier pass. Slice `9457bce1` done.
- **Human live check (2026-08-18):** accepted after reload; bounce in PR #3 (blocked column does not auto-dot; chat acknowledgement including deferral clears the flag). Merged: #2 then #3.

## Gate (stage 11)

- **Decision:** accept (2026-08-18)  
- **Notes:** Human confirmed live behavior after plugin reload. Shipped via https://github.com/robinerd/robinerd-cursor-plugins/pull/2 and follow-up https://github.com/robinerd/robinerd-cursor-plugins/pull/3.
