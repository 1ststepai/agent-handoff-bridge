import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Bridge } from "./bridge.mjs";
import { buildMcpServer } from "./mcp.mjs";
import { TOKEN_ENV } from "./actors.mjs";

function loadTokens(env) {
  const entries = Object.entries(TOKEN_ENV).map(([actor, variable]) => [actor, env[variable], variable]);
  for (const [, token, variable] of entries) {
    if (!token || token.length < 32) throw new Error(`${variable} must be at least 32 characters`);
  }
  if (new Set(entries.map(([, token]) => token)).size !== entries.length) throw new Error("Bridge tokens must be distinct");
  return entries.map(([actor, token]) => [actor, token]);
}

function actorForHeader(header, tokens) {
  header ||= "";
  if (!header.startsWith("Bearer ")) return null;
  const candidate = Buffer.from(header.slice(7));
  for (const [actor, token] of tokens) {
    const expected = Buffer.from(token);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return actor;
  }
  return null;
}

const tokens = loadTokens(process.env);
const bridge = new Bridge(process.env.BRIDGE_DB_PATH);
const handler = createMcpHandler(({ requestInfo }) => {
  const actor = actorForHeader(requestInfo?.headers.get("authorization"), tokens);
  if (!actor) throw new Error("Unauthorized");
  return buildMcpServer(bridge, actor);
}, { legacy: "stateless", responseMode: "json", maxRequestBodySize: 1_000_000 });
const mcp = toNodeHandler(handler);
const host = process.env.BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.BRIDGE_PORT || 8787);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "agent-handoff-bridge" }));
    return;
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }
  const queryToken = url.searchParams.get("access_token");
  const actor = actorForHeader(req.headers.authorization, tokens)
    || actorForHeader(queryToken ? `Bearer ${queryToken}` : "", tokens);
  if (!actor) {
    res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  req.headers.authorization ||= `Bearer ${queryToken}`;
  const accept = req.headers.accept || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    req.headers.accept = "application/json, text/event-stream";
  }
  try {
    await mcp(req, res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    if (!res.writableEnded) res.end(JSON.stringify({ error: "Internal server error" }));
    console.error(error);
  }
});

server.listen(port, host, () => console.log(`Agent bridge listening at http://${host}:${port}/mcp`));

async function shutdown() {
  server.close();
  await handler.close();
  bridge.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
