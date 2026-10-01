import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Bridge did not start");
}

async function connect(url, token, name) {
  const client = new Client({ name, version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

function parsed(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

test("owner and agent complete the real MCP journey", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-bridge-http-"));
  const port = await freePort();
  const tokens = {
    owner: "o".repeat(32),
    codex: "x".repeat(32),
    dot: "d".repeat(32),
    gm: "m".repeat(32),
    engineering: "e".repeat(32),
    qa: "q".repeat(32),
    content: "c".repeat(32),
    ops: "p".repeat(32),
    growth: "g".repeat(32),
  };
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      BRIDGE_HOST: "127.0.0.1",
      BRIDGE_PORT: String(port),
      BRIDGE_DB_PATH: join(directory, "bridge.sqlite"),
      BRIDGE_OWNER_TOKEN: tokens.owner,
      BRIDGE_CODEX_TOKEN: tokens.codex,
      BRIDGE_DOT_TOKEN: tokens.dot,
      BRIDGE_GENERAL_MANAGER_TOKEN: tokens.gm,
      BRIDGE_ENGINEERING_TOKEN: tokens.engineering,
      BRIDGE_QA_RELEASE_TOKEN: tokens.qa,
      BRIDGE_CONTENT_TOKEN: tokens.content,
      BRIDGE_OPS_TOKEN: tokens.ops,
      BRIDGE_GROWTH_TOKEN: tokens.growth,
    },
    stdio: "ignore",
  });
  const owner = await connect(`http://127.0.0.1:${port}/mcp`, tokens.owner, "owner-test").catch(async (error) => {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    return connect(`http://127.0.0.1:${port}/mcp`, tokens.owner, "owner-test-retry");
  });
  const codex = await connect(`http://127.0.0.1:${port}/mcp`, tokens.codex, "codex-test");
  const growth = await connect(`http://127.0.0.1:${port}/mcp`, tokens.growth, "growth-test");
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.database, true);
    assert.match(health.version, /^\d+\.\d+\.\d+$/);
    assert.ok(!Number.isNaN(Date.parse(health.checkedAt)));
    const ownerTools = (await owner.listTools()).tools.map(({ name }) => name);
    const codexTools = (await codex.listTools()).tools.map(({ name }) => name);
    assert(ownerTools.includes("approve_task"));
    assert(ownerTools.includes("close_topic"));
    assert(!codexTools.includes("approve_task"));
    assert(!codexTools.includes("close_topic"));
    assert(codexTools.includes("get_role_context"));
    assert(codexTools.includes("save_role_checkpoint"));

    parsed(await growth.callTool({ name: "save_role_checkpoint", arguments: {
      summary: "Experiment brief is staged.",
      next_action: "Engineering should confirm instrumentation.",
      artifacts: "Issue #42",
    } }));
    const growthContext = parsed(await codex.callTool({ name: "get_role_context", arguments: {
      role: "growth",
    } }));
    assert.match(growthContext.profile, /STP Growth/);
    assert.equal(growthContext.checkpoints[0].actor, "growth");
    assert.equal(growthContext.checkpoints[0].next_action, "Engineering should confirm instrumentation.");

    const topic = parsed(await owner.callTool({ name: "open_topic", arguments: { title: "Shared launch review" } }));
    const codexComment = parsed(await codex.callTool({ name: "post_comment", arguments: {
      topic_id: topic.id,
      role: "engineering",
      body: "The implementation is ready for QA.",
    } }));
    const shared = parsed(await growth.callTool({ name: "get_topic", arguments: { topic_id: topic.id } }));
    assert.equal(shared.comments[0].actor, "codex");
    assert.equal(shared.comments[0].role, "engineering");
    const growthComment = parsed(await growth.callTool({ name: "post_comment", arguments: {
      topic_id: topic.id,
      body: "I will wait for the QA evidence.",
      reply_to: codexComment.id,
    } }));
    const catchup = parsed(await codex.callTool({ name: "get_topic", arguments: {
      topic_id: topic.id,
      after_comment_id: codexComment.id,
    } }));
    assert.deepEqual(catchup.comments.map(({ id }) => id), [growthComment.id]);

    const task = parsed(await owner.callTool({ name: "submit_task", arguments: {
      title: "Test handoff",
      instructions: "Return a bounded result.",
      assigned_to: "codex",
      requires_completion_approval: true,
    } }));
    assert.deepEqual(parsed(await growth.callTool({ name: "list_tasks", arguments: {} })), []);
    assert.equal(parsed(await codex.callTool({ name: "claim_task", arguments: { task_id: task.id } })).status, "claimed");
    assert.equal(parsed(await codex.callTool({ name: "report_result", arguments: {
      task_id: task.id,
      result: "Bounded result",
    } })).status, "approval_required");
    assert.equal(parsed(await owner.callTool({ name: "approve_task", arguments: { task_id: task.id } })).status, "completed");

    const roleTask = parsed(await owner.callTool({ name: "submit_task", arguments: {
      title: "Role handoff",
      instructions: "Act as Engineering while retaining provider identity.",
      assigned_to: "engineering",
      requires_completion_approval: true,
    } }));
    const roleClaim = parsed(await codex.callTool({ name: "claim_task", arguments: {
      task_id: roleTask.id,
      role: "engineering",
    } }));
    assert.equal(roleClaim.claimed_by, "codex");
    assert.equal(roleClaim.claimed_role, "engineering");
  } finally {
    await owner.close();
    await codex.close();
    await growth.close();
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
