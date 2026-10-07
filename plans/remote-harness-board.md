# Initiative: remote harness board

Status: active  
Tier: feature  
Stage: 10-integrate  
Skips: _(none)_  
Last updated: 2026-10-07

§1 locked (conversation). §4 locked (conversation: MCP on `npm run board`, folder slug, bearer token, no local fallback, no file lock).

Living document — update in place when later work changes earlier conclusions.  
**§1 Intent (feature) and §4 System design stay distinct — never merge.**

---

## 1. Intent

- **Customer / internal need:** Operators who run harness-board on an always-on machine (reachable over Tailscale) and use Cursor agents on other machines. They need those agents to talk to the **same** board MCP instance/store as the host, not a second local stdio board — even when absolute clone paths differ.
- **Framing:** Today the plugin only exposes stdio MCP (Cursor spawns a local process). Cursor already supports remote MCP via `url`, but this repo does not expose a network MCP endpoint, so “add the MCP from the other machine” is impossible. Board buckets are also keyed by full absolute path hash, so laptop vs host paths would miss each other even after remote MCP lands. Ship host-side network MCP **and** identify boards by a stable slug derived from the workspace folder name (last path segment), accepting same-name collisions as usually desirable when the folder matches the repo. `plans/*.md` stay local to the agent machine; the board host need not see them — operators rarely read plans there; status that matters should live on the board (blurbs, next steps, slice notes/evidence), not depend on remote plan file I/O.
- **Why now:** User already has the always-on host + Tailscale; remote MCP alone is insufficient without cross-machine board identity; plan sync is a distraction.
- **Success look like:** Host runs network MCP; laptop Cursor uses that `url` (no local stdio board). Agents pass their local workspace path; board resolves to the same slug/bucket as on the host when folder names match. Plan markdown visibility on the host is **out of success** for v1. Documented setup.

## 2. Alternatives

- **Existing ways:** Shared `HARNESS_BOARD_DATA_ROOT` (path-hash / concurrency pain); local stdio MCP proxying HTTP `/api/action` (works but invents a second protocol path); browse UI only over Tailscale (view, not agent).
- **Comparison:** Shared disk and HTTP-proxy are workable but worse than Cursor’s native remote MCP `url` path the user asked for.
- **Decision:** proceed — build network MCP on the host.

## 3. Priority

- **Rank vs current backlog:** insert as current top-of-queue (this session).
- **Capacity / opportunity cost:** localized to harness-board (+ README / harness-2000 board notes if needed).
- **Decision:** top-of-queue — user-requested now; unlocks multi-machine praxis.

## 4. System design

- **Products / codebases impacted:** `plugins/harness-board` (identity, remote MCP HTTP entry, docs/tests); light `plugins/harness-2000` docs/notes that agents still pass `workspace` and that remote clients use `url` + bearer header. No consumer app code.
- **Constraints:**
  - Cursor remote MCP via Streamable HTTP `url` (stdio remains for local plugin install).
  - Auth: optional shared bearer — if `HARNESS_BOARD_MCP_TOKEN` is set, require `Authorization: Bearer …` (or equivalent header Cursor can send) on MCP HTTP; if unset, allow unauthenticated (local/dev only; docs warn).
  - Board identity: slug = last path segment of the (canonicalized) workspace path; bucket key derived from that slug only (case-fold on Windows-style). Intentional same-name collisions. **One-off migration CLI** (run once per machine — laptop + always-on host) from legacy full-path-hash buckets into slug buckets (merge by id if both exist, then remove orphans). After migration, **code supports slug identity only** — no dual-key runtime; no migrate-on-board-start.
  - Plan file HTTP (`/api/plan`) stays host-local filesystem; remote agents do not rely on it. No plan sync in v1.
  - Trust network: operator binds host for Tailscale (configurable `host`/`port` env); token is the app-layer gate.
- **Interfaces / boundaries:**
  - Extend **`npm run board`** (same HTTP server as the kanban UI) to also serve Streamable HTTP MCP at `/mcp`, using SDK `StreamableHTTPServerTransport` (stateless preferred) + existing `createHarnessBoardMcpServer` / `callBoardTool`. No separate `mcp:http` process — one always-on server is enough. Stdio MCP (`bin/mcp.js` / plugin) remains for local-only use.
  - Bind: keep default port `4173`; make host configurable (e.g. `HARNESS_BOARD_HOST`, default `127.0.0.1`) so the always-on box can bind a Tailscale IP or `0.0.0.0`. Breaking/compat not a concern (sole consumer).
  - Client `mcp.json` shape: `{ "url": "http://<host>:4173/mcp", "headers": { "Authorization": "Bearer ${env:HARNESS_BOARD_MCP_TOKEN}" } }`.
  - **No local fallback:** laptop must **not** also run the plugin stdio harness-board. If both are enabled and the remote is down, Cursor may still expose local tools and agents will write a local board. Ops rule: disable/remove the Harness Board plugin MCP (or override with project/user `mcp.json` that only has the remote `url` entry). Unreachable remote → tools fail / unavailable — preferred over silent local writes. Document this hard.
  - Workspace arg unchanged at the tool boundary (absolute path from agent); store maps it through **folder-name identity**.
