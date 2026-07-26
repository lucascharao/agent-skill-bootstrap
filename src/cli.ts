import * as p from "@clack/prompts";
import { existsSync, readSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { hookFailureOutput, hookSuccessOutput } from "./hook-output.js";
import {
  loadConfig,
  projectConfigPath,
  userConfigPath,
  withOverrides,
  type BootstrapConfig,
} from "./config.js";
import { detectProject } from "./detection.js";
import {
  assertNoSymlinkPath,
  assertWithinBoundary,
  safeAtomicWrite,
} from "./fs-safety.js";
import { resolveHookProjectRoot, type HookEventInput } from "./hook-root.js";
import { hookPath, installHooks, ownershipMarker, removeOwnedHook } from "./hooks.js";
import { inventory } from "./inventory.js";
import {
  analyzeManagedSkills,
  listQuarantined,
  quarantineManagedSkills,
  restoreQuarantined,
} from "./maintenance.js";
import { runtimeRoot } from "./paths.js";
import {
  assertSupportedNode,
  findSkillsBinary,
  installRuntime,
  nodeSupported,
  platformSupported,
  runtimeHealthy,
  VERSION,
} from "./runtime.js";
import { syncSkills } from "./sync.js";
import { AGENTS, type Agent, type Scope, type SyncResult } from "./types.js";

const HELP = `
Agent Skill Bootstrap ${VERSION}

Usage:
  npx agent-skill-bootstrap [init] [options]
  agent-skill-bootstrap scan [--json]
  agent-skill-bootstrap sync [--dry-run] [--force] [--json]
  agent-skill-bootstrap doctor [--json]
  agent-skill-bootstrap analyze [--json]
  agent-skill-bootstrap prune [--dry-run | --yes]
  agent-skill-bootstrap quarantine [--json]
  agent-skill-bootstrap restore <skill-id|slug> --yes
  agent-skill-bootstrap uninstall --yes

Options:
  --scope <project|global>       Installation scope
  --agents <list>               claude-code,codex
  --root <path>                 Project root (defaults to cwd)
  --non-interactive             Disable prompts
  --dry-run                     Plan without writing skills
  --json                        Machine-readable output
  --force                       Ignore the sync cache
  -h, --help                    Show help
  -v, --version                 Show version
`.trim();

interface CliOptions {
  scope?: Scope | undefined;
  agents?: Agent[] | undefined;
  root: string;
  nonInteractive: boolean;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  yes: boolean;
  owner?: string | undefined;
}

function parseAgentList(value: string | undefined): Agent[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").filter(Boolean);
  if (values.some((agent) => !AGENTS.includes(agent as Agent))) {
    throw new Error(`Invalid agent list: ${value}`);
  }
  return values as Agent[];
}

function parseCli(): {
  command: string;
  positionals: string[];
  options: CliOptions;
} {
  const ownArgs = process.argv.slice(2);
  const parsed = parseArgs({
    args: ownArgs,
    allowPositionals: true,
    strict: false,
    options: {
      scope: { type: "string" },
      agents: { type: "string" },
      root: { type: "string" },
      "non-interactive": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      agent: { type: "string" },
      owner: { type: "string" },
    },
  });
  if (parsed.values.help)
    return {
      command: "help",
      positionals: [],
      options: baseOptions(parsed.values),
    };
  if (parsed.values.version)
    return {
      command: "version",
      positionals: [],
      options: baseOptions(parsed.values),
    };
  const positionals = parsed.positionals;
  return {
    command: positionals[0] ?? "init",
    positionals: positionals.slice(1),
    options: baseOptions(parsed.values),
  };
}

function baseOptions(values: Record<string, unknown>): CliOptions {
  const scope = values.scope;
  if (scope !== undefined && scope !== "project" && scope !== "global") {
    throw new Error("Invalid scope");
  }
  const agentsValue = typeof values.agents === "string" ? values.agents : undefined;
  const agentValue = typeof values.agent === "string" ? values.agent : undefined;
  const rootValue = typeof values.root === "string" ? values.root : process.cwd();
  const selectedAgents = agentsValue
    ? parseAgentList(agentsValue)
    : agentValue
      ? parseAgentList(agentValue)
      : undefined;
  return {
    ...(scope ? { scope } : {}),
    ...(selectedAgents ? { agents: selectedAgents } : {}),
    root: resolve(rootValue),
    nonInteractive: Boolean(values["non-interactive"]),
    dryRun: Boolean(values["dry-run"]),
    json: Boolean(values.json),
    force: Boolean(values.force),
    yes: Boolean(values.yes),
    ...(typeof values.owner === "string" ? { owner: values.owner } : {}),
  };
}

function output(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function cancelIfNeeded<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Installation cancelled.");
    process.exit(0);
  }
  return value;
}

