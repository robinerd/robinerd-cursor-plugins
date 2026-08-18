# Initiative: collapsible-initiatives

Status: done  
Tier: trivial  
Stage: 11-gate  
Skips: 2–6 — trivial UI-only; recorded below  
Last updated: 2026-08-18  
Approvals: implement in this chat (user chose trivial 2026-08-18)  
ui-collapse: review approve + verify pass (2026-08-18)  
Gate: accept (2026-08-18)

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Operators scanning a board with several initiatives (especially finished ones) need to shrink swimlanes so Done work does not dominate the page.
- **Framing:** Each initiative box is always fully expanded (header, blurb, plan URL, seven slice columns). Done work still occupies a full kanban row. Collapse should be a left-side disclosure arrow: collapsed height is header + summary (blurb) only; plan URL and columns are hidden; expand restores the current layout.
- **Why now:** The live board already has Done initiatives stacked at the bottom at full height.
- **Success look like:** Arrow toggle on the left of each initiative. Collapsed = title/status + blurb; no plan link, no columns. Expanded = current UI. Any **Done** initiative starts collapsed. Non-done start expanded. A user toggle survives the existing poll `location.reload()`.

---

## 2. Alternatives

*(Skipped — trivial.)*

## 3. Priority

*(Skipped — trivial; this session, user-requested.)*

## 4. System design

*(Skipped as a full design pass — trivial. Recorded decision: **design change needed**, UI-only.)*

- `plugins/harness-board/lib/server.js` HTML/CSS/inline JS only. No MCP, store, or `state.json` field.
- SSR: `status === "done"` → `is-collapsed` (parked is **not** default-collapsed).
- Client: `localStorage` per initiative id overrides the SSR default so poll reloads keep the user’s last toggle.

## 5. Verification design

*(Skipped as a full pass — trivial. Recorded checks:)*

- Unit: Done HTML has `is-collapsed` + toggle; planning/parked do not default-collapse; plan-link and `.columns` remain in the DOM.
- E2E: upsert `done` → GET `/` collapsed marker; upsert `planning` → expanded.
- `npm test` in `plugins/harness-board`. Human visual spot-check of the live board.

## 6. Work breakdown (AI-oriented)

*(Skipped — trivial; single slice in this chat.)*

- **Slice:** `ui-collapse` — disclosure toggle, Done default, localStorage restore, tests.

## 7. Implementation notes

- Approach: `details`-like class on `<section.initiative>`; chevron button; CSS hide `.plan-link` and `.columns` when `.is-collapsed`.
- Key files: `plugins/harness-board/lib/server.js`, `test/server.test.js`, `test/e2e.test.js`.
- Bounce: if collapse must persist server-side for multi-browser, reopen §4.

## 8. Verification record

- Review: approve ([Review](11521ddb-a411-44b7-bd84-c56d8255e5ae)) — UI-only; Done default collapse; localStorage prefs; no store/MCP change.
- Verify: pass ([Verify](14b6b91d-6c7b-4398-80bf-041c882dbbd0)) — `npm test` in `plugins/harness-board`: 62 pass / 1 fail (pre-existing Darwin `plan.test.js`). Named collapse unit + e2e asserts held. Human visual spot-check remaining.

## Gate (stage 11)

- **Decision:** accept  
- **Notes:** Human accepted 2026-08-18 after visual check of live board.
