# Initiative: mcp-multi-workspace-board

Status: done  
Tier: feature  
Stage: 11-gate  
Skips: _(none)_  
Last updated: 2026-08-12  
Notes: Board MCP **not** used for this initiative (shared board in use by other folders; tracking in plan only).  
Approvals: **mass-approve all remaining slices** (S1–S4) — 2026-08-12.

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Operators running multiple Cursor agents across different repos (and humans using the board UI) need each board MCP call and UI “Active” signal to reflect the correct project — without a single shared “current workspace” thrashing between chats.
- **Framing:** Today the harness-board MCP server binds all tools to one workspace via env + a global `active-workspace.txt` pointer. Concurrent agents overwrite that pointer; the UI marks one board Active and follows the pointer when browsing. Agents cannot reliably target another board even when related work lives there.
- **Why now:** Multi-agent / multi-repo praxis is already broken in practice (wrong board reads/writes; UI Active flips on click). Blocking trustworthy slice tracking.
- **Success look like:**
  1. Every MCP tool call **requires** `workspace`; no MCP call depends on or updates a global active workspace.
  2. Agents in workspace A can intentionally read/mutate board B by passing B’s path.
  3. Board UI marks **every** board with ongoing initiative work as Active (not a single pointer); switching the viewed board in the browser does not change Active marks or auto-navigate away.
  4. harness-2000 skills/agents instruct callers to pass the agent-root workspace on every board MCP call (override allowed for cross-board work).

**Locked:** 2026-08-12 (human confirmed).

---

## 2. Alternatives

- **Existing ways:** (1) Manually rewrite `active-workspace.txt` / switch agent root before each call — fragile, races. (2) HTTP `/api/action` already accepts `body.workspace` — agents don’t use HTTP. (3) One MCP server process per workspace — Cursor plugin MCP is shared; not controllable per chat.
- **Comparison:** Workarounds are not good enough under concurrent agents. Must change MCP contract + UI Active semantics + agent guidance.
- **Decision:** proceed.

---

## 3. Priority

- **Rank:** Unranked insert — unblocks multi-repo praxis; treat as top-of-queue for this plugin repo.
- **Capacity / opportunity cost:** Localized to harness-board + harness-2000 docs/agents; no consumer app code.
- **Decision:** top-of-queue for this session.

---

## 4. System design

- **Products / codebases impacted:** `plugins/harness-board` (MCP, workspace resolve, boards list/UI); `plugins/harness-2000` (skills, commands, agents, praxis rule / board usage notes).
- **Constraints:**
  - `workspace` is **required** on every MCP tool — missing → structured error; no env fallback; no `active-workspace.txt` for MCP.
  - MCP must not call `rememberActiveWorkspace`.
  - UI must not write/follow `active-workspace.txt` on board navigation; no single-board Active pointer.
  - Store remains keyed by workspace path hash under `~/.cursor/harness-board/` (unchanged).
  - Agents may pass any absolute workspace path (cross-board allowed).
- **Interfaces / boundaries:**
  - **MCP:** Add required `workspace` string to every tool schema. Per-call resolve: sanitize/expand `args.workspace` only; reject empty/unexpanded templates. Process env `HARNESS_BOARD_WORKSPACE` is ignored for tool execution (may remain in `mcp.json` harmlessly or be removed in docs).
  - **UI Active:** Board is Active iff ≥1 initiative status ∈ `{planning, building, integrating}` (`done` / `parked` do not count). Multiple boards may be Active. Sidebar “selected” is independent of Active.
  - **UI poll:** Reload only when the **currently selected** board’s mtime changes. Remove auto-navigate / auto-follow of former active pointer.
  - **HTTP:** Selection via `?workspace=` / `?hash=` or newest mtime; stop defaulting selection from `active-workspace.txt`. Stop writing pointer on GET `/` select and on `/api/select` (endpoint may return ok but no-op, or removed from docs). Mutations still accept `body.workspace`.
  - **Board summaries:** `listBoardSummaries` (or annotate step) exposes `hasActiveWork` / `active` from initiative statuses in `state.json`.
  - **harness-2000:** Every board MCP call site (skills, commands, agents, praxis-core board bullet) must pass `workspace` = absolute agent workspace root by default; document intentional override for another board.
