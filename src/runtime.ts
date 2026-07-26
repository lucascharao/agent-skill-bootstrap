import { cpSync, existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoSymlinkPath,
  assertWithinBoundary,
  ensureSafeDirectory,
  safeAtomicWrite,
} from "./fs-safety.js";
import { runtimeRoot } from "./paths.js";
import type { Scope } from "./types.js";

export const VERSION = "0.1.0";
export const SKILLS_VERSION = "1.5.19";

export function platformSupported(platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux";
}

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
  if (!platformSupported()) {
    throw new Error("Only macOS and Linux are supported in version 0.1.0");
  }
}

export function findSkillsBinary(
  base = dirname(fileURLToPath(import.meta.url)),
): string {
  const candidates = [
    join(base, "node_modules", "skills", "bin", "cli.mjs"),
    join(base, "..", "node_modules", "skills", "bin", "cli.mjs"),
    join(base, "..", "..", "skills", "bin", "cli.mjs"),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(
      "Pinned official skills CLI is missing; rerun agent-skill-bootstrap setup",
    );
  }
  return found;
}

export interface RuntimeInstall {
  root: string;
  cli: string;
  skillsBinary: string;
  node: string;
}

export function installRuntime(
  scope: Scope,
  projectRoot: string,
  home?: string,
): RuntimeInstall {
  assertSupportedNode();
  const root = join(runtimeRoot(scope, projectRoot, home), VERSION);
  const cli = join(root, "cli.js");
  const skillsBinary = join(root, "node_modules", "skills", "bin", "cli.mjs");
  const boundary = scope === "global" ? (home ?? homedir()) : projectRoot;
  ensureSafeDirectory(root, boundary);
  if (!existsSync(cli)) {
    const current = fileURLToPath(import.meta.url);
    if (!current.endsWith(".js")) {
      throw new Error("Build the project before installing the persistent runtime");
    }
    safeAtomicWrite(cli, readFileSync(current, "utf8"), boundary, { mode: 0o700 });
  }
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    safeAtomicWrite(
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
      boundary,
    );
  }
  assertNoSymlinkPath(root, boundary);
  if (!existsSync(skillsBinary)) {
    const packagedBinary = findSkillsBinary();
    const packagedRoot = dirname(dirname(packagedBinary));
    const destination = join(root, "node_modules", "skills");
    ensureSafeDirectory(dirname(destination), boundary);
    try {
      cpSync(packagedRoot, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
        filter: (source) => {
          if (lstatSync(source).isSymbolicLink()) {
            throw new Error(`Refusing symlinked runtime dependency: ${source}`);
          }
          return true;
        },
      });
    } catch (error) {
      assertWithinBoundary(destination, boundary);
      try {
        lstatSync(destination);
        rmSync(destination, { recursive: true, force: true });
      } catch {
        // The original copy failure remains the actionable diagnostic. A
        // leftover destination is fail-closed on the next installation.
      }
      throw error;
    }
  }
  assertNoSymlinkPath(root, boundary);
  return { root, cli, skillsBinary, node: process.execPath };
}

export function runtimeHealthy(runtime: RuntimeInstall): boolean {
  if (
    !existsSync(runtime.cli) ||
    !existsSync(runtime.skillsBinary) ||
    !runtime.node ||
    !existsSync(runtime.node)
  ) {
    return false;
  }
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
