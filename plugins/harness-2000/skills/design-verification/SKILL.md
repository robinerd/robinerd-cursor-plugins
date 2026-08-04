---
name: design-verification
description: >-
  Fill plan §5 Verification design — acceptance and checks before implementation.
  Use before work packages or when user invokes /design-verification.
  Clarify check depth with ask-user. Stay in Agent mode.
---

# Design verification (§5 only)

Stay in **Agent mode**.

Edit **only** `## 5. Verification design` (Stage → `5-verify-design`).

- End-to-end acceptance, integration/regression checks, CI/delivery if relevant, out of scope for v1.
- Prefer concrete commands or observables `/behavior-verifier` can run later.
- If check depth or “out of scope” is ambiguous, use **ask-user** / `AskQuestion` (+ `Custom: …`).
- Do not implement features in this step.
