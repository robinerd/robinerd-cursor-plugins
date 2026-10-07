# Harness 2000 (Cursor plugin)

Cursor-native full lifecycle in **Agent mode**: judgment (§§1–6) then gated implement, fresh **code-reviewer** / **behavior-verifier**, slash commands for stage transitions, soft protect hooks. Does **not** switch to Plan mode — clarifications use `/ask-user` (`AskQuestion` + `Custom: …`). Optional **auto mode** (say it in chat; not a slash command) mass-approves remaining slices and takes recommended/default reversible choices; policy lives in `skills/ask-user/SKILL.md`. Stage 11 still asks the human.

## Install

### Add this marketplace repo as a local plugin

Point Cursor at **the repository root** (`robinerd-cursor-plugins` — the folder that contains `.cursor-plugin/marketplace.json`). Enable **Harness 2000** and reload if needed.

Optionally enable sibling **Harness Board** from the same marketplace for runtime slice tracking (MCP tools + local UI). You can use **local stdio MCP** (plugin) or **remote MCP** via an HTTP `url` to an always-on host’s `npm run board` server (`/mcp`); see `plugins/harness-board/README.md`. When using remote, disable local plugin stdio so agents do not fall back to a laptop-only board. Praxis **soft-fails** if board MCP is unavailable (continues without hard-blocking). On every harness-board MCP tool call, always pass `workspace` (absolute path of the agent’s project root). To operate on another board, pass that workspace’s absolute path instead. Plans stay local (`plans/<id>.md`); the board host need not see them. From `plugins/harness-board`, run `npm run board` to open the view-only kanban UI (default port 4173).

### Copy into `~/.cursor/plugins/local` (optional)

Copy the `plugins/harness-2000` directory into:

`%USERPROFILE%\.cursor\plugins\local\harness-2000`

Do **not** junction/symlink from outside `plugins/local` — Cursor rejects external link targets and reports a missing manifest.

## Flow

```text
Agent (same chat): intake → feature (§1) → priority → design (§4) → verify-design (§5) → breakdown (§6)
                 → ask-user gate (slice | mass-approve | auto mode recorded)
                 → implementer (1 slice) → code-reviewer → behavior-verifier → (human if needed) → next slice…
                 → integrate → gate
```

§1 and §4 stay distinct. Skips are recorded on the plan front matter. Stay in Agent mode throughout. Subagents keep implement/review/verify context scoped so the main chat can orchestrate long feedback cycles.

Example prompt shape:

> Implement the below request, following the harness-2000 / praxis steps carefully. Stay in agent mode (do not switch to plan mode). Use interactive questions when you need decisions.
>
> \<your request\>

## Commands

`/praxis-help` `/start-work` `/ask-user` `/define-feature` `/design-system` `/design-verification` `/create-work-packages` `/implement-next` `/review-current` `/verify-current` `/integrate` `/assess-release` `/bounce-plan` `/status` `/investigate`

## Plugin paths (when installed)

Bundled assets resolve from the **plugin install root**, not the consumer project cwd:

| Asset | Path |
|-------|------|
| Plan template | `${CURSOR_PLUGIN_ROOT}/templates/plans/_TEMPLATE.md` or `../../templates/plans/_TEMPLATE.md` from any `skills/<name>/` |
| Protect script | `${CURSOR_PLUGIN_ROOT}/scripts/protect-config.mjs` (already wired in `hooks/hooks.json`) |

Consumer initiative docs stay at workspace `plans/<id>.md`.

## Layout

```text
.cursor-plugin/plugin.json   # required manifest
rules/praxis-core.mdc
agents/{implementer,code-reviewer,behavior-verifier}.md
skills/…                     # includes ask-user, bootstrap-plans, …
commands/…
hooks/ + scripts/protect-config.mjs
templates/plans/_TEMPLATE.md
```

## Consumer repo policy

In projects that use this plugin, optional `.cursor/protect-paths.json` can extend denies. Defaults deny `.cursor/` and `secrets/`.
