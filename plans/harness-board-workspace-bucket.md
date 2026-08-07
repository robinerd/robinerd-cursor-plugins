# Initiative: harness-board workspace bucket

Status: active  
Tier: trivial  
Stage: 11-gate  
Skips: 2 (bugfix, no alternatives tradeoff); 3 (unranked / unblock agents now); 4 (localized store+sanitize fix, no new product surface); 5 (covered by unit tests + repro checks in §8); 6 (single thin slice)  
Last updated: 2026-08-07

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Agents and UI using harness-board must see one board per workspace; `initiative_upsert` then `slice_add` / `board_get` must agree.
- **Framing:** `~` in workspace paths is not expanded by `path.resolve`, creating a second hash bucket; `loadState` reads by call-path while `saveState` writes by JSON `workspacePath`, so mutations can land in the canonical bucket while reads stay on the orphan.
- **Why now:** Blocks attaching slices to new initiatives (false `unknown initiativeId`).
- **Success look like:** One path → one state file; after upsert, board_get and slice_add see the same initiative; tilde paths canonicalize; orphan buckets whose JSON path hashes elsewhere are merged into the canonical file.

## 2. Alternatives

_(skipped — trivial)_

## 3. Priority

_(skipped — trivial)_

## 4. System design

_(skipped — trivial; localized fix in `lib/workspace.js` + `lib/store.js`, optional orphan consolidate on load)_

## 5. Verification design

_(skipped as formal stage; checks)_

- Unit: `~/…` sanitizes to home-expanded path; load+save stay on same hash; orphan with mismatched folder/hash merges into canonical and subsequent read sees merged initiatives.
- Regression: existing store/mcp/boards tests pass.

## 6. Work breakdown (AI-oriented)

_(skipped as formal stage; single slice)_

- **Slice A:** Canonicalize workspace paths (expand `~`); couple load/save to one store key; consolidate orphan buckets on load/save; tests.

## 7. Implementation notes

- Expand leading `~/` (and Windows `%USERPROFILE%` only if already in scope — prefer `~` fix matching the repro).
- `loadState` / `saveState`: always persist under `workspaceHash(canonicalKey)` and set `state.workspacePath` to that key.
- On load: if JSON `workspacePath` hashes to a different folder than the one we opened, treat as orphan — prefer merging into canonical (union initiatives/slices by id) and rewrite canonical; leave or remove orphan.
- **Approvals:** Approve this slice only — slice A (2026-08-07).

## 8. Verification record

- Review ([code-reviewer](89661910-509e-4cee-a99c-51dddcc64085)): **approve** (low: circular store↔workspace import; slice unionById ties without updatedAt).
- Verify ([behavior-verifier](848f238e-de12-4742-a677-9f14585a2909)): **pass** — tilde sanitize, one-hash load/save, orphan merge+delete; store/mcp/boards/e2e/transitions green. Unrelated Darwin `plan.test.js` Windows-path fail excluded.
- Board MCP column updates soft-failed throughout (live MCP on tilde workspace key / wrong board); fixed in-repo; heal after plugin reload + one load of affected workspaces.
- Diff: `workspace.js` / `store.js` / `store.test.js` (+327/−27).

## Gate (stage 11)

- **Decision:** _(pending human)_ — agent recommendation: **accept**
- **Notes:** Intent met; localized design; §5 pass. After accept: reload harness-board MCP so sanitize runs with new code; one `board_get` per affected workspace merges orphans on disk.
