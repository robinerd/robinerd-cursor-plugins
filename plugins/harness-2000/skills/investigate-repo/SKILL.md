---
name: investigate-repo
description: >-
  Intake/risk: inspect repo to classify tier and ground the plan. Use at start or /investigate.
---

# Investigate repo

1. Skim structure, existing plans, tests, critical configs (read-only).
2. Propose tier: trivial | feature | breaking | spike — with one-line why (confirm with **ask-user** if unsure).
3. List unknowns that block §1 or §4; ask those via **ask-user** when they are fixed-choice.
4. Do not implement. Do not switch to Plan mode. Suggest `/start-work` or `/define-feature` next.
