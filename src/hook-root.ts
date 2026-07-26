import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isWithinBoundary } from "./fs-safety.js";
import type { Agent, Scope } from "./types.js";

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];

export interface HookEventInput {
  hook_event_name?: unknown;
  cwd?: unknown;
}

function canonicalDirectory(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  const resolved = resolve(value);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${label} does not identify an existing directory`);
  }
  return realpathSync(resolved);
}

export function findProjectRoot(cwd: string): string {
  let current = canonicalDirectory(cwd, "Hook cwd");
  while (true) {
    if (PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Hook cwd is not inside a recognizable project");
    }
    current = parent;
  }
}

export function resolveHookProjectRoot(
  agent: Agent,
  scope: Scope,
  configuredRoot: string,
  input: HookEventInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const eventCwd =
    agent === "claude-code" && env.CLAUDE_PROJECT_DIR
      ? env.CLAUDE_PROJECT_DIR
      : input.cwd;
  if (typeof eventCwd !== "string" || eventCwd.length === 0) {
    throw new Error("SessionStart did not provide a trusted project cwd");
  }
  const canonicalCwd = canonicalDirectory(eventCwd, "Hook cwd");

  if (scope === "global") return findProjectRoot(canonicalCwd);

  const boundary = canonicalDirectory(configuredRoot, "Configured project root");
  if (!isWithinBoundary(canonicalCwd, boundary)) {
    throw new Error("Hook cwd is outside the configured project boundary");
  }
  return boundary;
}
