# Harness Board (Cursor plugin)

View-only local kanban for **praxis slices** — swimlane initiatives with slice cards tracked outside git. Sibling plugin to [harness-2000](../harness-2000); install from the same marketplace root.

Agents advance cards only via **named MCP tools** (tool name binds role). There is no freeform `move_card`.

## Status

v0.1.5: JSON store, transition engine, multi-board HTTP UI + **Streamable HTTP MCP** on the same server (`npm run board` → `/mcp`), and optional local stdio MCP (`mcp.json`).

## Persist path (folder-name identity)

Board state is keyed by the **last path segment** of the canonical workspace path (the repo folder name / slug). On Windows-style paths, the slug is case-folded. Two machines with different absolute paths but the same folder name (e.g. `…/robinerd-cursor-plugins`) share one bucket when they use the same `HARNESS_BOARD_DATA_ROOT` or when remote MCP writes on the host store.

On disk:

```text
~/.cursor/harness-board/<slug-hash>/state.json
```

(`slug-hash` is a truncated SHA-256 of the slug identity string — **not** of the full absolute path.)

**Legacy buckets:** Older installs used a hash of the full path. Run **`npm run migrate-slug` once per machine** (laptop and always-on host) to merge legacy buckets into slug buckets and remove orphan dirs. After migration, runtime code uses slug identity only; there is no migrate-on-start.

| Env | Purpose |
|-----|---------|
| `HARNESS_BOARD_DATA_ROOT` | Optional store root instead of `~/.cursor/harness-board` (board server, stdio MCP, migrate CLI) |
| `HARNESS_BOARD_HOST` | Listen address for `npm run board` (default `127.0.0.1`; use Tailscale IP or `0.0.0.0` on an always-on host) |
| `HARNESS_BOARD_MCP_TOKEN` | When set, `/mcp` requires `Authorization: Bearer <token>`; when unset, `/mcp` is unauthenticated (local/dev only — set a token on any network-exposed host) |

MCP tool targeting does **not** use env or a global pointer. Every MCP tool requires an absolute `workspace` argument per call. (`HARNESS_BOARD_WORKSPACE` is ignored if set by MCP; the board UI may still use it as a default selection.)

**Plans:** Initiative markdown stays on the agent machine (`plans/<id>.md`). The board host does not need those files; runtime status (blurbs, slice notes, evidence) lives on the board.

## Board UI (`npm run board`)

No env vars required for the UI. The page shows a **left sidebar** of every board under `~/.cursor/harness-board/*/state.json`, ordered by `state.json` mtime (newest first). Click a board to load it (`/?workspace=…`). The UI polls `/api/boards` and reloads only when the **currently selected** board’s mtime changes.

**Active** means the board has ≥1 initiative in `planning` | `building` | `integrating` (`done` / `parked` do not count). Multiple boards may be Active at once. Sidebar selection (browsing) is independent of Active — switching the viewed board does not clear Active marks elsewhere and does not auto-follow any pointer.

The unread-style **attention dot** (sidebar row and initiative header) is independent of Active. It means an **unacknowledged** wait in the matching chat (`awaitingHuman`), not a Blocked column. It does **not** clear on viewing the board. It **does** clear when the human replies in chat (including “I’ll get back to you later”). Parked and done never show it. AskQuestion / post-slice gates set `awaitingHuman` via `initiative_upsert` (orchestrator / ask-user / assess-release).

Each initiative box has a **left disclosure arrow**. Collapsed boxes show the title, status, and blurb only (plan URL and slice columns hidden). Integrating initiatives may also show an optional bold **Next steps:** line in that header. **Done** initiatives start collapsed; other statuses start expanded. Toggles are remembered in `localStorage` so poll reloads do not reset them.

## Install

1. Point Cursor at the **repository root** (`robinerd-cursor-plugins` — folder with `.cursor-plugin/marketplace.json`).
2. Enable **Harness Board** beside **Harness 2000**, then reload if needed.
3. Confirm MCP tools under **Settings → Tools & MCP** (`harness-board`: `board_get`, `list_slices`, transition tools). Every tool requires `workspace`.

On first MCP connect, `bin/mcp.js` runs `npm install --omit=dev` into the plugin install/cache directory if `@modelcontextprotocol/sdk` is missing (Cursor does not ship `node_modules` with plugins). Install logs go to stderr only so stdio MCP stays clean.

### MCP enable

Plugin root `mcp.json` is auto-discovered. It starts:

```text
node ${CURSOR_PLUGIN_ROOT}/bin/mcp.js
```

- Prefer `${CURSOR_PLUGIN_ROOT}/bin/mcp.js` (plugin install root).
- If a local install does not expand that variable, use a path relative to the plugin root: `./bin/mcp.js` (cwd is typically the plugin install path for plugin MCP).
- Optional: set `HARNESS_BOARD_DATA_ROOT` in the MCP env for a custom store root (not for targeting a board).

