import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { statePath } from "./paths.js";
import type { Scope } from "./types.js";

interface ProjectState {
  fingerprint: string;
  syncedAt: string;
  skillIds: string[];
}

interface State {
  schema: 1;
  projects: Record<string, ProjectState>;
}

function key(root: string): string {
  return createHash("sha256").update(root).digest("hex");
}

function read(path: string): State {
  if (!existsSync(path)) return { schema: 1, projects: {} };
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as State;
    return value.schema === 1 && value.projects ? value : { schema: 1, projects: {} };
  } catch {
    return { schema: 1, projects: {} };
  }
}

export function cacheFresh(
  scope: Scope,
  root: string,
  fingerprint: string,
  ttlHours: number,
  home?: string,
): boolean {
  const entry = read(statePath(scope, root, home)).projects[key(root)];
  if (!entry || entry.fingerprint !== fingerprint) return false;
  return Date.now() - Date.parse(entry.syncedAt) < ttlHours * 60 * 60 * 1000;
}

export function markSynced(
  scope: Scope,
  root: string,
  fingerprint: string,
  skillIds: string[] = [],
  home?: string,
): void {
  const path = statePath(scope, root, home);
  const value = read(path);
  value.projects[key(root)] = {
    fingerprint,
    syncedAt: new Date().toISOString(),
    skillIds: [...new Set(skillIds)].sort(),
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function cachedSkillIds(scope: Scope, root: string, home?: string): string[] {
  const entry = read(statePath(scope, root, home)).projects[key(root)];
  return Array.isArray(entry?.skillIds) ? entry.skillIds : [];
}
