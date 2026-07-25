import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeRoot } from "./paths.js";
import type { Scope } from "./types.js";

export const VERSION = "0.1.0";
export const SKILLS_VERSION = "1.5.19";

export function nodeSupported(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 20);
}

export function assertSupportedNode(): void {
  if (!nodeSupported()) {
    throw new Error(
      `Node.js 22.20.0 or newer is required; current version is ${process.version}`,
    );
  }
}

export function findSkillsBinary(
  base = dirname(fileURLToPath(import.meta.url)),
): string {
  const candidates = [
    join(base, "node_modules", "skills", "bin", "cli.mjs"),
    join(base, "..", "node_modules", "skills", "bin", "cli.mjs"),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error("Pinned official skills CLI is missing; run doctor --repair");
  }
  return found;
}

function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const npmExecPath = process.env.npm_execpath;
    const child = npmExecPath
      ? spawn(
          process.execPath,
          [
            npmExecPath,
            "install",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
          ],
          { cwd, shell: false, stdio: "inherit" },
        )
      : spawn(
          "npm",
          ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"],
          { cwd, shell: false, stdio: "inherit" },
        );
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`npm install failed with exit code ${code}`)),
    );
  });
}

export interface RuntimeInstall {
  root: string;
  cli: string;
  skillsBinary: string;
}

export async function installRuntime(
  scope: Scope,
  projectRoot: string,
  home?: string,
): Promise<RuntimeInstall> {
  assertSupportedNode();
  const root = join(runtimeRoot(scope, projectRoot, home), VERSION);
  const cli = join(root, "cli.js");
  const skillsBinary = join(root, "node_modules", "skills", "bin", "cli.mjs");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existsSync(cli)) {
    const current = fileURLToPath(import.meta.url);
    if (!current.endsWith(".js")) {
      throw new Error("Build the project before installing the persistent runtime");
    }
    copyFileSync(current, cli);
  }
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    writeFileSync(
      packagePath,
      `${JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: { skills: SKILLS_VERSION },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
  if (!existsSync(skillsBinary)) await runNpmInstall(root);
  return { root, cli, skillsBinary };
}

export function runtimeHealthy(runtime: RuntimeInstall): boolean {
  if (!existsSync(runtime.cli) || !existsSync(runtime.skillsBinary)) return false;
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(runtime.root, "node_modules", "skills", "package.json"),
        "utf8",
      ),
    ) as {
      version?: string;
    };
    return pkg.version === SKILLS_VERSION;
  } catch {
    return false;
  }
}
