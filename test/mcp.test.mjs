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
    const ownerTools = (await owner.listTools()).tools.map(({ name }) => name);
    const codexTools = (await codex.listTools()).tools.map(({ name }) => name);
    assert(ownerTools.includes("approve_task"));
    assert(!codexTools.includes("approve_task"));

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
  } finally {
    await owner.close();
    await codex.close();
    await growth.close();
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
