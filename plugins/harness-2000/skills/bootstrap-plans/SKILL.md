---
name: bootstrap-plans
description: >-
  Ensure plans/_TEMPLATE.md exists in the consumer repo after installing this plugin.
  Resolves the bundled template from the plugin install root, not the project cwd.
---

# Bootstrap plans

## Bundled asset paths

Plugin files are **not** under the consumer project. Resolve them from the **plugin install root** (the directory that contains `.cursor-plugin/plugin.json` for `harness-2000`):

1. Prefer `${CURSOR_PLUGIN_ROOT}/templates/plans/_TEMPLATE.md` when that env var is set.
2. Else, from this skill’s directory (`…/skills/bootstrap-plans/`), read `../../templates/plans/_TEMPLATE.md` (skill → plugin root → `templates/…`). Use the absolute path of this `SKILL.md` to compute that root — never `plugins/harness-2000/…` from the workspace cwd.
3. Fallback search only if needed: `~/.cursor/plugins/local/harness-2000/` or under `~/.cursor/plugins/cache/**/harness-2000/**/`.

Workspace paths (`plans/…`) stay relative to the **consumer project root**.

## Steps

1. If workspace `plans/_TEMPLATE.md` is missing, create it by copying the bundled template (resolved as above).
2. Optionally remind them to add `.cursor/protect-paths.json` for extra denies.
3. Summarize created vs skipped. Only create other note folders if the user asks.