async function interactiveOptions(
  options: CliOptions,
  config: BootstrapConfig,
): Promise<{
  scope: Scope;
  mode: BootstrapConfig["mode"];
  agents: Agent[];
}> {
  if (options.nonInteractive || !process.stdin.isTTY) {
    return {
      scope: options.scope ?? config.scope,
      mode: config.mode,
      agents: options.agents ?? config.agents,
    };
  }
  p.intro("Agent Skill Bootstrap");
  const scope =
    options.scope ??
    cancelIfNeeded(
      await p.select<Scope>({
        message: "Where should automatic skill bootstrap be installed?",
        options: [
          {
            value: "project",
            label: "This project",
            hint: "configuration stays in the repository",
          },
          {
            value: "global",
            label: "This user account",
            hint: "applies to projects opened on this machine",
          },
        ],
        initialValue: config.scope,
      }),
    );
  const mode = config.mode;
  const agents =
    options.agents ??
    cancelIfNeeded(
      await p.multiselect<Agent>({
        message: "Which agents should receive skills?",
        options: [
          { value: "claude-code", label: "Claude Code" },
          { value: "codex", label: "Codex" },
        ],
        initialValues: config.agents,
        required: true,
      }),
    );
  return { scope, mode, agents };
}

function writeConfig(path: string, config: BootstrapConfig, boundary: string): void {
  safeAtomicWrite(path, stringify(config), boundary);
}

async function init(options: CliOptions): Promise<void> {
  const current = loadConfig(options.root);
  const selected = await interactiveOptions(options, current);
  const config = withOverrides(current, selected);
  const configPath =
    selected.scope === "global" ? userConfigPath() : projectConfigPath(options.root);
  if (options.dryRun) {
    output({ action: "init", configPath, ...selected }, options.json);
    return;
  }

  writeConfig(
    configPath,
    config,
    selected.scope === "global" ? homedir() : options.root,
  );
  const spinner = options.nonInteractive || options.json ? null : p.spinner();
  spinner?.start("Installing persistent runtime");
  const runtime = installRuntime(selected.scope, options.root);
  spinner?.message("Installing lifecycle hooks");
  const hookFiles = installHooks(
    selected.agents,
    selected.scope,
    options.root,
    runtime,
    config,
  );
  spinner?.message("Detecting project and synchronizing skills");
  const result = await syncSkills({
    root: options.root,
    scope: selected.scope,
    agents: selected.agents,
    config,
    skillsBinary: runtime.skillsBinary,
    force: true,
    maintain: true,
  });
  spinner?.stop("Agent Skill Bootstrap is configured");
  const summary = {
    scope: selected.scope,
    agents: selected.agents,
    configPath,
    hookFiles,
    installed: result.installed.map((item) => item.id),
    warnings: result.warnings,
    trustRequired: selected.agents,
  };
  if (options.json || options.nonInteractive) output(summary, options.json);
  else
    p.outro(
      `Configured ${result.installed.length} skill binding(s). Approve the new hooks when Claude Code or Codex asks for trust.`,
    );
}

