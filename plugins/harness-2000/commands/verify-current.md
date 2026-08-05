---
name: verify-current
description: Run behavior-verifier against plan §5
---

# Verify current

Stay in Agent mode. Invoke **behavior-verifier** subagent with plan §5/§8, how to run checks, and the **board slice id** (when harness-board is available).

Ensure the verifier calls `verifier_verdict` (`pass` | `fail` | `bounce` | `replan`) before return when board MCP is available; soft-fail with `board MCP unavailable` otherwise. Orchestrator: do not call reviewer/verifier tools yourself. Update §8 Verification record with results. If §6 marked a human check for this slice, pause with **ask-user** before continuing. Then suggest next slice via `/implement-next`, `/assess-release`, or fix/bounce.
