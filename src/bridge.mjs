import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_SET, ASSIGNEES, TEAM_ROLES, TEAM_ROLE_SET } from "./actors.mjs";

const STATUSES = new Set([
  "pending_approval",
  "queued",
  "claimed",
  "approval_required",
  "completed",
  "cancelled",
]);

function assertText(value, name, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  if (value.length > max) throw new Error(`${name} must be ${max} characters or fewer`);
  return value.trim();
}
function now() {
  return new Date().toISOString();
}

function toTask(row) {
  return row ? { ...row, requires_completion_approval: Boolean(row.requires_completion_approval) } : null;
}

export class Bridge {
  constructor(dbPath = "./data/bridge.sqlite") {
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        instructions TEXT NOT NULL,
        created_by TEXT NOT NULL,
        assigned_to TEXT NOT NULL,
        claimed_by TEXT,
        claimed_role TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending_approval', 'queued', 'claimed', 'approval_required', 'completed', 'cancelled')),
        requires_completion_approval INTEGER NOT NULL CHECK (requires_completion_approval IN (0, 1)),
        result TEXT,
        approval_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, assigned_to, updated_at);
      CREATE INDEX IF NOT EXISTS events_task_idx ON events(task_id, id);
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT NOT NULL REFERENCES topics(id),
        actor TEXT NOT NULL,
        role TEXT NOT NULL,
        body TEXT NOT NULL,
        reply_to INTEGER REFERENCES comments(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS topics_status_idx ON topics(status, updated_at);
      CREATE INDEX IF NOT EXISTS comments_topic_idx ON comments(topic_id, id);
      CREATE TABLE IF NOT EXISTS role_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        next_action TEXT NOT NULL,
        blockers TEXT,
        artifacts TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS role_checkpoints_role_idx ON role_checkpoints(role, id DESC);
    `);
    const taskColumns = this.db.prepare("PRAGMA table_info(tasks)").all();
    if (!taskColumns.some(({ name }) => name === "claimed_role")) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN claimed_role TEXT");
    }
  }

  close() {
    this.db.close();
  }

  health() {
    return { database: this.db.prepare("SELECT 1 AS ok").get().ok === 1 };
  }

  addEvent(taskId, actor, action, details = null) {
    this.db.prepare(
      "INSERT INTO events (task_id, actor, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(taskId, actor, action, details, now());
  }

  canSee(actor, task) {
    return actor === "owner"
      || task.created_by === actor
      || task.assigned_to === actor
      || task.assigned_to === "any"
      || (["codex", "dot"].includes(actor) && TEAM_ROLE_SET.has(task.assigned_to));
  }

  getTask(actor, id) {
    const task = toTask(this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
    if (!task || !this.canSee(actor, task)) throw new Error("Task not found");
    const events = this.db.prepare(
      "SELECT actor, action, details, created_at FROM events WHERE task_id = ? ORDER BY id",
    ).all(id);
    return { ...task, events };
  }

  listTasks(actor, status, limit = 50) {
    if (status && !STATUSES.has(status)) throw new Error("Invalid status");
    const capped = Math.max(1, Math.min(Number(limit) || 50, 100));
    const filters = [];
    const params = [];
    if (["codex", "dot"].includes(actor)) {
      filters.push(`(created_by = ? OR assigned_to = ? OR assigned_to = 'any' OR assigned_to IN (${TEAM_ROLES.map(() => "?").join(", ")}))`);
      params.push(actor, actor, ...TEAM_ROLES);
    } else if (actor !== "owner") {
      filters.push("(created_by = ? OR assigned_to = ? OR assigned_to = 'any')");
      params.push(actor, actor);
    }
    if (status) {
      filters.push("status = ?");
      params.push(status);
    }
    params.push(capped);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return this.db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ?`,
    ).all(...params).map(toTask);
  }

  submitTask(actor, input) {
    if (actor !== "owner" && !AGENT_SET.has(actor)) throw new Error("Unknown actor");
    if (!ASSIGNEES.has(input.assigned_to)) throw new Error("Unknown assignee");
    const id = randomUUID();
    const timestamp = now();
    const status = actor === "owner" ? "queued" : "pending_approval";
    const title = assertText(input.title, "title", 160);
    const instructions = assertText(input.instructions, "instructions", 8000);
    const requiresApproval = input.requires_completion_approval !== false ? 1 : 0;
    this.db.prepare(`
      INSERT INTO tasks (
        id, title, instructions, created_by, assigned_to, status,
        requires_completion_approval, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, instructions, actor, input.assigned_to, status, requiresApproval, timestamp, timestamp);
    this.addEvent(id, actor, "submitted", status === "pending_approval" ? "Owner approval required before claim" : null);
    return this.getTask(actor, id);
  }

  claimTask(actor, id, role = null) {
    if (!AGENT_SET.has(actor)) throw new Error("Only configured agents can claim a task");
    if (role && !["codex", "dot"].includes(actor)) throw new Error("Only Codex or Dot can act as another role");
    if (role && !TEAM_ROLE_SET.has(role)) throw new Error("Invalid team role");
    const claimedRole = role || actor;
    const timestamp = now();
    const result = this.db.prepare(`
      UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_role = ?, updated_at = ?
      WHERE id = ? AND status = 'queued' AND assigned_to IN (?, ?, 'any')
    `).run(actor, claimedRole, timestamp, id, actor, claimedRole);
    if (result.changes !== 1) throw new Error("Task is unavailable, unapproved, or assigned to another agent");
    this.addEvent(id, actor, "claimed", claimedRole === actor ? null : `role=${claimedRole}`);
    return this.getTask(actor, id);
  }

  reportResult(actor, id, resultText) {
    if (!AGENT_SET.has(actor)) throw new Error("Only configured agents can report a result");
    const result = assertText(resultText, "result", 16000);
    const timestamp = now();
    const updated = this.db.prepare(`
      UPDATE tasks
      SET result = ?, status = CASE WHEN requires_completion_approval = 1 THEN 'approval_required' ELSE 'completed' END,
          updated_at = ?
      WHERE id = ? AND status = 'claimed' AND claimed_by = ?
    `).run(result, timestamp, id, actor);
    if (updated.changes !== 1) throw new Error("Task is not claimed by this agent");
    this.addEvent(id, actor, "result_reported");
    return this.getTask(actor, id);
  }

  approveTask(id, note = null) {
    const task = toTask(this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
    if (!task) throw new Error("Task not found");
    const next = task.status === "pending_approval" ? "queued" : task.status === "approval_required" ? "completed" : null;
    if (!next) throw new Error("Task is not waiting for approval");
    const approvalNote = note == null || note === "" ? null : assertText(note, "note", 2000);
    this.db.prepare("UPDATE tasks SET status = ?, approval_note = ?, updated_at = ? WHERE id = ?")
      .run(next, approvalNote, now(), id);
    this.addEvent(id, "owner", next === "queued" ? "dispatch_approved" : "completion_approved", approvalNote);
    return this.getTask("owner", id);
  }

  cancelTask(id, note = null) {
    const cancellationNote = note == null || note === "" ? null : assertText(note, "note", 2000);
    const result = this.db.prepare(`
      UPDATE tasks SET status = 'cancelled', approval_note = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('completed', 'cancelled')
    `).run(cancellationNote, now(), id);
    if (result.changes !== 1) throw new Error("Task not found or already final");
    this.addEvent(id, "owner", "cancelled", cancellationNote);
    return this.getTask("owner", id);
  }

  openTopic(actor, title) {
    if (actor !== "owner" && !AGENT_SET.has(actor)) throw new Error("Unknown actor");
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO topics (id, title, created_by, status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?)
    `).run(id, assertText(title, "title", 160), actor, timestamp, timestamp);
    return this.getTopic(id);
  }

  listTopics(status, limit = 50) {
    if (status && !["open", "closed"].includes(status)) throw new Error("Invalid status");
    const capped = Math.max(1, Math.min(Number(limit) || 50, 100));
    return status
      ? this.db.prepare("SELECT * FROM topics WHERE status = ? ORDER BY updated_at DESC LIMIT ?").all(status, capped)
      : this.db.prepare("SELECT * FROM topics ORDER BY updated_at DESC LIMIT ?").all(capped);
  }

  getTopic(id, afterCommentId = 0, limit = 100) {
    const topic = this.db.prepare("SELECT * FROM topics WHERE id = ?").get(id);
    if (!topic) throw new Error("Topic not found");
    const after = Math.max(0, Number(afterCommentId) || 0);
    const capped = Math.max(1, Math.min(Number(limit) || 100, 200));
    const comments = this.db.prepare(`
      SELECT id, actor, role, body, reply_to, created_at
      FROM comments WHERE topic_id = ? AND id > ? ORDER BY id LIMIT ?
    `).all(id, after, capped);
    return { ...topic, comments, next_cursor: comments.at(-1)?.id ?? after };
  }

  postComment(actor, topicId, body, role, replyTo = null) {
    if (actor !== "owner" && !AGENT_SET.has(actor)) throw new Error("Unknown actor");
    const topic = this.db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId);
    if (!topic) throw new Error("Topic not found");
    if (topic.status !== "open") throw new Error("Topic is closed");

    const resolvedRole = role || actor;
    if (["codex", "dot"].includes(actor)) {
      if (role && !TEAM_ROLE_SET.has(role)) throw new Error("Invalid team role");
    } else if (resolvedRole !== actor) {
      throw new Error("This actor cannot post as another role");
    }

    let reply = null;
    if (replyTo != null) {
      reply = Number(replyTo);
      if (!Number.isInteger(reply) || reply < 1) throw new Error("reply_to must be a positive integer");
      const parent = this.db.prepare("SELECT topic_id FROM comments WHERE id = ?").get(reply);
      if (!parent || parent.topic_id !== topicId) throw new Error("Reply target is not in this topic");
    }

    const timestamp = now();
    const result = this.db.prepare(`
      INSERT INTO comments (topic_id, actor, role, body, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(topicId, actor, resolvedRole, assertText(body, "body", 8000), reply, timestamp);
    this.db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(timestamp, topicId);
    return this.db.prepare(`
      SELECT id, actor, role, body, reply_to, created_at FROM comments WHERE id = ?
    `).get(result.lastInsertRowid);
  }

  closeTopic(id) {
    const result = this.db.prepare("UPDATE topics SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'")
      .run(now(), id);
    if (result.changes !== 1) throw new Error("Topic not found or already closed");
    return this.getTopic(id);
  }

  getRoleCheckpoints(role, limit = 5) {
    if (!TEAM_ROLE_SET.has(role)) throw new Error("Invalid team role");
    const capped = Math.max(1, Math.min(Number(limit) || 5, 20));
    return this.db.prepare(`
      SELECT id, role, actor, summary, next_action, blockers, artifacts, created_at
      FROM role_checkpoints WHERE role = ? ORDER BY id DESC LIMIT ?
    `).all(role, capped);
  }

  saveRoleCheckpoint(actor, input) {
    const role = input.role || actor;
    if (!TEAM_ROLE_SET.has(role)) throw new Error("Invalid team role");
    if (TEAM_ROLE_SET.has(actor) && role !== actor) throw new Error("This actor cannot checkpoint another role");
    if (actor !== "owner" && !AGENT_SET.has(actor)) throw new Error("Unknown actor");
    const result = this.db.prepare(`
      INSERT INTO role_checkpoints (role, actor, summary, next_action, blockers, artifacts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      role,
      actor,
      assertText(input.summary, "summary", 8000),
      assertText(input.next_action, "next_action", 2000),
      input.blockers ? assertText(input.blockers, "blockers", 4000) : null,
      input.artifacts ? assertText(input.artifacts, "artifacts", 8000) : null,
      now(),
    );
    return this.db.prepare(`
      SELECT id, role, actor, summary, next_action, blockers, artifacts, created_at
      FROM role_checkpoints WHERE id = ?
    `).get(result.lastInsertRowid);
  }
}
