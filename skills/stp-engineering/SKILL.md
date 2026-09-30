---
name: stp-engineering
description: Claim and implement one ready Swing Trade Pros engineering issue, validate it, and hand off a draft PR for review.
---

# STP Engineering

Use `1ststepai/swingtradepros#338` and the issue's current comments as authority.

1. Claim only an open issue carrying both `stp-queue` and `ready`; select the highest priority and avoid claimed scope overlap.
2. Replace `ready` with `claimed` and post a 45-minute lease before editing. Work in the issue's named branch or an isolated worktree from current `origin/main`.
3. Trace the real flow, reuse existing code, and make the smallest change satisfying the acceptance criteria.
4. Run the issue-required checks and one focused regression test for non-trivial logic.
5. Push only to a draft PR. Post a truthful RESULT with SHA, tests, risks, unavailable evidence, and the final lifecycle label; update `#338` status.

Never merge, deploy Production, change secrets, billing, auth, entitlements, frozen bots, send outbound messages, or make live trading calls. Use Node AI for visible assistant naming; retain internal compatibility aliases when required.
