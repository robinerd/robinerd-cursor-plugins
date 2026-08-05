# Initiative: harness-board

Status: active  
Tier: feature  
Stage: 11-gate  
Skips: _(none)_  
Last updated: 2026-08-05  
§1: locked (2026-08-05)  
§4: locked (2026-08-05)  
§5: locked (2026-08-05)  
§6: locked (2026-08-05) — slices S1–S6  
Approvals: mass-approve S1–S6 (2026-08-05)  
Current slice: S6 done — awaiting release gate  
S1–S6: all review approve + verify verified (2026-08-05)

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Plugin authors and harness-2000 users (human + agents) need durable, visible work tracking for praxis slices — outside git — so humans can overview progress and cheaper/weaker subagents stay on the correct workflow path without editing living plan markdown for status.
- **Framing:** Today harness tracks stage/slice progress mainly in `plans/<id>.md` and chat. That couples status to versioned docs and trusts LLMs to respect column/stage rules. We need a sibling plugin **`harness-board`**: a local Kanban UI + MCP API where agents advance cards only via enforced transitions that mirror harness stages (implement → review → verify → …), not freeform moves.
- **Why now:** Harness workflow is working; next step is moving implementer/verifier/etc. to local/cheaper models that obey soft rules less reliably. Hard transition enforcement + human-readable board reduces wrong-path thrash and plan-file corruption risk before that model shift.
- **Hierarchy (product decision):**
  - **Only slice cards move** across workflow columns (the subagent handoff atom).
  - **Initiative is a group heading** (swimlane), not a moving card: overall status aligned to coarse harness phases (e.g. Planning / Implementing / Finished — exact labels in §4), a short blurb of the requested feature, and a link to `plans/<id>.md`.
  - Intra-slice tasks stay notes/checklist on the slice card — they do not get columns or agent handoffs.
  - **Runtime status lives on the board**; plan.md remains Intent/design (§§1–6 content), not the place agents thrash stage/column state.
- **Success look like:**
  - `harness-board` installs next to harness-2000; local board site runs on an ephemeral/random port via a documented script/npm command.
  - Board state persists outside the consumer repo’s versioned tree (human can reopen and see history).
  - UI: initiatives as headings with status + blurb + plan link; slices as the only movable cards.
  - MCP exposes agent operations; illegal transitions are rejected by server logic (e.g. verifier may only pass→next or reject→implement, never invent columns).
  - Harness-2000 agents/commands are wired to use the board for slice workflow tracking.
  - Soft scoping: agent docs state which tools/roles apply; hard scoping: MCP rejects wrong-column / wrong-action even if a confused agent calls the “wrong” tool.

## 2. Alternatives

- **Existing ways:**
  - Keep thrashing Stage/§7 in `plans/*.md` (current) — no UI, soft LLM discipline only.
  - External trackers (Jira/Linear/GitHub Projects) via MCP — heavy auth/ops; columns won’t match praxis without custom workflows; still LLM-trust on transitions unless we wrap them.
  - Generic kanban MCP packages — freeform move cards; doesn’t encode harness verdicts or initiative swimlanes.
- **Comparison:** External tools overfit and under-enforce. Plan.md status is the pain we’re removing. A thin local board+MCP owned in this marketplace is the smallest fit.
- **Decision:** **proceed** — build `harness-board` as a sibling plugin.

## 3. Priority

- **Rank:** Top of this repo’s backlog (only active initiative; enables safer cheap-model subagents next).
- **Capacity / opportunity cost:** Net-new plugin + harness-2000 wiring; delays other marketplace plugins until v1 ships.
- **Decision:** **top-of-queue**.

## 4. System design

- **Decision:** **design change needed** — new plugin + harness-2000 agent/command integration.
- **Products / codebases impacted:**
  - New: `plugins/harness-board/` (UI server, store, MCP, scripts).
  - Update: `plugins/harness-2000/` (agents, commands/skills that create or advance slices).
  - Update: `.cursor-plugin/marketplace.json` (register `harness-board`).
  - Consumer workspaces: board data outside versioned tree; optional gitignore only if we ever place a pointer file in-repo (prefer none).
- **Constraints:**
  - No freeform “move to column”; only named transitions validated by a transition table in code.
  - Cursor cannot MCP-allowlist per subagent today → hard enforce in MCP; soft allowlists in agent docs; optional later `beforeMCPExecution` if we get reliable subagent identity (v1: do not depend on it).
  - Local-only; no cloud sync in v1.
  - Persist outside git; survive IDE restart.
  - Random/ephemeral local port for the website; print URL on start.