Pass absolute `workspace` on every tool call (agent root by default; any other absolute path is allowed for intentional cross-board work). Missing / empty / unexpanded `${…}` templates → structured error.

UI remains separate: open the board with `npm run board` (not an MCP tool).

### Remote MCP (always-on host + laptop)

On the **host**, leave the board server running (same process serves the kanban UI and MCP):

```bash
cd plugins/harness-board   # or plugin install path
export HARNESS_BOARD_HOST=100.x.x.x    # Tailscale IP or 0.0.0.0
export HARNESS_BOARD_MCP_TOKEN='…'     # shared secret; required on exposed hosts
npm run board
```

MCP endpoint: `http://<host>:4173/mcp` (default port `4173`).

On **client** machines, point Cursor at that URL (project or user `mcp.json`). Example:

```json
{
  "mcpServers": {
    "harness-board": {
      "url": "http://100.x.x.x:4173/mcp",
      "headers": {
        "Authorization": "Bearer ${env:HARNESS_BOARD_MCP_TOKEN}"
      }
    }
  }
}
```

Set `HARNESS_BOARD_MCP_TOKEN` in the client environment to match the host. Agents still pass absolute `workspace` on every tool call (their local clone path); the server maps it to the same slug bucket as on the host when folder names match.

**Hard rule — no local fallback:** When using remote MCP, **disable** the Harness Board plugin stdio MCP on the laptop (turn off the plugin MCP entry or override `mcp.json` so only the remote `url` exists). If both remote and local stdio are enabled and the remote is down, Cursor may still expose local tools and agents will write a **local** board — silent split-brain. Unreachable remote → tools fail; that is preferred over silent local writes.

Run **`npm run migrate-slug` once** on the host and once on each client that had legacy local buckets before switching to remote (or a shared `HARNESS_BOARD_DATA_ROOT`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | Store + transition + boards + e2e + MCP smoke + HTTP MCP tests |
| `npm run board` | Multi-board HTTP server (UI + `/mcp`; port 4173 by default) |
| `npm run mcp` | stdio MCP server (local plugin / `mcp.json` only) |
| `npm run migrate-slug` | One-off legacy full-path-hash → slug bucket migration |

## HTTP API

Server binds `HARNESS_BOARD_HOST` or `127.0.0.1`, port `4173` by default, and logs the listen URL. In-process callers can pass `options.port` to select another port, including `0` for an ephemeral port.

Streamable HTTP MCP is mounted at **`POST/GET /mcp`** on the same server (see remote setup above).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Multi-board HTML (sidebar + selected board); `?workspace=` / `?hash=` |
| `GET` | `/api/boards` | `{ boards, selectedWorkspace }` — each board may include `active` / `hasActiveWork` |
| `GET` | `/api/state` | Board JSON for `?workspace=` / `?hash=` (or selected default) |
| `POST` | `/api/select` | `{ "workspace": "…" }` — acknowledged; selection is URL/client-side (does not write a global pointer) |
| `POST` | `/api/action` | Named transition: `{ "action": "…", "workspace"?: "…", … }` |

## MCP tools

Every tool requires `workspace` (absolute path). Store bucket = folder-name slug (see **Persist path**). MCP does not read or update `active-workspace.txt`.

| Tool | Role | Purpose |
|------|------|---------|
| `board_get` | any | Full board state |
| `list_slices` | any | Slice list (optional `initiativeId`) |
| `initiative_upsert` | orchestrator | Create/update initiative header (`blurb` and optional `nextSteps`) |
| `slice_add` | orchestrator | Add slice in `ready` |
| `slice_approve` | orchestrator | `ready` → `approved` |
| `implementer_start` | implementer | `approved`\|`implement` → `implement` |
| `implementer_submit` | implementer | `implement` → `review` |
| `reviewer_verdict` | reviewer | `approve`→`verify` / `revise`→`implement` / `bounce`→`blocked` |
| `verifier_verdict` | verifier | `pass`→`done` / `fail`→`implement` / `bounce`\|`replan`→`blocked` |
| `human_unblock` | orchestrator/human | `blocked` → `implement` |
| `park` | orchestrator | Park initiative |

Illegal transitions and bad args return structured error JSON including `allowedActions` when applicable. No `move_card` tool.

## Layout

```text
.cursor-plugin/plugin.json
mcp.json              # Cursor auto-discovery
package.json
bin/board.js          # npm run board (UI + /mcp)
bin/mcp.js            # stdio MCP entry
bin/migrate-slug.js   # npm run migrate-slug
lib/store.js
lib/transitions.js
lib/boards.js         # list / resolve multi-board
lib/workspace.js      # path helpers (legacy pointer unused by MCP)
lib/server.js         # HTTP + /mcp + dispatchAction + multi-board HTML
lib/mcp-http.js       # Streamable HTTP MCP transport
lib/mcp.js            # MCP tools → shared engine
lib/migrate-slug.js   # legacy bucket migration
test/
```
