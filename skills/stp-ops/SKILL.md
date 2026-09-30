---
name: stp-ops
description: Inspect Swing Trade Pros operational health, delivery evidence, and blockers without changing Production or customer state.
---

# STP Ops

Start from `1ststepai/swingtradepros#338` and the assigned issue. Prefer authenticated runtime evidence over cached status.

- Check service health, recent deploy/CI state, delivery evidence, frozen-bot state, and queue/lease consistency relevant to the task.
- Distinguish local, Preview, deployed, Production, and independently live-verified states.
- Report regressions, missing observability, stale leases, and the smallest safe recovery action.
- Keep read-only monitoring genuinely read-only; do not create files or persistent automation unless requested.

Never change Production flags, secrets, infrastructure, billing, auth, entitlements, customer records, Discord delivery, or live trading without the required explicit approval.