- **Data model (v1):**
  - **Initiative (swimlane header):** `id`, `planPath`, `title`, `blurb`, `status` ∈ `{planning, building, integrating, done, parked}`, `updatedAt`. Display labels: **Planning / Building / Integrating / Done / Parked**. Coarse harness phases (not per-column). Guidance: `planning` during §§1–6; `building` while slices flow implement→review→verify; `integrating` at stage 10; `done` after accept/gate; `parked` explicit. Auto-derive where obvious; orchestrator may set explicitly.
  - **Slice (only movable card):** `id`, `initiativeId`, `title`, `column`, optional `notes`/`checklist`, `evidence[]`, `history[]` (append-only transition log).
  - **Slice columns:** `ready` → `approved` → `implement` → `review` → `verify` → `done`, plus `blocked` (human/escalate). Bounce from review/verify may return to `implement` or set `blocked` + note (exact edges in transition table).
- **Transition table (enforced in MCP; draft — confirm):**

  | Tool / action | Actor | From | To | Extra payload |
  |---|---|---|---|---|
  | `initiative_upsert` | orchestrator | — | create/update header | planPath, blurb, status? |
  | `slice_add` | orchestrator | — | `ready` | title, initiativeId |
  | `slice_approve` | orchestrator | `ready` | `approved` | approval note |
  | `implementer_start` | implementer | `approved` \| `implement` (retry) | `implement` | — |
  | `implementer_submit` | implementer | `implement` | `review` | summary, files touched |
  | `reviewer_verdict` | reviewer | `review` | `verify` (approve) \| `implement` (revise) \| `blocked` (bounce) | verdict, findings |
  | `verifier_verdict` | verifier | `verify` | `done` (pass) \| `implement` (fail) \| `blocked` (bounce/replan) | verdict, evidence |
  | `human_unblock` / `park` etc. | orchestrator/human | `blocked` / any | per rules | reason |

  No generic `move_card`. Wrong actor/from/action → error with allowed actions listed.
- **MCP + process shape:**
  - One Node package: shared store + transition engine.
  - `npm run board` (or `node …/bin/board.js`): HTTP UI + JSON API on random free port; opens/logs `http://127.0.0.1:<port>`.
  - MCP stdio server (plugin `mcp.json`): same store; tools above + read tools (`board_get`, `list_slices`).
  - Store: single JSON file under user data dir keyed by workspace (e.g. `~/.cursor/harness-board/<hash>/state.json`) — exact path TBD by ask-user if needed; SQLite optional later.
- **UI:** Simple local page: initiative headers (status badge, blurb, plan link) grouping rows of slice cards in columns. **v1 human UI is view-only** — no drag, no transition buttons. Mutations only via MCP (agents/orchestrator). Human feedback controls deferred; may never be needed.
- **Harness-2000 wiring:**
  - `start-work` / create initiative → `initiative_upsert`.
  - `create-work-packages` → `slice_add` per §6 slice.
  - `implement-next` gate → `slice_approve` then spawn implementer with board slice id.
  - Agents: implementer/reviewer/verifier docs list allowed MCP tools + require calling the matching verdict tool before return.
  - Orchestrator rules: prefer board for runtime status; avoid rewriting plan Stage as source of truth.
- **Risks / unknowns:**
  - Subagents inherit all MCP tools → rely on transition table + **tool name binds role** (do not trust a free `actor` string alone).
  - Port/firewall / multiple workspaces — pin store by `workspaceFolder` env from mcp.json.
  - View-only UI may feel passive; accepted for v1.
- **Decided:** human UI view-only (2026-08-05); initiative statuses Planning / Building / Integrating / Done / Parked (2026-08-05); §4 locked (2026-08-05).
- **Defaults unless overridden:** persist at `~/.cursor/harness-board/<workspace-hash>/state.json`; store keyed by `${workspaceFolder}` from MCP/env.

## 5. Verification design

- **Check depth (locked):** full local drive script — spin board, exercise API happy + illegal paths, assert JSON state and UI/DOM (or HTML contains expected initiative/slice markers). Prefer catching transition bugs before agents rely on MCP.
- **End-to-end acceptance:**
  1. Plugin layout: `plugins/harness-board/` has manifest + `mcp.json` + runnable board script; marketplace lists it beside harness-2000.
  2. `npm run board` binds a random free localhost port, prints URL, serves view-only UI showing initiative headers (status, blurb, plan link) and slice cards in columns.
  3. Restart / reload store → same workspace fixture reappears (persistence outside repo git).
  4. Happy path via shared engine + HTTP JSON API (same code MCP will call): create initiative → add slices → approve → implementer_start/submit → reviewer approve → verifier pass → slice `done`; initiative status updates Planning→Building→… as designed.
  5. Illegal transitions rejected with clear errors: wrong column, unknown verdict, missing tool `move_card`.
  6. Drive script asserts response bodies + persisted state + fetched HTML includes initiative title/blurb/plan link and slice in expected column.
  7. Harness-2000 agents/commands document matching board tools (file spot-check); live Cursor MCP call is manual smoke only.
