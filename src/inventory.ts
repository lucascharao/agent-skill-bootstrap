import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { skillRoot } from "./paths.js";
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

function readExternalLocks(
  scope: Scope,
  projectRoot: string,
  home?: string,
): Record<string, ExternalLockEntry> {
  const base = scope === "global" ? (home ?? homedir()) : projectRoot;
  const paths = [
    join(base, ".agents", ".skill-lock.json"),
    join(base, "skills-lock.json"),
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
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      const manifest = readManifest(path);
      if (manifest && manifest.agent === agent && manifest.scope === scope) {
        installed.push({ ...manifest, path });
        continue;
      }
      const external = externalLocks[entry.name];
      if (!external?.source || !existsSync(join(path, "SKILL.md"))) continue;
      installed.push({
        id: `${external.source}/${entry.name}`,
        slug: entry.name,
        source: external.source,
        hash: external.skillFolderHash ?? external.computedHash ?? null,
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
