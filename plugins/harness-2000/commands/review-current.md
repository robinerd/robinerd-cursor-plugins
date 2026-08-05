---
name: review-current
description: Fresh readonly code-reviewer on current diff vs plan
---

# Review current

Stay in Agent mode. Invoke **code-reviewer** in a **fresh** subagent context with: plan §§1,4,5,6, current diff, implementer evidence, and the **board slice id** (when harness-board is available). Do not reuse the implementer transcript as the reviewer.

Ensure the reviewer calls `reviewer_verdict` (`approve` | `revise` | `bounce`) before return when board MCP is available; soft-fail with `board MCP unavailable` otherwise. Orchestrator: do not call reviewer/verifier tools yourself. Then suggest `/verify-current` or fixes (ask-user if revise vs bounce is unclear).
