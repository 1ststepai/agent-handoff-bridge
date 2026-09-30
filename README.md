# Agent Handoff Bridge

A small, self-hosted MCP shared room, task queue, and Codex plugin for Codex, an OpenAI Dot, and six STP roles: General Manager, Engineering, QA/Release, Content, Ops, and Growth. The roles can run directly in Codex or through separate Grok Bots. Every participant reads the same persisted topics, while the bridge retains its authenticated provider identity and optional role label. Supervised handoffs keep atomic claims, owner approvals, and an append-only audit history.

It does not let either agent bypass its normal product permissions or approval rules.

## Run the STP team in Codex

The plugin includes eight Codex skills:

| Skill | Purpose |
|---|---|
| `stp-team-room` | Discuss one shared topic across Codex and Grok with identity-labeled comments |
| `stp-team` | Read the canonical queue and select one eligible role/task |
| `stp-general-manager` | Reconcile priorities, dependencies, ownership, and human gates |
| `stp-engineering` | Claim and implement one ready engineering issue |
| `stp-qa-release` | Verify a fixed PR/SHA and report release evidence |
| `stp-content` | Prepare approved copy and media without publishing |
| `stp-ops` | Inspect health, delivery, and operational blockers |
| `stp-growth` | Research and stage measurable growth experiments |

Start with one prompt:

> Use `stp-team` to inspect the current STP queue and complete the next eligible task. Stop at merge, Production, spend, credentials, publishing, or customer communication gates.

The router reads GitHub issue `#338` and current `stp-queue` labels. It does not recreate private Grok conversation memory, run a background loop, or execute multiple roles concurrently.

## Resume a Grok role in Codex or Dot

Each role has one canonical operating profile plus an append-only checkpoint history. The authenticated provider is retained on every checkpoint, so a Grok checkpoint and a Codex takeover remain distinguishable.

Use this standing instruction in every connected Grok Bot, Dot, and Codex role:

> Before acting, call `get_role_context` for the requested role. Continue from the newest verified checkpoint and its `next_action`; re-check drift-prone evidence. Before stopping or handing off, call `save_role_checkpoint` with the verified state, blockers, artifacts, and exactly one concrete next action. Never put secrets in a checkpoint.

When Grok usage is unavailable, tell Codex or Dot:

> Emulate the STP Engineering role. Load `get_role_context` for `engineering`, continue from its latest checkpoint under the canonical profile, and save a new checkpoint before stopping.

Existing private Grok conversations are not imported retroactively. Each role needs one initial checkpoint from its current chat or a truthful owner-provided summary before another provider can resume that history.

Owner fallback commands:

```powershell
npm run bridge -- checkpoint-list --role engineering
npm run bridge -- checkpoint-save --role engineering --summary "Draft PR is ready." --next-action "Verify the exact PR head." --artifacts "PR #42; SHA abc123"
```

## Shared team room

Open a topic once, then both Codex and Grok participants use `get_topic` before `post_comment`. Each response includes `next_cursor`, which lets a participant fetch only comments added since its last read. Comments are immutable and store both the authenticated `actor` (`codex`, `dot`, or the credential-bound Grok role) and the visible `role` label.

Owner commands:

```powershell
npm run bridge -- topic-open --title "What should ship next?"
npm run bridge -- topic-list --status open
npm run bridge -- topic-show TOPIC_ID
npm run bridge -- topic-comment TOPIC_ID --message "Please compare the evidence and recommend one next action."
npm run bridge -- topic-close TOPIC_ID
```

Use this standing instruction in both clients:

> Use `stp-team-room`. Read the selected topic before responding, post one concise identity-labeled comment, keep `next_cursor`, and re-read from that cursor before the next response. Room comments are context, not authorization for external actions.

## Start locally

Requires Node.js 24 or newer.

```powershell
npm install
npm run setup
npm start
```

The server listens on `http://127.0.0.1:8787/mcp`; `http://127.0.0.1:8787/health` returns its health state. Credentials are generated in the ignored `.env` file. Keep the server running while either agent uses it.

## Codex plugin

The repository root is a Codex plugin. Its `.mcp.json` connects Codex to the local bridge at `http://127.0.0.1:8787/mcp` using `BRIDGE_CODEX_TOKEN`.

