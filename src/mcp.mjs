import { McpServer } from "@modelcontextprotocol/server";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AGENTS, AGENT_SET, BRIDGE_VERSION, TEAM_ROLES } from "./actors.mjs";

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const run = (operation) => {
  try {
    return text(operation());
  } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
};
const roleProfile = (role) => readFileSync(new URL(`../skills/stp-${role}/SKILL.md`, import.meta.url), "utf8")
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
  .trim();

export function buildMcpServer(bridge, actor) {
  const server = new McpServer(
    { name: "agent-handoff-bridge", version: BRIDGE_VERSION },
    { instructions: `You are connected as ${actor}. Before continuing an STP role, call get_role_context. Before ending meaningful work, call save_role_checkpoint with the next concrete action. For shared discussions, read the topic before posting and keep the returned cursor. Actor identity is authenticated; role is a label, not a different model. Never put secrets in tasks, comments, or checkpoints.` },
  );

  server.registerTool("get_role_context", {
    description: "Load a role's canonical operating profile and recent resumable checkpoints before acting as or emulating that role.",
    inputSchema: z.object({
      role: z.enum(TEAM_ROLES),
      checkpoint_limit: z.number().int().min(1).max(20).default(5),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ role, checkpoint_limit }) => run(() => ({
    role,
    profile: roleProfile(role),
    checkpoints: bridge.getRoleCheckpoints(role, checkpoint_limit),
  })));

  server.registerTool("save_role_checkpoint", {
    description: "Append a resumable role checkpoint before handing work to another provider or ending meaningful work.",
    inputSchema: z.object({
      role: z.enum(TEAM_ROLES).optional(),
      summary: z.string().min(1).max(8000),
      next_action: z.string().min(1).max(2000),
      blockers: z.string().min(1).max(4000).optional(),
      artifacts: z.string().min(1).max(8000).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, (input) => run(() => bridge.saveRoleCheckpoint(actor, input)));

  server.registerTool("list_topics", {
    description: "List shared discussion topics visible to every authenticated bridge actor, newest first.",
    inputSchema: z.object({
      status: z.enum(["open", "closed"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ status, limit }) => run(() => bridge.listTopics(status, limit)));

  server.registerTool("get_topic", {
    description: "Read a shared topic and comments after an optional cursor. Call before commenting so you respond to current context.",
    inputSchema: z.object({
      topic_id: z.string().uuid(),
      after_comment_id: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ topic_id, after_comment_id, limit }) => run(() => bridge.getTopic(topic_id, after_comment_id, limit)));

  server.registerTool("open_topic", {
    description: "Open a shared discussion topic for Grok and Codex participants. This does not authorize external actions.",
    inputSchema: z.object({ title: z.string().min(1).max(160) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ title }) => run(() => bridge.openTopic(actor, title)));

  server.registerTool("post_comment", {
    description: "Append an immutable comment to an open topic. Codex or Dot may supply an STP role label; authenticated actor identity is always retained.",
    inputSchema: z.object({
      topic_id: z.string().uuid(),
      body: z.string().min(1).max(8000),
      role: z.enum(TEAM_ROLES).optional(),
      reply_to: z.number().int().positive().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, ({ topic_id, body, role, reply_to }) => run(() => bridge.postComment(actor, topic_id, body, role, reply_to)));

  server.registerTool("list_tasks", {
    description: "List tasks visible to this actor, newest first.",
    inputSchema: z.object({
      status: z.enum(["pending_approval", "queued", "claimed", "approval_required", "completed", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    annotations: { readOnlyHint: true },
  }, ({ status, limit }) => run(() => bridge.listTasks(actor, status, limit)));

  server.registerTool("get_task", {
    description: "Get one visible task and its audit history.",
    inputSchema: z.object({ task_id: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, ({ task_id }) => run(() => bridge.getTask(actor, task_id)));

  server.registerTool("submit_task", {
    description: actor === "owner"
      ? "Create an immediately claimable task."
      : "Propose a handoff. It remains blocked until the owner approves dispatch.",
    inputSchema: z.object({
      title: z.string().min(1).max(160),
      instructions: z.string().min(1).max(8000),
      assigned_to: z.enum([...AGENTS, "any"]),
      requires_completion_approval: z.boolean().default(true),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, (input) => run(() => bridge.submitTask(actor, input)));

  if (AGENT_SET.has(actor)) {
    server.registerTool("claim_task", {
      description: "Atomically claim an approved queued task. Codex or Dot may explicitly act as its assigned STP role while retaining authenticated provider identity.",
      inputSchema: z.object({
        task_id: z.string().uuid(),
        role: z.enum(TEAM_ROLES).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, ({ task_id, role }) => run(() => bridge.claimTask(actor, task_id, role)));

    server.registerTool("report_result", {
      description: "Report the result for a task claimed by this agent. Completion may wait for owner approval.",
      inputSchema: z.object({ task_id: z.string().uuid(), result: z.string().min(1).max(16000) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, ({ task_id, result }) => run(() => bridge.reportResult(actor, task_id, result)));
  }

  if (actor === "owner") {
    server.registerTool("approve_task", {
      description: "Approve an agent-proposed dispatch or approve a reported completion.",
      inputSchema: z.object({ task_id: z.string().uuid(), note: z.string().max(2000).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, ({ task_id, note }) => run(() => bridge.approveTask(task_id, note)));

    server.registerTool("cancel_task", {
      description: "Cancel a task that is not already final.",
      inputSchema: z.object({ task_id: z.string().uuid(), note: z.string().max(2000).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, ({ task_id, note }) => run(() => bridge.cancelTask(task_id, note)));

    server.registerTool("close_topic", {
      description: "Close a shared topic so no further comments can be added.",
      inputSchema: z.object({ topic_id: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, ({ topic_id }) => run(() => bridge.closeTopic(topic_id)));
  }

  return server;
}
