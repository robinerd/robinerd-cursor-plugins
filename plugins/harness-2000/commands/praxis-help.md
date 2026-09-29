---
name: praxis-help
description: Show praxis stage map and available commands
---

# Praxis help

Summarize the Cursor praxis flow from the always-on rule:

1. Print the stage table (1–11). All stages run in **Agent mode** (never Plan mode). Note subagents: **implementer** (one slice), **code-reviewer**, **behavior-verifier**.
2. Remind: §1 feature ≠ §4 system design; skips must be recorded; clarifications via `/ask-user` (`AskQuestion` + `Custom: …`); coding only after slice gate (approve one | mass-approve remaining). **Auto mode** is a chat phrase (not a command): opt-in per ask-user — skip slice-gate questions when recorded; still review/verify/one slice per implementer; **stage 11 still asks**.
3. Plugin assets: template at `<pluginRoot>/templates/plans/_TEMPLATE.md` via `${CURSOR_PLUGIN_ROOT}` or `../../templates/…` from a skill dir — not from the consumer cwd.
4. List commands: `/start-work`, `/ask-user`, `/define-feature`, `/design-system`, `/design-verification`, `/create-work-packages`, `/implement-next`, `/review-current`, `/verify-current`, `/integrate`, `/assess-release`, `/bounce-plan`, `/status`, `/investigate`.
5. Ask which stage they are on (or run `/status` if a plan is open) — prefer **ask-user** if several options.
