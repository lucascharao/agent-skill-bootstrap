import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BootstrapConfig } from "./config.js";
import { safeAtomicWrite } from "./fs-safety.js";
import { codexHome } from "./paths.js";
import type { RuntimeInstall } from "./runtime.js";
import type { Agent, Scope } from "./types.js";

export const MARKER_PREFIX = "agent-skill-bootstrap:v1";

export function ownershipMarker(scope: Scope, agent: Agent): string {
  return `${MARKER_PREFIX}:${scope}:${agent}`;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function hookCommand(
  runtime: RuntimeInstall,
  agent: Agent,
  scope: Scope,
  projectRoot: string,
): string {
  const root = scope === "project" ? ` --root ${quote(projectRoot)}` : "";
  return `${quote(runtime.node)} ${quote(runtime.cli)} hook --agent ${agent} --scope ${scope}${root} --owner ${quote(ownershipMarker(scope, agent))}`;
}

function safeJsonUpdate(
  path: string,
  boundary: string,
  mutate: (value: Record<string, unknown>) => boolean,
): boolean {
  const original = existsSync(path) ? readFileSync(path, "utf8") : null;
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(original ?? "{}\n");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    value = parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Hook configuration is not valid JSON: ${path}`);
  }
  if (!mutate(value)) return false;
  const backup = `${path}.agent-skill-bootstrap.bak`;
  if (original !== null) {
    safeAtomicWrite(backup, original, boundary);
  }
  safeAtomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, boundary, {
    expected: original,
  });
  return true;
}

function hookEntry(
  runtime: RuntimeInstall,
  agent: Agent,
  scope: Scope,
  config: BootstrapConfig,
  projectRoot: string,
): Record<string, unknown> {
  return {
    matcher: "startup|resume|clear|compact",
    hooks: [
      {
        type: "command",
        command: hookCommand(runtime, agent, scope, projectRoot),
        timeout: config.runtime.hook_timeout_seconds,
        statusMessage: "Checking project skills",
      },
    ],
  };
}

function addOwnedHook(
  value: Record<string, unknown>,
  marker: string,
  entry: Record<string, unknown>,
): boolean {
  const hooks =
    value.hooks === undefined
      ? {}
      : value.hooks !== null &&
          typeof value.hooks === "object" &&
          !Array.isArray(value.hooks)
        ? (value.hooks as Record<string, unknown>)
        : (() => {
            throw new Error("Hook configuration has invalid hooks");
          })();
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) {
    throw new Error("Hook configuration has invalid SessionStart entries");
  }
  const current = (hooks.SessionStart ?? []) as unknown[];
  const filtered = current.filter((item) => !isOwnedEntry(item, marker));
  hooks.SessionStart = [...filtered, entry];
  value.hooks = hooks;
  return JSON.stringify(current) !== JSON.stringify(hooks.SessionStart);
}

function isOwnedEntry(value: unknown, marker: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const hooks = (value as Record<string, unknown>).hooks;
  if (!Array.isArray(hooks)) return false;
  const suffix = ` --owner ${quote(marker)}`;
  return hooks.some(
    (handler) =>
      handler !== null &&
      typeof handler === "object" &&
      !Array.isArray(handler) &&
      (handler as Record<string, unknown>).type === "command" &&
      typeof (handler as Record<string, unknown>).command === "string" &&
      ((handler as Record<string, unknown>).command as string).endsWith(suffix),
  );
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
      return scope === "global"
        ? join(codexHome(home), "hooks.json")
        : join(base, ".codex", "hooks.json");
  }
}

function hookBoundary(
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home = homedir(),
): string {
  if (scope === "project") return projectRoot;
  return agent === "codex" ? codexHome(home) : home;
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
    const marker = ownershipMarker(scope, agent);
    const updated = safeJsonUpdate(
      path,
      hookBoundary(agent, scope, projectRoot, home),
      (value) =>
        addOwnedHook(
          value,
          marker,
          hookEntry(runtime, agent, scope, config, projectRoot),
        ),
    );
    if (updated) changed.push(path);
  }
  return changed;
}

export function removeOwnedHook(
  path: string,
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home?: string,
): boolean {
  if (!existsSync(path)) return false;
  const marker = ownershipMarker(scope, agent);
  return safeJsonUpdate(
    path,
    hookBoundary(agent, scope, projectRoot, home),
    (value) => {
      const hooks = value.hooks as Record<string, unknown> | undefined;
      if (!hooks) return false;
      let changed = false;
      for (const event of ["SessionStart", "UserPromptSubmit"]) {
        const entries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
        const filtered = entries.filter((item) => !isOwnedEntry(item, marker));
        if (filtered.length !== entries.length) {
          hooks[event] = filtered;
          changed = true;
        }
      }
      return changed;
    },
  );
}