async function sync(options: CliOptions, hook = false): Promise<SyncResult> {
  assertSupportedNode();
  const config = withOverrides(loadConfig(options.root), {
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
  });
  const skillsBinary = findSkillsBinary();
  const result = await syncSkills({
    root: options.root,
    scope: config.scope,
    agents: options.agents ?? config.agents,
    config,
    skillsBinary,
    dryRun: options.dryRun,
    force: options.force,
    hook,
    maintain: hook,
  });
  if (!hook) output(result, options.json);
  return result;
}

function scan(options: CliOptions): void {
  output(detectProject(options.root), options.json);
}

function doctor(options: CliOptions): void {
  const config = loadConfig(options.root);
  const runtimePath = runtimeRoot(config.scope, options.root);
  const runtime = {
    root: `${runtimePath}/${VERSION}`,
    cli: `${runtimePath}/${VERSION}/cli.js`,
    skillsBinary: `${runtimePath}/${VERSION}/node_modules/skills/bin/cli.mjs`,
    node: process.execPath,
  };
  const supported = nodeSupported() && platformSupported();
  const report = {
    ok: true,
    overallStatus: supported ? "trust-required" : "unsupported",
    statusDefinitions: {
      "supported-and-verified":
        "The host supplied explicit evidence that the exact hook was approved and loaded",
      "trust-required":
        "The runtime and hook are healthy, but host approval cannot be inferred",
      "installed-but-unverified":
        "Installation files exist, but one or more runtime checks failed",
      unsupported:
        "The host, platform, or installation is outside the verified 0.1 contract",
    },
    node: process.version,
    nodeSupported: nodeSupported(),
    platform: process.platform,
    platformSupported: platformSupported(),
    projectRoot: options.root,
    config: {
      scope: config.scope,
      agents: config.agents,
    },
    runtime: {
      path: runtime.root,
      healthy: runtimeHealthy(runtime),
    },
    hooks: config.agents.map((agent) => ({
      agent,
      path: hookPath(agent, config.scope, options.root),
      exists: existsSync(hookPath(agent, config.scope, options.root)),
      status: !supported
        ? "unsupported"
        : existsSync(hookPath(agent, config.scope, options.root)) &&
            runtimeHealthy(runtime)
          ? "trust-required"
          : existsSync(hookPath(agent, config.scope, options.root))
            ? "installed-but-unverified"
            : "unsupported",
      ready: false,
      verification: `Open /hooks in ${agent} and approve the exact Agent Skill Bootstrap hook definition`,
    })),
    inventory: {
      global: inventory("global", options.root).length,
      project: inventory("project", options.root).length,
    },
  };
  report.ok =
    report.nodeSupported &&
    report.platformSupported &&
    report.runtime.healthy &&
    report.hooks.every((hook) => hook.exists);
  report.overallStatus = !supported
    ? "unsupported"
    : report.ok
      ? "trust-required"
      : report.hooks.some((hook) => hook.exists)
        ? "installed-but-unverified"
        : "unsupported";
  output(report, options.json);
  if (!report.ok) process.exitCode = 1;
}

function uninstall(options: CliOptions): void {
  if (!options.yes) throw new Error("uninstall requires --yes");
  const config = withOverrides(loadConfig(options.root), {
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
  });
  const removedHooks = config.agents
    .map((agent) => ({
      agent,
      path: hookPath(agent, config.scope, options.root),
    }))
    .filter(({ agent, path }) =>
      removeOwnedHook(path, agent, config.scope, options.root),
    )
    .map(({ path }) => path);
  const runtime = runtimeRoot(config.scope, options.root);
  if (existsSync(runtime)) {
    const boundary = config.scope === "global" ? homedir() : options.root;
    assertWithinBoundary(runtime, boundary);
    assertNoSymlinkPath(runtime, boundary);
    rmSync(runtime, { recursive: true, force: true });
  }
  output({ removedHooks, removedRuntime: runtime }, options.json);
}

function requiredFromResult(
  result: SyncResult,
  agents: Agent[],
): Map<Agent, Set<string>> {
  const ids = new Set([
    ...result.selected.map((candidate) => candidate.id),
    ...result.generated.map((candidate) => candidate.id),
  ]);
  return new Map(agents.map((agent) => [agent, new Set(ids)]));
}

