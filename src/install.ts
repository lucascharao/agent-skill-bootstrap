import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { skillRoot } from "./paths.js";
import type {
  Agent,
  InstalledSkill,
  Scope,
  SkillCandidate,
  SkillSnapshot,
} from "./types.js";

function safeRelativePath(value: string): string {
  const normalized = normalize(value);
  if (
    isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    value.includes("\0")
  ) {
    throw new Error(`Unsafe skill file path: ${value}`);
  }
  return normalized;
}

export function snapshotDigest(snapshot: SkillSnapshot): string {
  const hash = createHash("sha256");
  for (const file of [...(snapshot.files ?? [])]
    .map((entry) => ({ ...entry, path: safeRelativePath(entry.path) }))
    .sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function assertNoSymlinkParents(target: string, stopAt: string): void {
  let current = dirname(target);
  const boundary = resolve(stopAt);
  while (current.startsWith(boundary) && current !== boundary) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked installation path: ${current}`);
    }
    current = dirname(current);
  }
}

function manifest(
  candidate: SkillCandidate,
  hash: string,
  agent: Agent,
  scope: Scope,
  catalogHash?: string | null,
): string {
  return `${JSON.stringify(
    {
      schema: 1,
      id: candidate.id,
      slug: candidate.slug,
      source: candidate.source,
      hash,
      ...(catalogHash ? { catalogHash } : {}),
      agent,
      scope,
      installedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
}

function directoryDigest(root: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlinked skill content: ${path}`);
      }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name !== ".agent-skill-bootstrap.json") {
        files.push(relative(root, path));
      }
    }
  }

  walk(root);
  for (const file of files.sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function atomicDirectory(
  destination: string,
  root: string,
  populate: (staging: string) => void,
): void {
  mkdirSync(root, { recursive: true, mode: 0o755 });
  assertNoSymlinkParents(destination, root);
  if (existsSync(destination)) {
    throw new Error(`Destination already exists and is not owned: ${destination}`);
  }
  const staging = join(root, `.agent-skill-bootstrap-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    populate(staging);
    renameSync(staging, destination);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function installSnapshot(
  snapshot: SkillSnapshot,
  candidate: SkillCandidate,
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home?: string,
): InstalledSkill {
  if (
    !snapshot.files?.length ||
    !snapshot.files.some((file) => file.path === "SKILL.md")
  ) {
    throw new Error(`Skill ${candidate.id} has no installable snapshot`);
  }
  const root = skillRoot(agent, scope, projectRoot, home);
  const destination = join(root, candidate.slug);
  const contentHash = snapshotDigest(snapshot);
  atomicDirectory(destination, root, (staging) => {
    for (const file of snapshot.files ?? []) {
      const safe = safeRelativePath(file.path);
      const target = join(staging, safe);
      if (!resolve(target).startsWith(`${resolve(staging)}${sep}`)) {
        throw new Error(`Skill file escapes staging directory: ${file.path}`);
      }
      mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
      writeFileSync(target, file.contents, { encoding: "utf8", mode: 0o644 });
    }
    const stagedHash = directoryDigest(staging);
    if (stagedHash !== contentHash) {
      throw new Error(`Staged snapshot verification failed for ${candidate.id}`);
    }
    writeFileSync(
      join(staging, ".agent-skill-bootstrap.json"),
      manifest(candidate, contentHash, agent, scope, snapshot.hash),
      { encoding: "utf8", mode: 0o600 },
    );
  });
  return {
    id: candidate.id,
    slug: candidate.slug,
    source: candidate.source,
    hash: contentHash,
    agent,
    scope,
    path: destination,
  };
}

export function installDirectory(
  sourcePath: string,
  candidate: SkillCandidate,
  agent: Agent,
  scope: Scope,
  projectRoot: string,
  home?: string,
): InstalledSkill {
  const skillFile = join(sourcePath, "SKILL.md");
  if (!existsSync(skillFile) || lstatSync(sourcePath).isSymbolicLink()) {
    throw new Error(
      `Official CLI did not materialize a safe SKILL.md for ${candidate.id}`,
    );
  }
  const root = skillRoot(agent, scope, projectRoot, home);
  const destination = join(root, candidate.slug);
  const hash = directoryDigest(sourcePath);
  atomicDirectory(destination, root, (staging) => {
    cpSync(sourcePath, staging, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      filter: (source) => !lstatSync(source).isSymbolicLink(),
    });
    writeFileSync(
      join(staging, ".agent-skill-bootstrap.json"),
      manifest(candidate, hash, agent, scope),
      { encoding: "utf8", mode: 0o600 },
    );
  });
  return {
    id: candidate.id,
    slug: candidate.slug,
    source: candidate.source,
    hash,
    agent,
    scope,
    path: destination,
  };
}

export function relativeInstallPath(path: string, root: string): string {
  return relative(root, path);
}
