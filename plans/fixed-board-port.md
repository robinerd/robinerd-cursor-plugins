# Initiative: fixed-board-port

Status: done  
Tier: trivial  
Stage: 11-gate  
Skips: 2–6 — trivial CLI default change; decisions recorded below  
Last updated: 2026-08-18  
Approvals: mass-approve remaining slices; use recommended default port 4173; human check at end

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Developers running `npm run board` need a stable URL they can bookmark and reuse.
- **Framing:** The board currently binds an ephemeral port, so every launch changes the URL. Make the CLI use a predictable fixed default while retaining programmatic test flexibility.
- **Why now:** Local workflows and documentation refer to the board URL, but random allocation makes repeated use inconvenient.
- **Success look like:** `npm run board` listens on `127.0.0.1:4173` by default and prints that URL; in-process callers can still select another port when needed.

## 2. Alternatives

*(Skipped — trivial.)*

## 3. Priority

*(Skipped — trivial; user-requested.)*

## 4. System design

*(Skipped as a full design pass — trivial. Recorded decision: design change needed.)*

- `startBoardServer` gains a fixed default port of `4173` and an optional `options.port` override.
- Existing in-process tests continue using ephemeral ports explicitly; no API or state changes.

## 5. Verification design

*(Skipped as a full pass — trivial. Recorded checks:)*

- Unit/integration test verifies the default and explicit port behavior.
- README documents the stable default.
- `npm test` in `plugins/harness-board`.
- Human check: run `npm run board`, open the printed URL, and confirm the board loads.

## 6. Work breakdown (AI-oriented)

*(Skipped — trivial; one implementation slice.)*

- **Slice:** `fixed-port` — update server default, tests, and README.
- **What stays human:** final live-board check.
- **Stop / escalate:** if port 4173 is occupied or callers depend on random allocation, reopen §4.

## 7. Implementation notes

- Recommended port: `4173` (common local preview convention, unprivileged, easy to recognize).
- One implementer slice, mass-approved; review and verification follow.
- Key files: `plugins/harness-board/lib/server.js`, `test/server.test.js`, `README.md`.

## 8. Verification record

- Review: approve — default 4173, explicit `options.port` including `0`, focused scope.
- Verify: pass — `node --test test/server.test.js` → 5/5; live `node bin/board.js` printed and served `http://127.0.0.1:4173`.
- Full suite: 64/65; the sole failure is the pre-existing unrelated Darwin `test/plan.test.js` Windows traversal case.
- Human visual check: pass — user confirmed “works” after opening the fixed-port board.

## Follow-up: structured Integrating next steps

- **Intent:** Integrating initiative headers should present the stable summary and the human-readable next action consistently, including when the initiative is collapsed.
- **Design decision:** Add an optional `nextSteps` initiative field through the store, HTTP dispatch, and MCP schema. Render it only for Integrating initiatives as a second line with bold `Next steps:`; do not infer or rewrite existing blurbs.
- **Verification:** Unit tests assert escaped summary/next steps, the second-line markup, and that collapsed Integrating initiatives retain the header content while hiding only details.
- **Slice:** `integrating-next-steps` — implement the field, rendering, docs, and focused tests.

## Follow-up verification record

- Implemented optional `nextSteps` through store, HTTP action dispatch, and MCP `initiative_upsert`.
- Integrating headers render the summary followed by a line break and bold `Next steps:` label; the content remains outside `.initiative-details`, so collapse does not hide or truncate it.
- Focused server tests pass.
- Full suite: 64/66 passed; the two failures are pre-existing/environmental: Darwin path traversal expectation and port 4173 already occupied.

## Gate (stage 11)

- **Decision:** accept
- **Notes:** Automated verification passed and the user confirmed the live board works.