async function analyze(options: CliOptions): Promise<void> {
  const config = withOverrides(loadConfig(options.root), {
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
  });
  const result = await syncSkills({
    root: options.root,
    scope: config.scope,
    agents: config.agents,
    config,
    skillsBinary: findSkillsBinary(),
    dryRun: true,
    force: true,
  });
  const analysis = analyzeManagedSkills(
    options.root,
    requiredFromResult(result, config.agents),
  );
  output({ briefing: result.briefing, ...analysis }, options.json);
}

async function prune(options: CliOptions): Promise<void> {
  if (!options.dryRun && !options.yes) {
    throw new Error("prune requires --yes; use --dry-run to preview");
  }
  const config = withOverrides(loadConfig(options.root), {
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
  });
  const result = await syncSkills({
    root: options.root,
    scope: config.scope,
    agents: config.agents,
    config,
    skillsBinary: findSkillsBinary(),
    dryRun: true,
    force: true,
  });
  const maintenance = quarantineManagedSkills(
    options.root,
    requiredFromResult(result, config.agents),
    { dryRun: options.dryRun },
  );
  output(maintenance, options.json);
}

function restore(idOrSlug: string | undefined, options: CliOptions): void {
  if (!idOrSlug) throw new Error("restore requires a skill id or slug");
  if (!options.yes) throw new Error("restore requires --yes");
  output(restoreQuarantined(options.root, idOrSlug), options.json);
}

function hookInput(): HookEventInput {
  if (process.stdin.isTTY) {
    throw new Error("SessionStart hook input is required");
  }
  const maximumBytes = 1_000_000;
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - total));
      const bytes = readSync(0, chunk, 0, chunk.length, null);
      if (bytes === 0) break;
      total += bytes;
      if (total > maximumBytes) {
        throw new Error("SessionStart hook input exceeds 1 MB");
      }
      chunks.push(chunk.subarray(0, bytes));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("exceeds 1 MB")) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read SessionStart hook input: ${detail}`, {
      cause: error,
    });
  }
  const value = Buffer.concat(chunks).toString("utf8");
  if (!value) {
    throw new Error("SessionStart hook input is not valid JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("SessionStart hook input is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SessionStart hook input is not valid JSON");
  }
  return parsed;
}

async function hook(options: CliOptions): Promise<void> {
  try {
    const input = hookInput();
    if (input.hook_event_name !== "SessionStart") {
      throw new Error("Only SessionStart is supported");
    }
    const agent = options.agents?.[0];
    const scope = options.scope;
    if (!agent || options.agents?.length !== 1 || !scope) {
      throw new Error("Hook requires one agent and an explicit scope");
    }
    if (options.owner !== ownershipMarker(scope, agent)) {
      throw new Error("Hook ownership marker is missing or invalid");
    }
    const root = resolveHookProjectRoot(agent, scope, options.root, input);
    const result = await sync(
      { ...options, root, nonInteractive: true, agents: [agent], scope },
      true,
    );
    output(hookSuccessOutput("SessionStart", result), true);
  } catch (error) {
    output(hookFailureOutput(error), true);
  }
}

async function main(): Promise<void> {
  const cli = parseCli();
  switch (cli.command) {
    case "help":
      output(HELP, false);
      return;
    case "version":
      output(VERSION, false);
      return;
    case "init":
      await init(cli.options);
      return;
    case "scan":
      scan(cli.options);
      return;
    case "sync":
      await sync(cli.options);
      return;
    case "hook":
      await hook(cli.options);
      return;
    case "analyze":
      await analyze(cli.options);
      return;
    case "prune":
      await prune(cli.options);
      return;
    case "quarantine":
      output(listQuarantined(cli.options.root), cli.options.json);
      return;
    case "restore":
      restore(cli.positionals[0], cli.options);
      return;
    case "doctor":
      doctor(cli.options);
      return;
    case "uninstall":
      uninstall(cli.options);
      return;
    default:
      throw new Error(`Unknown command: ${cli.command}\n\n${HELP}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
