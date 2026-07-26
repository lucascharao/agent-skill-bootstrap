import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBriefing, persistBriefing } from "./briefing.js";
import type { BootstrapConfig } from "./config.js";
import { detectProject } from "./detection.js";
import { DiscoveryError, SkillsApi, SkillsCli } from "./discovery.js";
import { generateSkillSnapshot } from "./generate.js";
import { installDirectory, installSnapshot } from "./install.js";
import { alreadyInstalled } from "./inventory.js";
import { withLock } from "./lock.js";
import { quarantineManagedSkills } from "./maintenance.js";
import { statePath } from "./paths.js";
import { auditAllowed, fallbackAllowed, scoreCandidate } from "./policy.js";
import { cacheFresh, cachedSkillIds, markSynced } from "./state.js";
import type {
  Agent,
  DetectionSignal,
  ProjectBriefing,
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
  maintain?: boolean;
  home?: string;
  skillsBinary: string;
  api?: SkillsApi;
  cli?: SkillsCli;
}

interface Selected {
  candidate: SkillCandidate;
  provider: "api" | "cli";
  signal: DetectionSignal;
  snapshot?: SkillSnapshot;
}

function choose(
  candidates: SkillCandidate[],
  signal: DetectionSignal,
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

async function discover(
  options: SyncOptions,
  signals: DetectionSignal[],
): Promise<{
  selected: Selected[];
  unresolved: DetectionSignal[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const unresolved: DetectionSignal[] = [];
  const api = options.api ?? new SkillsApi(options.config);
  const cli = options.cli ?? new SkillsCli(options.skillsBinary, options.root);
  const token = process.env[options.config.discovery.token_env];
  let provider: "api" | "cli" =
    options.config.discovery.provider === "cli" ||
    (options.config.discovery.provider === "auto" && !token)
      ? "cli"
      : "api";
  const selected: Selected[] = [];

  for (const signal of signals) {
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
    if (candidate) selected.push({ candidate, provider, signal });
    else unresolved.push(signal);
  }

  return {
    selected: selected.slice(0, options.config.security.max_automatic_installs),
    unresolved,
    warnings,
  };
}

async function enrichAndFilter(
  entries: Selected[],
  options: SyncOptions,
  warnings: string[],
): Promise<{ accepted: Selected[]; rejected: DetectionSignal[] }> {
  const api = options.api ?? new SkillsApi(options.config);
  const accepted: Selected[] = [];
  const rejected: DetectionSignal[] = [];
  for (const entry of entries) {
    if (entry.provider === "cli") {
      if (options.config.mode === "strict") {
        throw new Error(
          `Strict mode blocks unaudited CLI fallback candidate ${entry.candidate.id}`,
        );
      }
      if (!fallbackAllowed(entry.candidate, options.config)) {
        warnings.push(`Skipped untrusted fallback source ${entry.candidate.source}`);
        rejected.push(entry.signal);
        continue;
      }
      accepted.push(entry);
      continue;
    }
    const audits = await api.audits(entry.candidate.id);
    if (!auditAllowed(audits, options.config)) {
      warnings.push(`Skipped ${entry.candidate.id}: audit policy rejected it`);
      rejected.push(entry.signal);
      continue;
    }
    const snapshot = await api.snapshot(entry.candidate.id);
    if (!snapshot.files) {
      warnings.push(`Skipped ${entry.candidate.id}: API snapshot is unavailable`);
      rejected.push(entry.signal);
      continue;
    }
    accepted.push({ ...entry, snapshot });
  }
  return { accepted, rejected };
}

function requiredMap(
  agents: Agent[],
  entries: Selected[],
  generated: Array<ReturnType<typeof generateSkillSnapshot>>,
): Map<Agent, Set<string>> {
  const required = new Map<Agent, Set<string>>();
  for (const agent of agents) {
    required.set(
      agent,
      new Set([
        ...entries.map((entry) => entry.candidate.id),
        ...generated.map((entry) => entry.candidate.id),
      ]),
    );
  }
  return required;
}

function skippedResult(
  detection: ReturnType<typeof detectProject>,
  briefing: ProjectBriefing,
  skillIds: string[],
): SyncResult {
  return {
    status: "skipped",
    detection,
    briefing,
    selected: skillIds.map((id) => ({
      id,
      slug: id.split("/").at(-1) ?? id,
      name: id,
      source: id.split("/").slice(0, -1).join("/"),
      installUrl: null,
      query: "",
    })),
    generated: [],
    installed: [],
    quarantined: [],
    skipped: [],
    warnings: [],
  };
}

async function installCatalogEntry(
  entry: Selected,
  options: SyncOptions,
  installed: SyncResult["installed"],
  skipped: SyncResult["skipped"],
  cli: SkillsCli,
): Promise<void> {
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
  if (missingAgents.length === 0 || options.dryRun) return;

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
    return;
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

function installGeneratedEntry(
  entry: ReturnType<typeof generateSkillSnapshot>,
  options: SyncOptions,
  installed: SyncResult["installed"],
  skipped: SyncResult["skipped"],
): void {
  for (const agent of options.agents) {
    const existing = alreadyInstalled(
      entry.candidate.id,
      agent,
      "project",
      options.root,
      options.home,
    );
    if (existing) {
      skipped.push({
        candidate: entry.candidate,
        reason: `generated fallback already installed for ${agent}`,
      });
      continue;
    }
    if (options.dryRun) continue;
    installed.push(
      installSnapshot(
        entry.snapshot,
        entry.candidate,
        agent,
        "project",
        options.root,
        options.home,
      ),
    );
  }
}

async function executeSync(options: SyncOptions): Promise<SyncResult> {
  const detection = detectProject(options.root);
  const briefing = createBriefing(options.root, detection);
  if (
    options.hook &&
    !options.force &&
    cacheFresh(
      options.scope,
      options.root,
      briefing.fingerprint,
      options.config.runtime.cache_ttl_hours,
      options.home,
    )
  ) {
    return skippedResult(
      detection,
      briefing,
      cachedSkillIds(options.scope, options.root, options.home),
    );
  }

  const discovery = await discover(options, detection.signals);
  const enrichment = await enrichAndFilter(
    discovery.selected,
    options,
    discovery.warnings,
  );
  const fallbackSignals = [...discovery.unresolved, ...enrichment.rejected].slice(
    0,
    options.config.security.max_automatic_installs,
  );
  const generated = fallbackSignals.map((signal) =>
    generateSkillSnapshot(signal, briefing),
  );
  const installed: SyncResult["installed"] = [];
  const skipped: SyncResult["skipped"] = [];
  const cli = options.cli ?? new SkillsCli(options.skillsBinary, options.root);

  for (const entry of enrichment.accepted) {
    await installCatalogEntry(entry, options, installed, skipped, cli);
  }
  for (const entry of generated) {
    installGeneratedEntry(entry, options, installed, skipped);
  }

  const required = requiredMap(options.agents, enrichment.accepted, generated);
  const maintenance =
    options.config.maintenance.automatic_quarantine && options.maintain
      ? quarantineManagedSkills(options.root, required, {
          ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
          ...(options.home !== undefined ? { home: options.home } : {}),
        })
      : { quarantined: [] };

  if (!options.dryRun) {
    persistBriefing(briefing, options.scope, options.home);
    markSynced(
      options.scope,
      options.root,
      briefing.fingerprint,
      [
        ...enrichment.accepted.map((entry) => entry.candidate.id),
        ...generated.map((entry) => entry.candidate.id),
      ],
      options.home,
    );
  }
  return {
    status: discovery.warnings.length > 0 ? "degraded" : "ok",
    detection,
    briefing,
    selected: enrichment.accepted.map((entry) => entry.candidate),
    generated: generated.map((entry) => entry.candidate),
    installed,
    quarantined: maintenance.quarantined,
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
