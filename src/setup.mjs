import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOKEN_ENV } from "./actors.mjs";

const path = resolve(".env");
if (existsSync(path)) {
  console.error(".env already exists; left it unchanged.");
  process.exitCode = 1;
} else {
  const token = () => randomBytes(32).toString("base64url");
  writeFileSync(path, [
    ...Object.values(TOKEN_ENV).map((name) => `${name}=${token()}`),
    "BRIDGE_HOST=127.0.0.1",
    "BRIDGE_PORT=8787",
    "BRIDGE_DB_PATH=./data/bridge.sqlite",
    "",
  ].join("\n"), { flag: "wx", mode: 0o600 });
  console.log(`Created ${path} with ${Object.keys(TOKEN_ENV).length} distinct credentials.`);
}
