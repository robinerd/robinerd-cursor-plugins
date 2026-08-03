# Harness 2000 (Cursor plugin)

Cursor-native full lifecycle in **Agent mode**: judgment (§§1–6) then implement, fresh **code-reviewer** / **behavior-verifier**, slash commands for stage transitions, soft protect hooks. Does **not** switch to Plan mode.

## Install

### Add this marketplace repo as a local plugin

Point Cursor at **the repository root** (`robinerd-cursor-plugins` — the folder that contains `.cursor-plugin/marketplace.json`). Enable **Harness 2000** and reload if needed.

### Copy into `~/.cursor/plugins/local` (optional)

Copy the `plugins/harness-2000` directory into:

`%USERPROFILE%\.cursor\plugins\local\harness-2000`

Do **not** junction/symlink from outside `plugins/local` — Cursor rejects external link targets and reports a missing manifest.

## Flow

```text
Agent (same chat): intake → feature (§1) → priority → design (§4) → verify-design (§5) → breakdown (§6)
                 → implement → (subagent) review → (subagent) verify vs §5 → integrate → gate
```

§1 and §4 stay distinct. Skips are recorded on the plan front matter. Stay in Agent mode throughout.

Example prompt shape:

> Implement the below request, following the harness-2000 / praxis steps carefully. Do not switch to plan mode though, do the same steps inside the current chat agent mode.
>
> \<your request\>

## Commands

`/praxis-help` `/start-work` `/define-feature` `/design-system` `/design-verification` `/create-work-packages` `/implement-next` `/review-current` `/verify-current` `/integrate` `/assess-release` `/bounce-plan` `/status` `/investigate`

## Layout

```text
.cursor-plugin/plugin.json   # required manifest
rules/praxis-core.mdc
agents/{implementer,code-reviewer,behavior-verifier}.md
skills/…
commands/…
hooks/ + scripts/protect-config.mjs
templates/plans/_TEMPLATE.md
```

Plugin hooks resolve the protect script via `${CURSOR_PLUGIN_ROOT}/scripts/protect-config.mjs` (required because plugin hook cwd is the project root).

## Consumer repo policy

In projects that use this plugin, optional `.cursor/protect-paths.json` can extend denies. Defaults deny `.cursor/` and `secrets/`.
