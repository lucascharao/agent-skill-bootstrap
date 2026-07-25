import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { BootstrapConfig } from "./config.js";
import type { RuntimeInstall } from "./runtime.js";
import type { Agent, Scope } from "./types.js";

const MARKER = "agent-skill-bootstrap:owned";

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function hookCommand(runtime: RuntimeInstall, agent: Agent, scope: Scope): string {
  return `node ${quote(runtime.cli)} hook --agent ${agent} --scope ${scope} --owner ${MARKER}`;
}

function safeJsonWrite(
  path: string,
  mutate: (value: Record<string, unknown>) => void,
): void {
  let parent = dirname(path);
  while (dirname(parent) !== parent) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
      throw new Error(`Refusing symlinked hook configuration parent: ${parent}`);
    }
    parent = dirname(parent);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing to edit symlinked hook configuration: ${path}`);
  }
  const original = existsSync(path) ? readFileSync(path, "utf8") : "{}\n";
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(original) as Record<string, unknown>;
  } catch {
    throw new Error(`Hook configuration is not valid JSON: ${path}`);
  }
  const originalHash = createHash("sha256").update(original).digest("hex");
  mutate(value);
  const temporary = `${path}.${process.pid}.tmp`;
  const backup = `${path}.agent-skill-bootstrap.bak`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "{}\n";
  const currentHash = createHash("sha256").update(current).digest("hex");
  if (currentHash !== originalHash) {
    unlinkSync(temporary);
    throw new Error(`Hook configuration changed during update: ${path}`);
  }
  if (existsSync(path)) copyFileSync(path, backup);
  renameSync(temporary, path);
}

function sessionStartEntry(
  runtime: RuntimeInstall,
  agent: Agent,
  scope: Scope,
  config: BootstrapConfig,
): Record<string, unknown> {
  return {
    matcher: "startup|resume|clear|compact",
    hooks: [
      {
        type: "command",
        command: hookCommand(runtime, agent, scope),
        timeout: config.runtime.hook_timeout_seconds,
        statusMessage: "Checking project skills",
      },
    ],
  };
}

function addOwnedSessionStart(
  value: Record<string, unknown>,
  entry: Record<string, unknown>,
): void {
  const hooks =
    value.hooks && typeof value.hooks === "object"
      ? (value.hooks as Record<string, unknown>)
      : {};
  const current: unknown[] = Array.isArray(hooks.SessionStart)
    ? (hooks.SessionStart as unknown[])
    : [];
  hooks.SessionStart = [
    ...current.filter((item) => !JSON.stringify(item).includes(MARKER)),
    entry,
  ];
  value.hooks = hooks;
}

export function hookPath(
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  const base = scope === "global" ? home : projectRoot;
  switch (agent) {
    case "claude-code":
      return join(base, ".claude", "settings.json");
    case "codex":
      return join(base, ".codex", "hooks.json");
    case "grok":
      return join(base, ".grok", "hooks", "agent-skill-bootstrap.json");
  }
}

export function installHooks(
  agents: Agent[],
  scope: Scope,
  projectRoot: string,
  runtime: RuntimeInstall,
  config: BootstrapConfig,
  home?: string,
): string[] {
  const changed: string[] = [];
  for (const agent of agents) {
    const path = hookPath(agent, scope, projectRoot, home);
    safeJsonWrite(path, (value) => {
      addOwnedSessionStart(value, sessionStartEntry(runtime, agent, scope, config));
    });
    changed.push(relative(projectRoot, path));
  }
  return changed;
}
