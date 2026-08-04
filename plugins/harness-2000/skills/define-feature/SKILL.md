---
name: define-feature
description: >-
  Fill plan §1 Intent only (customer need, framing, why now, success). Do not touch §4.
  Use when defining the feature/problem or user invokes /define-feature.
  Clarify unknowns with ask-user / AskQuestion. Stay in Agent mode.
---

# Define feature (§1 only)

Stay in **Agent mode**.

Edit **only** `## 1. Intent` in the active plan (and front matter Stage → `2-feature` when done).

- Complete: customer/internal need, framing, why now, success look like.
- Do **not** write system design, APIs, or file layouts here — that is `/design-system` (§4).
- Short bullets OK; empty subsections get explicit TBD, not silent omission.
- Use **ask-user** / `AskQuestion` for open product decisions (options + `Custom: …`) before locking §1.
- Human should confirm before treating §1 as locked (ask-user confirm is enough).
