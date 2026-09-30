import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AGENTS } from "../src/actors.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const roles = ["general-manager", "engineering", "qa-release", "content", "ops", "growth"];

test("all STP execution roles are exposed as valid plugin skills", () => {
  assert.deepEqual(AGENTS.filter((actor) => !["codex", "dot"].includes(actor)), roles);
  for (const role of roles) {
    const source = readFileSync(join(root, "skills", `stp-${role}`, "SKILL.md"), "utf8");
    assert.match(source, new RegExp(`^---\\r?\\nname: stp-${role}\\r?\\n`, "m"));
    assert.match(source, /description: .+/);
    assert.match(source, /get_role_context/);
    assert.match(source, /save_role_checkpoint/);
  }
  const router = readFileSync(join(root, "skills", "stp-team", "SKILL.md"), "utf8");
  assert.match(router, /stp-queue/);
  assert.match(router, /one eligible task only/i);
  const room = readFileSync(join(root, "skills", "stp-team-room", "SKILL.md"), "utf8");
  assert.match(room, /^---\r?\nname: stp-team-room\r?\n/m);
  assert.match(room, /authenticated `actor`/);
});