- **Risks / unknowns:** Cursor transport auto-detect quirks; token header name Cursor accepts; migration edge cases (two legacy paths with different basenames vs same basename merge). Basename collisions across unrelated repos. Concurrent multi-machine writers: store still does plain `writeFile` of `state.json` (no flock); prior “fixes” were orphan-bucket merge on path identity and dropping the global `active-workspace.txt` pointer — **not** cross-process write locking. Accept for v1.
- **Decision:** **design change needed** — mount remote MCP on `npm run board` + folder-slug identity + **explicit migrate CLI (once per machine) then slug-only code** + optional bearer token; plans stay local; no new concurrency lock.

## 5. Verification design

- **End-to-end acceptance:**
  1. Two different absolute paths with the same last segment resolve to the same store bucket; different basenames do not.
  2. `npm run board` with token set: unauthenticated `/mcp` rejected; bearer accepted; MCP tool round-trip (`board_get` / a mutation) persists under the slug bucket.
  3. Host bind env works (listen not only hard-coded `127.0.0.1` when overridden).
  4. Fixture with a legacy full-path-hash bucket migrates into the slug bucket (merge + orphan removed); subsequent loads use slug only.
  5. README documents: server `npm run board` + token/host env; laptop `url` MCP; **disable local plugin stdio**; one-off migration behavior; no plan sync.
- **Integration / regression:** `npm test` in `plugins/harness-board` (existing suite green + new identity/migration/MCP HTTP cases). Stdio MCP still works locally.
- **CI / delivery:** same `npm test`; no new CI job required.
- **Out of scope for v1:** live Tailscale multi-machine smoke (human optional after ship); plan file remote visibility; `state.json` flock; keeping dual identity forever; OAuth.

## 6. Work breakdown (AI-oriented)

- **Slices:**
  1. **`folder-slug-identity`** — Change board identity to last path segment (Windows case-fold as today); ship **explicit migrate CLI** for legacy full-path-hash → slug (merge + delete orphans); afterward **slug-only** runtime; tests for identity + migration. No MCP/HTTP yet.
  2. **`board-mcp-http`** — Mount Streamable HTTP MCP at `/mcp` on the board server; optional bearer via `HARNESS_BOARD_MCP_TOKEN`; configurable listen host (`HARNESS_BOARD_HOST`); tests for auth reject/accept + tool smoke over HTTP.
  3. **`remote-board-docs`** — README (+ brief harness-2000 note): remote setup, token, no local fallback, slug identity, plans stay local.
- **Context each slice needs:** `plans/remote-harness-board.md` §4–§5; `plugins/harness-board/lib/{workspace,store,boards,server,mcp}.js`, `bin/board.js`, tests; SDK Streamable HTTP from `@modelcontextprotocol/sdk`.
- **What stays human:** Run migrate CLI once on laptop and once on always-on host after ship; optional Tailscale + laptop `mcp.json` smoke; disable local plugin MCP on laptop when using remote.
- **What agents may do:** Implement one slice at a time; `npm test`; draft docs in slice 3.
- **Stop / escalate:** Cursor cannot speak Streamable HTTP to `/mcp` → bounce §4 (SSE or proxy). Slug collisions worse than expected → bounce identity. Token header Cursor rejects → bounce auth header shape.

## 7. Implementation notes

- **Approvals:** mass-approve remaining — `folder-slug-identity` (ce48b045), `board-mcp-http` (3d5226b7), `remote-board-docs` (b325087b)
- **Auto mode:** on (this initiative + this chat until done/parked/revoked)
- **Auto-taken decisions:** migrate = explicit CLI once per machine; MCP on `npm run board`; bearer token; no local fallback; no state.json flock in v1

## 8. Verification record

- **folder-slug-identity:** review approve ([Review](82c269bc-f053-4180-b975-294ccb766342)); verify pass ([Verify](8350cfc8-7c6f-42fb-a19d-f62472a2e5b9)) — §5.1/§5.4 + `npm test` 72/72.
- **board-mcp-http:** review approve ([Review](dff84ac5-43c8-4654-8f8e-594fbf5b5c4e)); verify pass ([Verify](da5653d8-c70d-4c71-93f9-51b5186a3050)) — §5.2/§5.3 + `npm test` 78/78.
- **remote-board-docs:** review approve ([Review](6f0c0cf8-4ecb-48a9-944c-c2b716748b07)); verify pass ([Verify](288f3a56-41f5-4658-8bf5-faaba12ffecc)) — §5.5 README acceptance.
- **Local migrate-slug (2026-10-07):** `scanned=9 slugBuckets=9 removed=9` under `~/.cursor/harness-board`. Host still needs one run after deploy.
- Final `npm test` in `plugins/harness-board`: 78/78.

## Gate (stage 11)

- **Decision:**  
- **Notes:**
