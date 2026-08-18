# Initiative: Board attention dot

Status: active  
Tier: feature  
Stage: 11-gate  
Skips: _(none)_  
Last updated: 2026-08-17

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Operators scanning the harness board need a glanceable cue when an **agent (or other in-flight task) is waiting for their direct reply** — typically AskQuestion in the matching Cursor chat — so they can jump to that chat instead of treating every Active board as equally urgent.
- **Framing:** **Active** already means work is in flight (planning / building / integrating). That is too coarse: parked work, phone testing, merge/PR follow-up, and “agent stuck on a question” all look similar. The new signal is an unread-style **attention dot**, not an unread-message store: it must **not** clear on viewing the board; it clears only when that initiative no longer needs a human answer.
- **Why now:** Multi-board sidebar + Active pills make ongoing work visible, but not *which* board/initiative is blocked on the human.
- **Success look like:** If an initiative is waiting on AskQuestion (any coarse status except parked/done), is sitting on the **post-slice human gate** (read the chat, judge next step) until a **decisive** choice, or has a **blocked** slice, its swimlane header shows a persistent attention dot. The left-nav board row shows the same dot iff **any** of its initiatives do. Opening or selecting the board does not clear dots. Parked / done never show the dot. A deferral such as “I’ll test on the device and let you know” (status may become `integrating`) is **not** enough to clear the dot — Active is not a substitute until they accept / park / abandon / send work back.

**Locked:** 2026-08-17 (human: AskQuestion hang triggers regardless of Planning/Building/Integrating; not a separate board-level unread flag; sidebar = OR of initiatives).  
**Bounce:** 2026-08-17 — post-slice release gate must turn the dot on; deferral to device testing must **keep** it on until a decisive gate choice. Supersedes “integrating never has a dot.”

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
- **Constraints:** View-only UI stays view-only. No “mark read on open.” Compatible with existing `state.json` (missing field = false). Parked/done suppress the dot even if a stale flag or blocked slice remains.
- **Interfaces / boundaries:**
  - Persist **`awaitingHuman: boolean`** on the **initiative** (not on the board summary as a stored field). Default `false`. Set/cleared via `initiative_upsert` (orchestrator / ask-user), same as title/blurb/status.
  - **Derive** `initiativeNeedsAttention(initiative, slices)`:
    1. If status is `parked` or `done` → false.
    2. Else true if `awaitingHuman === true`.
    3. Else true if any slice on that initiative has `column === "blocked"` (bounce/escalate even if nobody set the flag).
  - **Board sidebar:** `hasAttention` = any initiative on that board satisfies (2)/(3) under (1). Computed when listing `state.json`; **not** a second persisted board flag. `/api/boards` may echo the computed boolean (like `hasActiveWork` / `active`).
  - **UI:** unread-style disc (not a second “ACTIVE” word) on (a) sidebar `nav-item` (b) initiative title row. Independent of selected vs Active. Poll/reload already refreshes HTML when mtime changes.
  - **ask-user skill:** before AskQuestion, `initiative_upsert` with `awaitingHuman: true` (when board MCP + known plan/initiative). After the answer: set `false` only if the human is **not** still on the hook. If another question follows immediately, leave/set `true`. Soft-fail if MCP unavailable.
  - **assess-release / post-slice gate:** when entering the gate, set `awaitingHuman: true` (even if no AskQuestion UI yet). Clear only on a **decisive** outcome: accept (`done`), park, abandon, revise/replan (work continues — then follow ask-user rules). Do **not** clear for deferrals (“I’ll test on device / let you know”) even if status becomes `integrating`.
  - Slice-approve / other human gates that already use ask-user inherit the flag; no extra `ready`-column heuristic.
- **Risks:** Agents forgetting to set/clear `awaitingHuman` → missed or sticky dots. Mitigate: blocked-slice derive; skill text; missing flag is false (no false positives from old JSON). Sticky true until next upsert is acceptable (still waiting or agent died mid-question).
- **Decision:** design change needed (initiative field + derive + UI + skill). Locked 2026-08-17.

---

## 5. Verification design

- **End-to-end acceptance:**
  - Unit: `initiativeNeedsAttention` / `boardHasAttention` — parked/done never; integrating+no flag+no blocked false; planning/building/integrating + `awaitingHuman` true; building + blocked slice true even if flag false; board OR across initiatives; viewing is not an input (no API to clear on GET `/`).
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
  3. **`ask-user-skill`** — harness-2000 `ask-user` **and** `assess-release` skills (+ brief README): set `awaitingHuman` around AskQuestion; **keep it true** through the post-slice gate until a decisive choice (not device-test deferral); mention blocked-slice derive.
- **Context each slice needs:** `plans/board-attention-dot.md` §4–§5; `plugins/harness-board/lib/{store,boards,server,mcp}.js`; existing Active UI as the pattern to mirror (not replace).
- **What stays human:** visual spot-check of the live board after plugin reload; confirm AskQuestion in a real chat sets the dot (slice 3).
- **What agents may do:** implement slices 1–3, run §5 tests, draft README bullets.
- **Stop / escalate:** if Cursor exposes a native “agent waiting on AskQuestion” API, bounce §4 instead of inventing a second store.

---

## 7. Implementation notes

- Approach / sequence: model → UI → skill.
- Key files: `lib/store.js`, `lib/boards.js`, `lib/mcp.js`, `lib/server.js`, `plugins/harness-2000/skills/ask-user/SKILL.md`.
- Bounce triggers → update §4 if a native wait signal appears.
- **Bounce log:** 2026-08-17 post-slice gate + deferral must keep attention (Intent + §4 + slice 3).
- **Approvals:** slices locked as model-derive → ui-dot → ask-user-skill. **Mass-approve all remaining** (2026-08-17): d27aedb9 (model-derive), dd6c085e (ui-dot), 9457bce1 (ask-user-skill). Still one implementer per slice.

## 8. Verification record

- **model-derive:** store + boards tests 19/19; reviewer approve; verifier pass. Board slice `d27aedb9` done.
- **ui-dot:** e2e attention persist on GET; Active-only no marker; `/api/boards` `attention`. Reviewer approve; verifier pass. Slice `dd6c085e` done.
- **ask-user-skill:** skills + README match §4. Reviewer approve; verifier pass. Slice `9457bce1` done. Live AskQuestion / plugin-reload visual still human.

## Gate (stage 11)

- **Decision:** pending human (assess-release 2026-08-17)
- **Notes:** All three slices verified. Reload Harness Board plugin (or `npm run board` from `plugins/harness-board`) to see dots. Installed MCP schema may lag until plugin cache refresh (`awaitingHuman` on `initiative_upsert`).
