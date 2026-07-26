import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { readManifest } from "./inventory.js";
import { quarantineRoot, skillRoot } from "./paths.js";
import { AGENTS } from "./types.js";
import type { Agent, InstalledSkill, QuarantinedSkill } from "./types.js";

const QUARANTINE_MANIFEST = ".agent-skill-bootstrap-quarantine.json";

interface QuarantineManifest extends QuarantinedSkill {
  schema: 1;
  quarantinedAt: string;
}

export interface SkillAnalysis {
  necessary: InstalledSkill[];
  quarantineCandidates: InstalledSkill[];
  unmanaged: Array<{ agent: Agent; path: string; reason: string }>;
}

function safeChild(path: string, root: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath.startsWith(`${resolvedRoot}${sep}`);
}

export function analyzeManagedSkills(
  projectRoot: string,
  required: Map<Agent, Set<string>>,
  home?: string,
): SkillAnalysis {
  const necessary: InstalledSkill[] = [];
  const quarantineCandidates: InstalledSkill[] = [];
  const unmanaged: SkillAnalysis["unmanaged"] = [];

  for (const agent of AGENTS) {
    const root = skillRoot(agent, "project", projectRoot, home);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (
        (!entry.isDirectory() && !entry.isSymbolicLink()) ||
        !existsSync(join(path, "SKILL.md"))
      ) {
        continue;
      }
      const manifest = readManifest(path);
      if (!manifest) {
        unmanaged.push({
          agent,
          path,
          reason: "not owned by agent-skill-bootstrap",
        });
        continue;
      }
      const installed: InstalledSkill = { ...manifest, path };
      if (required.get(agent)?.has(installed.id)) necessary.push(installed);
      else quarantineCandidates.push(installed);
    }
  }

  return { necessary, quarantineCandidates, unmanaged };
}

export function quarantineManagedSkills(
  projectRoot: string,
  required: Map<Agent, Set<string>>,
  options: { dryRun?: boolean; home?: string } = {},
): { analysis: SkillAnalysis; quarantined: QuarantinedSkill[] } {
  const analysis = analyzeManagedSkills(projectRoot, required, options.home);
  const quarantined: QuarantinedSkill[] = [];
  const base = quarantineRoot(projectRoot);

  for (const skill of analysis.quarantineCandidates) {
    const root = skillRoot(skill.agent, "project", projectRoot, options.home);
    if (
      !safeChild(skill.path, root) ||
      lstatSync(skill.path).isSymbolicLink() ||
      !readManifest(skill.path)
    ) {
      continue;
    }
    const destination = join(base, skill.agent, skill.slug);
    const record: QuarantinedSkill = {
      id: skill.id,
      agent: skill.agent,
      originalPath: skill.path,
      quarantinePath: destination,
      reason: "no longer required by the current project briefing",
    };
    quarantined.push(record);
    if (options.dryRun || existsSync(destination)) continue;
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    renameSync(skill.path, destination);
    const metadata: QuarantineManifest = {
      schema: 1,
      ...record,
      quarantinedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(destination, QUARANTINE_MANIFEST),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  return { analysis, quarantined };
}

function quarantineEntries(projectRoot: string): QuarantineManifest[] {
  const base = quarantineRoot(projectRoot);
  if (!existsSync(base)) return [];
  const entries: QuarantineManifest[] = [];
  for (const agent of AGENTS) {
    const root = join(base, agent);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const value = JSON.parse(
          readFileSync(join(root, entry.name, QUARANTINE_MANIFEST), "utf8"),
        ) as QuarantineManifest;
        if (
          value.schema === 1 &&
          value.agent === agent &&
          safeChild(value.quarantinePath, base) &&
          safeChild(value.originalPath, projectRoot)
        ) {
          entries.push(value);
        }
      } catch {
        // Invalid quarantine metadata never authorizes a restore.
      }
    }
  }
  return entries;
}

export function listQuarantined(projectRoot: string): QuarantineManifest[] {
  return quarantineEntries(projectRoot);
}

export function restoreQuarantined(
  projectRoot: string,
  idOrSlug: string,
): QuarantinedSkill {
  const entry = quarantineEntries(projectRoot).find(
    (item) => item.id === idOrSlug || item.quarantinePath.endsWith(`${sep}${idOrSlug}`),
  );
  if (!entry) throw new Error(`Quarantined skill not found: ${idOrSlug}`);
  if (!existsSync(entry.quarantinePath)) {
    throw new Error(`Quarantine content is missing: ${entry.quarantinePath}`);
  }
  if (existsSync(entry.originalPath)) {
    throw new Error(`Restore destination already exists: ${entry.originalPath}`);
  }
  mkdirSync(dirname(entry.originalPath), { recursive: true, mode: 0o755 });
  renameSync(entry.quarantinePath, entry.originalPath);
  const metadata = join(entry.originalPath, QUARANTINE_MANIFEST);
  if (existsSync(metadata)) unlinkSync(metadata);
  return entry;
}
