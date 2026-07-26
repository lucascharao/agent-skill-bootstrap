import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { assertNoSymlinkPath } from "./fs-safety.js";
import { directoryDigest } from "./install.js";
import { codexHome, skillRoot } from "./paths.js";
import { AGENTS, type Agent, type InstalledSkill, type Scope } from "./types.js";

const ManifestSchema = z.object({
  schema: z.literal(1),
  id: z.string(),
  slug: z.string(),
  source: z.string(),
  hash: z.string().nullable(),
  agent: z.enum(AGENTS),
  scope: z.enum(["global", "project"]),
});

export type InstallManifest = z.infer<typeof ManifestSchema>;

interface ExternalLockEntry {
  source?: string;
  skillFolderHash?: string;
  computedHash?: string;
}

function externalDirectoryDigest(root: string): string {
  // This intentionally mirrors skills@1.5.19 computeSkillFolderHash, whose
  // computedHash has no separators. It is not our managed snapshot digest.
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlinked external skill content: ${path}`);
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root);
  const hash = createHash("sha256");
  for (const path of files.sort((left, right) => left.localeCompare(right))) {
    hash.update(path.slice(root.length + 1).replaceAll("\\", "/"));
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function readExternalLocks(
  scope: Scope,
  projectRoot: string,
  home?: string,
): Record<string, ExternalLockEntry> {
  const base = scope === "global" ? (home ?? homedir()) : projectRoot;
  const paths = [
    join(base, ".agents", ".skill-lock.json"),
    join(base, "skills-lock.json"),
    ...(scope === "global"
      ? [
          join(codexHome(home), ".skill-lock.json"),
          join(codexHome(home), "skills-lock.json"),
        ]
      : []),
  ];
  const skills: Record<string, ExternalLockEntry> = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        skills?: Record<string, ExternalLockEntry>;
      };
      Object.assign(skills, value.skills ?? {});
    } catch {
      // An invalid third-party lock cannot authorize a deduplication decision.
    }
  }
  return skills;
}

export function readManifest(skillPath: string): InstallManifest | null {
  const manifestPath = join(skillPath, ".agent-skill-bootstrap.json");
  try {
    return ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch {
    return null;
  }
}

export function validManagedBinding(
  skillPath: string,
  expected?: { id: string; agent: Agent; scope: Scope },
  boundary = dirname(skillPath),
): InstalledSkill | null {
  try {
    if (
      !existsSync(skillPath) ||
      lstatSync(skillPath).isSymbolicLink() ||
      !existsSync(join(skillPath, "SKILL.md"))
    ) {
      return null;
    }
    assertNoSymlinkPath(skillPath, boundary);
    const manifest = readManifest(skillPath);
    if (
      !manifest ||
      (expected &&
        (manifest.id !== expected.id ||
          manifest.agent !== expected.agent ||
          manifest.scope !== expected.scope))
    ) {
      return null;
    }
    const digest = directoryDigest(skillPath);
    if (!manifest.hash || digest !== manifest.hash) return null;
    return { ...manifest, path: skillPath };
  } catch {
    return null;
  }
}

export function inventory(
  scope: Scope,
  projectRoot: string,
  home?: string,
): InstalledSkill[] {
  const installed: InstalledSkill[] = [];
  const externalLocks = readExternalLocks(scope, projectRoot, home);
  for (const agent of AGENTS) {
    const root = skillRoot(agent, scope, projectRoot, home);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      const managed = validManagedBinding(path, undefined, root);
      if (managed && managed.agent === agent && managed.scope === scope) {
        installed.push(managed);
        continue;
      }
      const external = externalLocks[entry.name];
      if (!external?.source || !existsSync(join(path, "SKILL.md"))) continue;
      try {
        assertNoSymlinkPath(path, root);
        if (
          !external.computedHash ||
          externalDirectoryDigest(path) !== external.computedHash
        ) {
          continue;
        }
      } catch {
        continue;
      }
      installed.push({
        id: `${external.source}/${entry.name}`,
        slug: entry.name,
        source: external.source,
        hash: external.computedHash,
        agent,
        scope,
        path,
      });
    }
  }
  return installed;
}

export function alreadyInstalled(
  id: string,
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home?: string,
): InstalledSkill | null {
  const globalMatch = inventory("global", projectRoot, home).find(
    (item) => item.id === id && item.agent === agent,
  );
  if (globalMatch) return globalMatch;
  if (scope === "global") return null;
  return (
    inventory("project", projectRoot, home).find(
      (item) => item.id === id && item.agent === agent,
    ) ?? null
  );
}