- **Risks:** Plugin cache reload required for new MCP schemas; callers omitting `workspace` fail until docs land with the code. Slightly heavier board list (parse initiatives).
- **Decision:** design change needed.

**Locked:** 2026-08-12 (`workspace` always required).

---

## 5. Verification design

- **End-to-end acceptance:**
  1. MCP `board_get` / mutation without `workspace` → error; with `workspace` A vs B → independent store buckets; concurrent-style sequential calls to A then B do not require pointer changes.
  2. MCP calls do not create/update `active-workspace.txt`.
  3. UI: two boards with planning/building/integrating initiatives both show Active; a board with only done/parked does not; selecting board B in the browser does not clear Active on A and does not auto-redirect.
- **Integration / regression:** `npm test` in `plugins/harness-board` (store, transitions, boards, mcp, e2e).
- **CI / delivery:** existing package tests; no new CI pipeline required for v1.
- **Out of scope for v1:** Migrating/deleting historical `active-workspace.txt`; marketplace publish/version bump ritual; live Cursor multi-window E2E; dedicated HTTP e2e for multi-Active (covered by unit tests + existing e2e where practical).

**Locked:** 2026-08-12 (recommended: unit + `npm test`).

---

## 6. Work breakdown (AI-oriented)

| ID | Slice | Boundary | Depends | Status |
|----|-------|----------|---------|--------|
| S1 | MCP required `workspace` | Schema + `callBoardTool` / `createHarnessBoardMcpServer`: require `workspace`; never remember; ignore env for tool path; tests for missing/present/cross-workspace | — | done (review approve, verify pass) |
| S2 | UI Active + no pointer thrash | `listBoardSummaries` active flag; HTML Active pills for all active boards; remove poll auto-follow + remember-on-select; HTTP selection without active pointer; tests | S1 | done (review approve, verify pass) |
| S3 | harness-2000 call guidance | Skills/commands/agents/README/praxis-core: pass `workspace` on every board tool; cross-board override note | S1 | done (review approve) |
| S4 | README / mcp.json docs | harness-board README + mcp.json note that env is not used for tool targeting | S1–S2 | done (review approve) |

- **Context:** `plugins/harness-board/lib/{mcp,workspace,boards,server}.js`, tests; `plugins/harness-2000/**` board call sites.
- **What stays human:** Plugin reload / confirm MCP schema in Cursor Settings after install; visual spot-check of UI Active pills if desired.
- **What agents may do:** Implement S1–S4, run `npm test`, update docs.
- **Stop / escalate:** If Cursor cannot surface required tool args → bounce §4; if Active definition needs empty-initiative boards → bounce §1/§4.

**Locked:** 2026-08-12 (4 slices).

---

## 7. Implementation notes

- **Approvals:** mass-approve S1–S4 (2026-08-12).

---

## 8. Verification record

- **S1:** review approve; behavior pass (§5.1–2). `node --test test/mcp.test.js` 8/8. Full `npm test` 50 pass / 1 pre-existing `plan.test.js` Darwin fail (out of scope).
- **S2:** review approve; behavior pass (§5.3). `node --test test/boards.test.js test/mcp.test.js` 13/13.
- **S3:** review approve; all harness-2000 board call sites prescribe required `workspace` + cross-board override.
- **S4:** review approve; README + mcp.json match required per-call `workspace` and multi-Active UI docs.
- **Regression (post S4):** `node --test test/mcp.test.js test/boards.test.js test/store.test.js test/transitions.test.js test/e2e.test.js` → 51/51 pass. Known Darwin fail in `plan.test.js` remains out of scope.

---

## Gate (stage 11)

- **Decision:** accept (2026-08-12)
- **Notes:** Intent met (per-call workspace, multi-Active UI, no MCP/UI pointer thrash, harness-2000 guidance). §5.1–3 covered by tests + review. Human: reload plugins for new MCP schemas. Board MCP not updated for this initiative (by design).
