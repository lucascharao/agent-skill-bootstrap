import { spawn } from "node:child_process";
import { z } from "zod";
import type { BootstrapConfig } from "./config.js";
import type { SkillAudit, SkillCandidate, SkillSnapshot } from "./types.js";

const CandidateSchema = z.object({
  id: z.string().min(3).max(300),
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(200),
  installs: z.number().int().nonnegative().optional(),
  sourceType: z.string().max(30).optional(),
  installUrl: z.string().url().nullable(),
  url: z.string().url().optional(),
  isDuplicate: z.boolean().optional(),
});

const SearchSchema = z.object({
  data: z.array(CandidateSchema).max(200),
});

const SnapshotSchema = z.object({
  id: z.string(),
  source: z.string(),
  slug: z.string(),
  hash: z.string().max(128).nullable(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        contents: z.string().max(1_000_000),
      }),
    )
    .max(200)
    .nullable(),
});

const AuditSchema = z.object({
  id: z.string(),
  audits: z
    .array(
      z.object({
        provider: z.string(),
        status: z.enum(["pass", "warn", "fail"]),
        summary: z.string(),
        riskLevel: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      }),
    )
    .max(50),
});

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function allowedOrigin(url: string, allowlist: string[]): boolean {
  const origin = new URL(url).origin;
  return allowlist.some((entry) => new URL(entry).origin === origin);
}

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  const seconds = value ? Number(value) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(2_000, Math.max(0, seconds * 1_000));
  return Math.min(2_000, 250 * 2 ** attempt);
}

async function fetchJson(
  url: URL,
  token: string | undefined,
  config: BootstrapConfig,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!allowedOrigin(url.href, config.discovery.discovery_origins)) {
    throw new DiscoveryError(`Discovery origin is not user-allowlisted: ${url.origin}`);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    if (!allowedOrigin(url.href, config.discovery.credential_origins)) {
      throw new DiscoveryError(
        `Credential origin is not user-allowlisted: ${url.origin}`,
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay(response, attempt)),
        );
        continue;
      }
      if (!response.ok) {
        throw new DiscoveryError(
          `skills.sh request failed with HTTP ${response.status}`,
          response.status,
        );
      }
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > 5_000_000) {
        throw new DiscoveryError("skills.sh response exceeds 5 MB");
      }
      const text = await response.text();
      if (text.length > 5_000_000) {
        throw new DiscoveryError("skills.sh response exceeds 5 MB");
      }
      return JSON.parse(text) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new DiscoveryError("skills.sh retry budget exhausted");
}

function encodedId(id: string): string {
  const segments = id.split("/");
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("-") ||
        [...segment].some((character) => character.charCodeAt(0) < 32),
    )
  ) {
    throw new DiscoveryError("Invalid skill identifier");
  }
  return segments.map(encodeURIComponent).join("/");
}

export class SkillsApi {
  constructor(
    private readonly config: BootstrapConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private token(): string | undefined {
    return process.env[this.config.discovery.token_env];
  }

  async search(query: string): Promise<SkillCandidate[]> {
    const url = new URL("/api/v1/skills/search", this.config.discovery.api_base_url);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(this.config.discovery.query_limit));
    const parsed = SearchSchema.parse(
      await fetchJson(url, this.token(), this.config, this.fetchImpl),
    );
    return parsed.data.map((item) => ({ ...item, query }));
  }

  async snapshot(id: string): Promise<SkillSnapshot> {
    const url = new URL(
      `/api/v1/skills/${encodedId(id)}`,
      this.config.discovery.api_base_url,
    );
    return SnapshotSchema.parse(
      await fetchJson(url, this.token(), this.config, this.fetchImpl),
    );
  }

  async audits(id: string): Promise<SkillAudit[]> {
    const url = new URL(
      `/api/v1/skills/audit/${encodedId(id)}`,
      this.config.discovery.api_base_url,
    );
    const parsed = AuditSchema.parse(
      await fetchJson(url, this.token(), this.config, this.fetchImpl),
    );
    return parsed.audits;
  }
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new DiscoveryError("Official skills CLI timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new DiscoveryError(`Official skills CLI failed (${code}): ${stderr.trim()}`),
        );
    });
  });
}

export function parseCliSearch(output: string, query: string): SkillCandidate[] {
  // ANSI control sequences are removed before parsing human-oriented CLI output.
  // eslint-disable-next-line no-control-regex
  const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
  const seen = new Set<string>();
  const candidates: SkillCandidate[] = [];
  for (const line of output.replace(ansi, "").split(/\r?\n/)) {
    const match = line.match(/([a-z0-9_.-]+\/[a-z0-9_.-]+)@([a-z0-9_.-]+)/i);
    if (!match?.[1] || !match[2]) continue;
    const source = match[1];
    const slug = match[2];
    const id = `${source}/${slug}`;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      slug,
      name: slug,
      source,
      installUrl: `https://github.com/${source}`,
      sourceType: "github",
      query,
    });
  }
  return candidates;
}

export class SkillsCli {
  constructor(
    private readonly binary: string,
    private readonly cwd: string,
    private readonly node = process.execPath,
  ) {}

  async search(query: string): Promise<SkillCandidate[]> {
    const { stdout } = await run(this.node, [this.binary, "find", query], this.cwd);
    return parseCliSearch(stdout, query);
  }
}
