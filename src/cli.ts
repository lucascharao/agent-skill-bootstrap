import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { stringify } from "yaml";
import { briefingContext } from "./briefing.js";
import {
  loadConfig,
  projectConfigPath,
  userConfigPath,
  withOverrides,
  type BootstrapConfig,
} from "./config.js";
import { detectProject } from "./detection.js";
import { hookPath, installHooks } from "./hooks.js";
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
  runtimeHealthy,
  VERSION,
} from "./runtime.js";
import { syncSkills } from "./sync.js";
import { AGENTS, type Agent, type Mode, type Scope, type SyncResult } from "./types.js";

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
  agent-skill-bootstrap run <claude|codex> -- [agent arguments]
  agent-skill-bootstrap uninstall --yes

Options:
  --scope <project|global>       Installation scope
  --mode <native|strict>        Startup guarantee
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
  mode?: Mode | undefined;
  agents?: Agent[] | undefined;
  root: string;
  nonInteractive: boolean;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  yes: boolean;
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
  passthrough: string[];
  options: CliOptions;
} {
  const separator = process.argv.indexOf("--");
  const ownArgs = process.argv.slice(2, separator === -1 ? undefined : separator);
  const passthrough = separator === -1 ? [] : process.argv.slice(separator + 1);
  const parsed = parseArgs({
    args: ownArgs,
    allowPositionals: true,
    strict: false,
    options: {
      scope: { type: "string" },
      mode: { type: "string" },
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
      passthrough,
      options: baseOptions(parsed.values),
    };
  if (parsed.values.version)
    return {
      command: "version",
      positionals: [],
      passthrough,
      options: baseOptions(parsed.values),
    };
  const positionals = parsed.positionals;
  return {
    command: positionals[0] ?? "init",
    positionals: positionals.slice(1),
    passthrough,
    options: baseOptions(parsed.values),
  };
}

function baseOptions(values: Record<string, unknown>): CliOptions {
  const scope = values.scope;
  const mode = values.mode;
  if (scope !== undefined && scope !== "project" && scope !== "global") {
    throw new Error("Invalid scope");
  }
  if (mode !== undefined && mode !== "native" && mode !== "strict") {
    throw new Error("Invalid mode");
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
    ...(mode ? { mode } : {}),
    ...(selectedAgents ? { agents: selectedAgents } : {}),
    root: resolve(rootValue),
    nonInteractive: Boolean(values["non-interactive"]),
    dryRun: Boolean(values["dry-run"]),
    json: Boolean(values.json),
    force: Boolean(values.force),
    yes: Boolean(values.yes),
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
): Promise<{ scope: Scope; mode: Mode; agents: Agent[] }> {
  if (options.nonInteractive || !process.stdin.isTTY) {
    return {
      scope: options.scope ?? config.scope,
      mode: options.mode ?? config.mode,
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
  const mode = options.mode ?? config.mode;
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

function writeConfig(path: string, config: BootstrapConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, stringify(config), { mode: 0o600 });
  renameSync(temporary, path);
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

  writeConfig(configPath, config);
  const spinner = options.nonInteractive || options.json ? null : p.spinner();
  spinner?.start("Installing persistent runtime");
  const runtime = await installRuntime(selected.scope, options.root);
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
    mode: selected.mode,
    agents: selected.agents,
    configPath,
    hookFiles,
    installed: result.installed.map((item) => item.id),
    warnings: result.warnings,
    trustRequired: selected.agents,
    strictCommand:
      selected.mode === "strict"
        ? `node ${JSON.stringify(runtime.cli)} run <claude|codex>`
        : undefined,
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
    ...(options.mode ? { mode: options.mode } : {}),
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
  };
  const report = {
    ok: true,
    node: process.version,
    nodeSupported: nodeSupported(),
    projectRoot: options.root,
    config: {
      scope: config.scope,
      mode: config.mode,
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
      trustRequired: true,
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
    report.runtime.healthy &&
    report.hooks.every((hook) => hook.exists);
  output(report, options.json);
  if (!report.ok) process.exitCode = 1;
}

function spawnAgent(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: "inherit",
      env: { ...process.env, AGENT_SKILL_BOOTSTRAP_STRICT: "1" },
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function runAgent(
  requested: string | undefined,
  passthrough: string[],
  options: CliOptions,
): Promise<void> {
  assertSupportedNode();
  const mapping: Record<string, { agent: Agent; executable: string }> = {
    claude: { agent: "claude-code", executable: "claude" },
    "claude-code": { agent: "claude-code", executable: "claude" },
    codex: { agent: "codex", executable: "codex" },
  };
  const target = requested ? mapping[requested] : undefined;
  if (!target) throw new Error("run requires claude or codex");
  const config = withOverrides(loadConfig(options.root), {
    mode: "strict",
    agents: [target.agent],
    ...(options.scope ? { scope: options.scope } : {}),
  });
  await syncSkills({
    root: options.root,
    scope: config.scope,
    agents: [target.agent],
    config,
    skillsBinary: findSkillsBinary(),
    force: true,
    maintain: true,
  });
  process.exitCode = await spawnAgent(target.executable, passthrough, options.root);
}

function removeOwnedHook(path: string): boolean {
  if (!existsSync(path)) return false;
  const original = readFileSync(path, "utf8");
  const value = JSON.parse(original) as Record<string, unknown>;
  const hooks = value.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;
  let changed = false;
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const entries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const filtered = entries.filter(
      (item) => !JSON.stringify(item).includes("agent-skill-bootstrap:owned"),
    );
    if (filtered.length !== entries.length) {
      hooks[event] = filtered;
      changed = true;
    }
  }
  if (!changed) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return true;
}

function uninstall(options: CliOptions): void {
  if (!options.yes) throw new Error("uninstall requires --yes");
  const config = loadConfig(options.root);
  const removedHooks = config.agents
    .map((agent) => hookPath(agent, config.scope, options.root))
    .filter(removeOwnedHook);
  const runtime = runtimeRoot(config.scope, options.root);
  if (existsSync(runtime)) rmSync(runtime, { recursive: true, force: true });
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

function hookInput(): { hook_event_name?: string } {
  if (process.stdin.isTTY) return {};
  try {
    const value = readFileSync(0, "utf8");
    return value ? (JSON.parse(value) as { hook_event_name?: string }) : {};
  } catch {
    return {};
  }
}

async function hook(options: CliOptions): Promise<void> {
  const event = hookInput().hook_event_name ?? "SessionStart";
  try {
    const result = await sync({ ...options, nonInteractive: true }, true);
    const context = briefingContext(result.briefing, [
      ...result.selected.map((candidate) => candidate.id),
      ...result.generated.map((candidate) => candidate.id),
    ]);
    output(
      {
        continue: true,
        systemMessage: "Agent Skill Bootstrap completed the project skill check.",
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: context,
        },
      },
      true,
    );
  } catch (error) {
    output(
      {
        continue: false,
        stopReason: `Agent Skill Bootstrap could not prepare this project: ${(error as Error).message}`,
      },
      true,
    );
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
    case "run":
      await runAgent(cli.positionals[0], cli.passthrough, cli.options);
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
