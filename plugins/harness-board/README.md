# Harness Board (Cursor plugin)

View-only local kanban for **praxis slices** — swimlane initiatives with slice cards tracked outside git. Sibling plugin to [harness-2000](../harness-2000); install from the same marketplace root.

Agents advance cards only via **named MCP tools** (tool name binds role). There is no freeform `move_card`.

## Status

v0.1.4: JSON store, transition engine, multi-board local HTTP UI (`npm run board`), and stdio MCP (`mcp.json`).

## Persist path

Board state is keyed by workspace folder path and written under:

```text
~/.cursor/harness-board/<workspace-hash>/state.json
```

(`workspace-hash` is a truncated SHA-256 of the absolute workspace path.)

Override for tests / local runs:

| Env | Purpose |
|-----|---------|
| `HARNESS_BOARD_DATA_ROOT` | Optional store root instead of `~/.cursor/harness-board` (used by `bin/mcp.js` and the board UI) |

MCP tool targeting does **not** use env or a global pointer. Every MCP tool requires an absolute `workspace` argument per call. (`HARNESS_BOARD_WORKSPACE` is ignored if set.)

## Board UI (`npm run board`)

No env vars required for the UI. The page shows a **left sidebar** of every board under `~/.cursor/harness-board/*/state.json`, ordered by `state.json` mtime (newest first). Click a board to load it (`/?workspace=…`). The UI polls `/api/boards` and reloads only when the **currently selected** board’s mtime changes.

**Active** means the board has ≥1 initiative in `planning` | `building` | `integrating` (`done` / `parked` do not count). Multiple boards may be Active at once. Sidebar selection (browsing) is independent of Active — switching the viewed board does not clear Active marks elsewhere and does not auto-follow any pointer.

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

## Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | Store + transition + boards + e2e + MCP smoke tests |
| `npm run board` | Local multi-board server (random port, prints URL; no workspace env required) |
| `npm run mcp` | stdio MCP server (Cursor launches this via `mcp.json`) |

## HTTP API

Server binds `127.0.0.1` on a free port and logs `http://127.0.0.1:<port>`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Multi-board HTML (sidebar + selected board); `?workspace=` / `?hash=` |
| `GET` | `/api/boards` | `{ boards, selectedWorkspace }` — each board may include `active` / `hasActiveWork` |
| `GET` | `/api/state` | Board JSON for `?workspace=` / `?hash=` (or selected default) |
| `POST` | `/api/select` | `{ "workspace": "…" }` — acknowledged; selection is URL/client-side (does not write a global pointer) |
| `POST` | `/api/action` | Named transition: `{ "action": "…", "workspace"?: "…", … }` |

## MCP tools

Every tool requires `workspace` (absolute path). Store bucket = hash of that path. MCP does not read or update `active-workspace.txt`.

| Tool | Role | Purpose |
|------|------|---------|
| `board_get` | any | Full board state |
| `list_slices` | any | Slice list (optional `initiativeId`) |
| `initiative_upsert` | orchestrator | Create/update initiative header |
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
bin/board.js          # npm run board
bin/mcp.js            # stdio MCP entry
lib/store.js
lib/transitions.js
lib/boards.js         # list / resolve multi-board
lib/workspace.js      # path helpers (legacy pointer unused by MCP)
lib/server.js         # HTTP + dispatchAction + multi-board HTML
lib/mcp.js            # MCP tools → shared engine
test/
```
