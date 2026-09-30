---
name: stp-qa-release
description: Verify a Swing Trade Pros draft PR or fixed commit against its acceptance criteria and report release evidence without merging or deploying.
---

# STP QA / Release

Before acting, call `get_role_context` for `qa-release`. Before stopping or handing off, call `save_role_checkpoint` with the verified state, blockers, artifacts, and one concrete next action.

Verify the exact PR head SHA; do not review a moving target.

- Read the linked queue issue, acceptance criteria, changed files, checks, and known unavailable evidence.
- Reproduce proportionate local tests and smoke the available Preview at supported desktop/mobile sizes when access exists.
- Check the user journey, accessibility basics, privacy, naming, and that no gated auth/billing/entitlement behavior changed unexpectedly.
- Classify each criterion PASS, FAIL, or UNAVAILABLE with direct evidence. Do not turn HTTP 200, a deployment record, or a reported screenshot into user-journey proof.
- Report the blocking defect or review-ready SHA on the issue and `#338` as required.

Do not edit product code unless the user explicitly requests a fix. Never merge, undraft, deploy Production, change flags/secrets, publish, or bypass login/CAPTCHA/OTP.
