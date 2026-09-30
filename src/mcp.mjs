import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AGENTS, AGENT_SET, TEAM_ROLES } from "./actors.mjs";

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const run = (operation) => {
  try {
    return text(operation());
  } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  }
};

export function buildMcpServer(bridge, actor) {
  const server = new McpServer(
    { name: "agent-handoff-bridge", version: "0.3.1" },
    { instructions: `You are connected as ${actor}. For shared discussions, read the topic before posting and keep the returned cursor. Actor identity is authenticated; role is a label, not a different model. Never put secrets in tasks or comments.` },
  );

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
      description: "Atomically claim an approved queued task assigned to this agent or any agent.",
      inputSchema: z.object({ task_id: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, ({ task_id }) => run(() => bridge.claimTask(actor, task_id)));

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
