# Harness Board (Cursor plugin)

View-only local kanban for **praxis slices** — swimlane initiatives with slice cards tracked outside git. Sibling plugin to [harness-2000](../harness-2000); install from the same marketplace root.

Agents advance cards only via **named MCP tools** (tool name binds role). There is no freeform `move_card`.

## Status

v0.1.5: JSON store, transition engine, multi-board local HTTP UI (`npm run board`), and stdio MCP (`mcp.json`).

## Persist path

Board state is keyed by **board workspace identity** (not necessarily the literal path you pass in) and written under:

```text
~/.cursor/harness-board/<workspace-hash>/state.json
```

(`workspace-hash` is a truncated SHA-256 of the resolved identity key — see **Workspace identity (remap)** below.)

### Workspace identity (remap)

Load, save, MCP, and the board UI all resolve the store bucket via `resolveBoardWorkspacePath`:

1. **Canonicalize** the path (trim, `~` expansion, `.`/`..`, unified separators, Windows drive letter).
2. **Realpath** when the path exists (directory junctions on Windows, symlinks elsewhere — aliases share one physical bucket).
3. **Git worktrees:** when the path is inside a git checkout, map to the **main worktree** root (first `worktree` line from `git worktree list --porcelain`). Linked worktrees therefore read and write the same board as the primary checkout.

Soft-fail: missing paths, non-git trees, or git errors stop after realpath/canonicalize (no worktree remap).

On load, the store also merges **orphan buckets** whose saved `workspacePath` canonicalizes to the same identity but live under an old hash folder (for example pre-remap worktree paths or path spelling variants), then deletes those orphan folders.

Override for tests / local runs:

| Env | Purpose |
|-----|---------|
| `HARNESS_BOARD_DATA_ROOT` | Optional store root instead of `~/.cursor/harness-board` (used by `bin/mcp.js` and the board UI) |

MCP tool targeting does **not** use env or a global pointer. Every MCP tool requires an absolute `workspace` argument per call. (`HARNESS_BOARD_WORKSPACE` is ignored if set.)

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

## Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | Store + transition + boards + e2e + MCP smoke tests |
| `npm run board` | Local multi-board server (port 4173 by default, prints URL; no workspace env required) |
| `npm run mcp` | stdio MCP server (Cursor launches this via `mcp.json`) |
| `npm run migrate:identity` | One-shot CLI to merge split buckets onto remapped identity (see below) |

### Identity migration CLI (`npm run migrate:identity`)

Use this **once per machine** after upgrading to worktree/junction-aware identity, if you already have board data under duplicate hash folders (for example a linked worktree bucket separate from the main checkout).

**Not automatic.** Nothing runs migrate on Cursor startup or MCP connect. A human must review output on **live** data under `~/.cursor/harness-board` (or your custom root).

**Default is dry-run.** With no flags, the CLI only scans and prints a JSON report (`mode: "dry-run"`) — no writes.

```bash
# From the harness-board plugin directory (or use node bin/migrate-board-identity.js)
npm run migrate:identity
npm run migrate:identity -- --dry-run          # explicit dry-run
npm run migrate:identity -- --data-root "D:\path\to\harness-board-store"
```

Review the report: each merge lists `boardRoot`, target `masterHash`, `removeHashes`, and per-source initiative/slice counts.

**Apply only after a clean dry-run you accept:**

```bash
npm run migrate:identity -- --apply
npm run migrate:identity -- --apply --data-root "D:\path\to\harness-board-store"
```

`--apply` **always** copies the entire data root to a timestamped sibling folder (`…-backup-…-pre-identity-migrate`) before changing anything. If backup fails, migrate aborts with no writes.

**Risks:** `--apply` can delete orphan hash directories after merging. If the process stops mid-run (crash, kill, disk full), you can be left with a **partial apply** — some groups merged, others not. **Keep the backup** until you have verified boards in the UI and MCP; restore from the backup folder if anything looks wrong.

Flags:

| Flag | Purpose |
|------|---------|
| *(none)* or `--dry-run` | Report only (default when `--apply` omitted) |
| `--apply` | Backup, then merge groups and remove redundant buckets |
| `--data-root PATH` | Store root (default: `~/.cursor/harness-board`, same as `HARNESS_BOARD_DATA_ROOT`) |

## HTTP API

Server binds `127.0.0.1:4173` by default and logs `http://127.0.0.1:4173`. In-process callers can pass `options.port` to select another port, including `0` for an ephemeral port.

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