- **Integration / regression checks:**
  - Table-driven unit tests on transition table (legal/illegal).
  - Store round-trip test.
  - **`npm run test:e2e` (or equivalent):** starts server on ephemeral port against temp data dir, runs happy + illegal scenarios, tears down.
  - Optional thin MCP stdio smoke if cheap (spawn server, list tools, one read call); not a substitute for API drive script.
- **CI / delivery:** Tests runnable via `npm test` / `npm run test:e2e` in `plugins/harness-board`. Wire CI only if repo already has it or cost is trivial.
- **Out of scope for v1:**
  - Human UI mutations / drag-drop.
  - Per-subagent MCP allowlists (Cursor limitation).
  - Cloud sync, multi-user auth.
  - Full live MCP-inside-Cursor in CI.
  - Replacing plan.md Intent/design sections.

§5 locked (2026-08-05) — depth: full local drive script.

## 6. Work breakdown (AI-oriented)

Ordered slices — one implementer subagent each. Review + verify (§5) between slices.

### Slices

1. **`S1` Plugin skeleton + store**  
   - Create `plugins/harness-board/` manifest, `package.json`, README stub, marketplace entry.  
   - JSON store under `~/.cursor/harness-board/<hash>/state.json` keyed by workspace path; load/save; initiative + slice types (no transitions yet beyond create/update raw for tests).  
   - Context: §4 data model; marketplace.json.  
   - Human check: none.

2. **`S2` Transition engine**  
   - Implement transition table + named actions from §4; reject illegal with allowed-actions; append history; initiative status helpers.  
   - Table-driven unit tests (legal/illegal).  
   - Depends on S1.  
   - Human check: none.

3. **`S3` HTTP board server + view-only UI**  
   - `npm run board`: random port, print URL, JSON API wrapping the engine, view-only HTML (initiative headers + slice columns).  
   - Depends on S1–S2.  
   - Human check: brief visual glance after e2e (optional).

4. **`S4` Drive script / e2e (`test:e2e`)**  
   - Spin server on temp data dir; happy path + illegal path; assert JSON + HTML markers; teardown. Wire `npm test` / `npm run test:e2e`.  
   - Depends on S3.  
   - Human check: none (automated).

5. **`S5` MCP server**  
   - stdio MCP exposing same named tools (no `move_card`); `mcp.json` for plugin; tools call shared engine/store. Optional thin MCP list-tools smoke if cheap.  
   - Depends on S2 (S3 useful for parity).  
   - Human check: manual enable plugin + one tool call in Cursor (mark human).

6. **`S6` Harness-2000 wiring**  
   - Update agents (implementer/reviewer/verifier) + commands/skills (`start-work`, `create-work-packages`, `implement-next`, `review-current`, `verify-current`, praxis-core as needed) to upsert/approve/advance board cards; document allowed tools per role.  
   - Depends on S5.  
   - Human check: confirm docs read clearly; optional live orchestration smoke.

### What stays human
- Cursor plugin enable / reload; manual MCP smoke (S5).  
- Any product change to columns/statuses → bounce §4.

### What agents may do
- All code under `plugins/harness-board/` and harness-2000 wiring files; run `npm test` / `test:e2e`.

### Stop / escalate
- If Cursor MCP packaging can't load local plugin scripts → bounce §4 (process shape).  
- If UI needs mutations after all → bounce §1/§4 (explicitly deferred).

§6 locked (2026-08-05) — S1–S6 as above. Implementation only via slice gate + implementer subagents.

## 7. Implementation notes

- **Approvals:** mass-approve all remaining slices (S1–S6) recorded 2026-08-05. One implementer per slice; review + verify between slices; do not re-ask until blocked or done.
- Approach / sequence: S1 → S6 as §6.
- Bounce triggers → update §4 (or earlier) if reality diverges.

## 8. Verification record

- **S1:** verified — marketplace + manifest; store tests. Review: approve.
- **S2:** verified — transition table. Review: approve.
- **S3:** verified — random port UI; API happy path; `move_card`→400. Review: approve.
- **S4:** verified — e2e drive happy+illegal+HTML+persist. Review: approve.
- **S5:** verified — MCP named tools; role-bind fix; `npm test` **37/37**. Review: approve (after revise). Manual: enable plugin + live MCP call remaining.
- **S6:** verified — harness-2000 docs wire role tools + soft-fail; board still 37/37. Review: approve.

## Gate (stage 11)

- **Agent recommendation:** **accept** after human confirms live MCP smoke (enable harness-board, one `board_get` or upsert).
- **Decision:** _(awaiting human)_ accept | revise | replan | escalate | abandon  
- **Notes:** Intent met (sibling plugin, enforced transitions, view-only UI, harness wiring). §5 automated depth met; live Cursor MCP is the remaining smoke.