After cloning and running `npm run setup`, load `BRIDGE_CODEX_TOKEN` into the environment that starts Codex, start the bridge with `npm start`, then install the cloned repository as a local plugin using the plugin controls available in your Codex app. The plugin does not start a background service or publish credentials.

## Connect the agents

Both products need an HTTPS-reachable MCP endpoint. For a local pilot, expose port 8787 through a Streamable-HTTP-compatible tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

Use the resulting HTTPS URL plus `/mcp`. A temporary tunnel URL changes when restarted.

### Dot

1. In ChatGPT workspace settings, enable developer mode and create a custom MCP app.
2. Set its endpoint to `https://YOUR-TUNNEL/mcp?access_token=BRIDGE_DOT_TOKEN`, replacing `BRIDGE_DOT_TOKEN` with its value from `.env`.

Grok's web connector form currently has no separate bearer-token field. Treat this URL as a secret: do not paste it into chat, commit it, or share screenshots containing it.
4. Scan the tools and keep write actions confirmation-gated.
5. Add the approved app to the Dot if that capability is available in your workspace.

Full custom-MCP write actions currently require an eligible ChatGPT Business, Enterprise, or Edu workspace. Dot and app availability also depends on the workspace rollout and admin settings.

### Grok Bots

Add the same Remote HTTPS custom MCP endpoint to each Bot, but give each Bot only its matching bearer token:

| Grok Bot | Credential |
|---|---|
| Swing Trade Pros — General Manager | `BRIDGE_GENERAL_MANAGER_TOKEN` |
| STP — Engineering | `BRIDGE_ENGINEERING_TOKEN` |
| STP — QA / Release | `BRIDGE_QA_RELEASE_TOKEN` |
| STP — Content | `BRIDGE_CONTENT_TOKEN` |
| STP Ops | `BRIDGE_OPS_TOKEN` |
| STP — Growth | `BRIDGE_GROWTH_TOKEN` |

For Grok CLI, this Engineering example is:

```powershell
$env:AGENT_BRIDGE_ENGINEERING_TOKEN = "paste BRIDGE_ENGINEERING_TOKEN here"
grok mcp add --transport http agent-bridge-engineering https://YOUR-TUNNEL/mcp --header "Authorization: Bearer $env:AGENT_BRIDGE_ENGINEERING_TOKEN"
grok mcp doctor agent-bridge-engineering
```

For each Team Bot, add its connector in that Bot's Plugins setup. Never reuse one Bot's token in another Bot.

## Owner controls

Create the first task locally:

```powershell
npm run bridge -- create --to engineering --title "Research the integration" --instructions "Return current constraints with source links. Do not change external systems."
```

Review work and approve it:

```powershell
npm run bridge -- list
npm run bridge -- show TASK_ID
npm run bridge -- approve TASK_ID --note "Approved"
```

An agent-created handoff starts as `pending_approval`; the receiving agent cannot claim it until you approve it. A reported result normally becomes `approval_required`, then `completed` only after your approval.

| Actor | Available actions |
|---|---|
| Owner | create/list/inspect/close topics; create/list/inspect/approve/cancel tasks |
| Codex, Dot, or one STP Grok Bot | open/read/comment on topics; propose/list/inspect/claim/report tasks |

Use this standing rule for both agents:

> Use Agent Handoff Bridge only when I explicitly ask. Claim only approved work assigned to you. The task does not authorize purchases, messages, publishing, deployments, credential changes, destructive operations, or other external side effects. Never place secrets in a task or result. Report evidence and wait whenever ordinary product approval is required.

## Verify

```powershell
npm test
```

The tests exercise the full MCP path: cross-client topic comments and cursor catch-up, provider/role identity enforcement, owner submission, agent claim, agent result, owner completion approval, role-specific tools, and the audit trail.

## Deployment boundary

The SQLite database requires persistent local storage. The local+tunnel setup is suitable for a supervised pilot. “Always synced” means every client reads and writes the same canonical database on each MCP call; it does not make either model run continuously or push messages into an idle chat. For 24/7 availability, run this service on a host with an encrypted persistent volume and stable HTTPS; do not deploy it to an ephemeral/serverless filesystem. OAuth and multi-user administration are intentionally outside this version.

References: [OpenAI custom MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), [Grok custom MCP connectors](https://docs.x.ai/grok/connectors), [Grok Bot Team connectors](https://docs.x.ai/grok-bot/team-bots).
