export const AGENTS = [
  "codex",
  "dot",
  "general-manager",
  "engineering",
  "qa-release",
  "content",
  "ops",
  "growth",
];

export const AGENT_SET = new Set(AGENTS);
export const ASSIGNEES = new Set([...AGENTS, "any"]);
export const TEAM_ROLES = ["general-manager", "engineering", "qa-release", "content", "ops", "growth"];
export const TEAM_ROLE_SET = new Set(TEAM_ROLES);

export const TOKEN_ENV = {
  owner: "BRIDGE_OWNER_TOKEN",
  codex: "BRIDGE_CODEX_TOKEN",
  dot: "BRIDGE_DOT_TOKEN",
  "general-manager": "BRIDGE_GENERAL_MANAGER_TOKEN",
  engineering: "BRIDGE_ENGINEERING_TOKEN",
  "qa-release": "BRIDGE_QA_RELEASE_TOKEN",
  content: "BRIDGE_CONTENT_TOKEN",
  ops: "BRIDGE_OPS_TOKEN",
  growth: "BRIDGE_GROWTH_TOKEN",
};
