import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { Agent, Scope } from "./types.js";

const PROJECT_SKILL_PATHS: Record<Agent, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
};

export function codexHome(home = homedir(), value = process.env.CODEX_HOME): string {
  if (!value) return join(home, ".codex");
  if (!isAbsolute(value)) {
    throw new Error("CODEX_HOME must be an absolute path");
  }
  return resolve(value);
}

export function canonicalProjectRoot(projectRoot: string): string {
  const resolved = resolve(projectRoot);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

export function skillRoot(
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  if (scope === "project") {
    return resolve(projectRoot, PROJECT_SKILL_PATHS[agent]);
  }
  return agent === "codex"
    ? join(codexHome(home), "skills")
    : join(home, ".claude", "skills");
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
    ? join(
        home,
        ".config",
        "agent-skill-bootstrap",
        "projects",
        projectKey(projectRoot),
        "state.json",
      )
    : join(projectRoot, ".agent-skill-bootstrap", "state.json");
}

export function projectKey(projectRoot: string): string {
  return createHash("sha256")
    .update(canonicalProjectRoot(projectRoot))
    .digest("hex")
    .slice(0, 16);
}

export function briefingPath(
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  return scope === "global"
    ? join(
        home,
        ".config",
        "agent-skill-bootstrap",
        "projects",
        projectKey(projectRoot),
        "briefing.json",
      )
    : join(projectRoot, ".agent-skill-bootstrap", "briefing.json");
}

export function quarantineRoot(projectRoot: string): string {
  return join(projectRoot, ".agent-skill-bootstrap", "quarantine");
}
