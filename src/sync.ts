import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BootstrapConfig } from "./config.js";
import { detectProject } from "./detection.js";
import { DiscoveryError, SkillsApi, SkillsCli } from "./discovery.js";
import { installDirectory, installSnapshot } from "./install.js";
import { alreadyInstalled } from "./inventory.js";
import { withLock } from "./lock.js";
import { statePath } from "./paths.js";
import { auditAllowed, fallbackAllowed, scoreCandidate } from "./policy.js";
import { cacheFresh, markSynced } from "./state.js";
import type {
  Agent,
  Scope,
  SkillCandidate,
  SkillSnapshot,
  SyncResult,
} from "./types.js";

interface SyncOptions {
  root: string;
  scope: Scope;
  agents: Agent[];
  config: BootstrapConfig;
  dryRun?: boolean;
  force?: boolean;
  hook?: boolean;
  home?: string;
  skillsBinary: string;
  api?: SkillsApi;
  cli?: SkillsCli;
}

interface Selected {
  candidate: SkillCandidate;
  provider: "api" | "cli";
  snapshot?: SkillSnapshot;
}

function choose(
  candidates: SkillCandidate[],
  signal: ReturnType<typeof detectProject>["signals"][number],
  config: BootstrapConfig,
): SkillCandidate | null {
  return (
    candidates
      .map((candidate) => ({
        candidate,
        relevance: scoreCandidate(candidate, signal, config),
      }))
      .filter((entry) => entry.relevance.accepted)
      .sort(
        (a, b) =>
          b.relevance.score - a.relevance.score ||
          a.candidate.id.localeCompare(b.candidate.id),
      )[0]?.candidate ?? null
  );
}

async function discover(options: SyncOptions): Promise<{
  selected: Selected[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const api = options.api ?? new SkillsApi(options.config);
  const cli = options.cli ?? new SkillsCli(options.skillsBinary, options.root);
  const token = process.env[options.config.discovery.token_env];
  let provider: "api" | "cli" =
    options.config.discovery.provider === "cli" ||
    (options.config.discovery.provider === "auto" && !token)
      ? "cli"
      : "api";
  const selected = new Map<string, Selected>();

  for (const signal of detectProject(options.root).signals) {
    if (signal.technology === "General software project") {
      warnings.push(
        "No supported project stack was detected; automatic install skipped",
      );
      continue;
    }
    let candidates: SkillCandidate[] = [];
    if (provider === "api") {
      try {
        candidates = await api.search(signal.query);
      } catch (error) {
        const status = error instanceof DiscoveryError ? error.status : undefined;
        if (options.config.discovery.provider !== "auto" || status !== 401) throw error;
        warnings.push(
          "skills.sh API authentication unavailable; using pinned official CLI",
        );
        provider = "cli";
      }
    }
    if (provider === "cli") candidates = await cli.search(signal.query);
    const candidate = choose(candidates, signal, options.config);
    if (candidate && !selected.has(candidate.id)) {
      selected.set(candidate.id, { candidate, provider });
    }
  }

  return {
    selected: [...selected.values()].slice(
      0,
      options.config.security.max_automatic_installs,
    ),
    warnings,
  };
}

async function enrichAndFilter(
  entries: Selected[],
  options: SyncOptions,
  warnings: string[],
): Promise<Selected[]> {
  const api = options.api ?? new SkillsApi(options.config);
  const accepted: Selected[] = [];
  for (const entry of entries) {
    if (entry.provider === "cli") {
      if (options.config.mode === "strict") {
        throw new Error(
          `Strict mode blocks unaudited CLI fallback candidate ${entry.candidate.id}`,
        );
      }
      if (!fallbackAllowed(entry.candidate, options.config)) {
        warnings.push(`Skipped untrusted fallback source ${entry.candidate.source}`);
        continue;
      }
      accepted.push(entry);
      continue;
    }
    const audits = await api.audits(entry.candidate.id);
    if (!auditAllowed(audits, options.config)) {
      warnings.push(`Skipped ${entry.candidate.id}: audit policy rejected it`);
      continue;
    }
    const snapshot = await api.snapshot(entry.candidate.id);
    if (!snapshot.files) {
      warnings.push(`Skipped ${entry.candidate.id}: API snapshot is unavailable`);
      continue;
    }
    accepted.push({ ...entry, snapshot });
  }
  return accepted;
}

async function executeSync(options: SyncOptions): Promise<SyncResult> {
  const detection = detectProject(options.root);
  if (
    options.hook &&
    !options.force &&
    cacheFresh(
      options.scope,
      options.root,
      detection.fingerprint,
      options.config.runtime.cache_ttl_hours,
      options.home,
    )
  ) {
    return {
      status: "skipped",
      detection,
      selected: [],
      installed: [],
      skipped: [],
      warnings: [],
    };
  }

  const discovery = await discover(options);
  const entries = await enrichAndFilter(
    discovery.selected,
    options,
    discovery.warnings,
  );
  const installed: SyncResult["installed"] = [];
  const skipped: SyncResult["skipped"] = [];
  const cli = options.cli ?? new SkillsCli(options.skillsBinary, options.root);

  for (const entry of entries) {
    const missingAgents = options.agents.filter((agent) => {
      const existing = alreadyInstalled(
        entry.candidate.id,
        agent,
        options.scope,
        options.root,
        options.home,
      );
      if (existing) {
        skipped.push({
          candidate: entry.candidate,
          reason: `already installed for ${agent} in ${existing.scope} scope`,
        });
        return false;
      }
      return true;
    });
    if (missingAgents.length === 0 || options.dryRun) continue;

    if (entry.snapshot) {
      for (const agent of missingAgents) {
        installed.push(
          installSnapshot(
            entry.snapshot,
            entry.candidate,
            agent,
            options.scope,
            options.root,
            options.home,
          ),
        );
      }
      continue;
    }

    const temporary = mkdtempSync(join(tmpdir(), "agent-skill-bootstrap-"));
    try {
      const sourcePath = await cli.materialize(
        entry.candidate.source,
        entry.candidate.slug,
        temporary,
      );
      if (!existsSync(sourcePath)) {
        throw new Error(`Official CLI did not produce ${entry.candidate.id}`);
      }
      for (const agent of missingAgents) {
        installed.push(
          installDirectory(
            sourcePath,
            entry.candidate,
            agent,
            options.scope,
            options.root,
            options.home,
          ),
        );
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }

  if (!options.dryRun) {
    markSynced(options.scope, options.root, detection.fingerprint, options.home);
  }
  return {
    status: discovery.warnings.length > 0 ? "degraded" : "ok",
    detection,
    selected: entries.map((entry) => entry.candidate),
    installed,
    skipped,
    warnings: discovery.warnings,
  };
}

export async function syncSkills(options: SyncOptions): Promise<SyncResult> {
  const lockPath = join(
    dirname(statePath(options.scope, options.root, options.home)),
    "sync.lock",
  );
  const timeout = options.config.mode === "strict" ? 120_000 : 2_000;
  return withLock(lockPath, timeout, () => executeSync(options));
}
