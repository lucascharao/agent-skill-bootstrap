import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Agent, Scope } from "./types.js";

const PROJECT_SKILL_PATHS: Record<Agent, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
  grok: ".grok/skills",
};

const GLOBAL_SKILL_PATHS: Record<Agent, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
  grok: ".grok/skills",
};

export function skillRoot(
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  return resolve(
    scope === "global" ? home : projectRoot,
    scope === "global" ? GLOBAL_SKILL_PATHS[agent] : PROJECT_SKILL_PATHS[agent],
  );
}

export function runtimeRoot(
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  return scope === "global"
    ? join(home, ".config", "agent-skill-bootstrap", "runtime")
    : join(projectRoot, ".agent-skill-bootstrap", "runtime");
}

export function statePath(scope: Scope, projectRoot: string, home = homedir()): string {
  return scope === "global"
    ? join(home, ".config", "agent-skill-bootstrap", "state.json")
    : join(projectRoot, ".agent-skill-bootstrap", "state.json");
}
