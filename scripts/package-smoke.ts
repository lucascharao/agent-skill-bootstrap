import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "..");
const sandbox = mkdtempSync(join(tmpdir(), "agent-skill-bootstrap-smoke-"));
let tarball: string | undefined;

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

interface InitOutput {
  scope: string;
  agents: string[];
}

interface HookOutput {
  continue?: boolean;
  hookSpecificOutput?: { additionalContext?: string };
}

function installedHookCommand(
  agent: string,
  scope: string,
  root: string,
  home: string,
  codexHome: string,
): string {
  const path =
    agent === "claude-code"
      ? join(scope === "project" ? root : home, ".claude", "settings.json")
      : scope === "project"
        ? join(root, ".codex", "hooks.json")
        : join(codexHome, "hooks.json");
  if (!existsSync(path)) throw new Error(`Installed hook is missing: ${path}`);
  const value = JSON.parse(readFileSync(path, "utf8")) as {
    hooks?: {
      SessionStart?: Array<{
        hooks?: Array<{ type?: string; command?: string }>;
      }>;
    };
  };
  const commands = (value.hooks?.SessionStart ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter(
      (handler) => handler.type === "command" && typeof handler.command === "string",
    )
    .map((handler) => handler.command as string);
  if (commands.length !== 1) {
    throw new Error(`Expected one installed SessionStart command in ${path}`);
  }
  return commands[0]!;
}

function run(command: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repository,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function findBriefing(root: string): boolean {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && findBriefing(path)) return true;
    if (entry.isFile() && entry.name === "briefing.json") return true;
  }
  return false;
}

function smokeCombination(cli: string, agent: string, scope: string): void {
  const label = `${agent}-${scope}`;
  process.stdout.write(`Smoke: ${label}\n`);
  const root = join(sandbox, label, "project");
  const home = join(sandbox, label, "home");
  const codexHome = join(home, "custom-codex");
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: label }));
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CLAUDE_PROJECT_DIR: root,
    NO_COLOR: "1",
  };

  const initialized = JSON.parse(
    run(
      process.execPath,
      [
        cli,
        "init",
        "--scope",
        scope,
        "--agents",
        agent,
        "--root",
        root,
        "--non-interactive",
        "--json",
      ],
      { env },
    ),
  ) as InitOutput;
  if (initialized.scope !== scope || !initialized.agents.includes(agent)) {
    throw new Error(`Unexpected init result for ${label}`);
  }

  const runtimeCli =
    scope === "project"
      ? join(root, ".agent-skill-bootstrap", "runtime", "0.1.0", "cli.js")
      : join(home, ".config", "agent-skill-bootstrap", "runtime", "0.1.0", "cli.js");
  const command = installedHookCommand(agent, scope, root, home, codexHome);
  if (!command.includes(runtimeCli)) {
    throw new Error(`Installed hook does not reference its persistent runtime`);
  }
  const hookOutput = JSON.parse(
    run("/bin/sh", ["-c", command], {
      env,
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        cwd: root,
      }),
    }),
  ) as HookOutput;
  if (
    hookOutput.continue !== true ||
    !hookOutput.hookSpecificOutput?.additionalContext
  ) {
    throw new Error(`SessionStart did not prepare ${label}`);
  }

  const briefingRoot =
    scope === "project"
      ? join(root, ".agent-skill-bootstrap")
      : join(home, ".config", "agent-skill-bootstrap", "projects");
  if (!findBriefing(briefingRoot)) {
    throw new Error(`Briefing was not persisted for ${label}`);
  }

  const uninstallOutput = run(
    process.execPath,
    [
      cli,
      "uninstall",
      "--yes",
      "--root",
      root,
      "--scope",
      scope,
      "--agents",
      agent,
      "--json",
    ],
    { env },
  );
  if (existsSync(runtimeCli)) {
    throw new Error(`Runtime was not removed for ${label}: ${uninstallOutput}`);
  }
}

try {
  tarball = join(repository, "agent-skill-bootstrap-0.1.0.tgz");
  process.stdout.write("Smoke: build\n");
  run("npm", ["run", "build"]);
  process.stdout.write("Smoke: pack\n");
  run("npm", ["pack", "--silent", "--ignore-scripts"]);
  if (!existsSync(tarball)) throw new Error("npm pack did not create the tarball");
  const installRoot = join(sandbox, "install");
  process.stdout.write("Smoke: install tarball\n");
  run(
    "npm",
    [
      "install",
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: sandbox },
  );
  const cli = join(
    installRoot,
    "node_modules",
    "agent-skill-bootstrap",
    "dist",
    "cli.js",
  );
  process.stdout.write("Smoke: version\n");
  if (run(process.execPath, [cli, "--version"]) !== "0.1.0") {
    throw new Error("Packed CLI version check failed");
  }

  for (const agent of ["claude-code", "codex"]) {
    for (const scope of ["project", "global"]) {
      smokeCombination(cli, agent, scope);
    }
  }
  process.stdout.write(
    "Package smoke passed for Claude Code and Codex in project and user scopes.\n",
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  if (tarball && existsSync(tarball)) rmSync(tarball);
}
