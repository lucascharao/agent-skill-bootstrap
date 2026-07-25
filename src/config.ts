import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Agent, Mode, Scope } from "./types.js";

const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  scope: z.enum(["global", "project"]).default("project"),
  mode: z.enum(["native", "strict"]).default("native"),
  agents: z
    .array(z.enum(["claude-code", "codex", "grok"]))
    .min(1)
    .default(["claude-code", "codex", "grok"]),
  discovery: z
    .object({
      provider: z.enum(["auto", "api", "cli"]).default("auto"),
      api_base_url: z.string().url().default("https://skills.sh"),
      token_env: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .default("VERCEL_OIDC_TOKEN"),
      query_limit: z.number().int().min(1).max(10).default(10),
      discovery_origins: z.array(z.string().url()).default(["https://skills.sh"]),
      credential_origins: z.array(z.string().url()).default(["https://skills.sh"]),
    })
    .default({
      provider: "auto",
      api_base_url: "https://skills.sh",
      token_env: "VERCEL_OIDC_TOKEN",
      query_limit: 10,
      discovery_origins: ["https://skills.sh"],
      credential_origins: ["https://skills.sh"],
    }),
  security: z
    .object({
      require_audit: z.boolean().default(true),
      allowed_risk_levels: z
        .array(z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]))
        .default(["NONE", "LOW"]),
      trusted_owners: z
        .array(z.string().min(1))
        .default(["anthropics", "expo", "openai", "supabase", "vercel-labs"]),
      relevance_threshold: z.number().min(0.7).max(1).default(0.7),
      minimum_query_coverage: z.number().min(0.5).max(1).default(0.5),
      max_automatic_installs: z.number().int().min(0).max(10).default(5),
    })
    .default({
      require_audit: true,
      allowed_risk_levels: ["NONE", "LOW"],
      trusted_owners: ["anthropics", "expo", "openai", "supabase", "vercel-labs"],
      relevance_threshold: 0.7,
      minimum_query_coverage: 0.5,
      max_automatic_installs: 5,
    }),
  runtime: z
    .object({
      cache_ttl_hours: z.number().int().min(1).max(168).default(24),
      hook_timeout_seconds: z.number().int().min(5).max(60).default(30),
    })
    .default({
      cache_ttl_hours: 24,
      hook_timeout_seconds: 30,
    }),
});

export type BootstrapConfig = z.infer<typeof ConfigSchema>;

const DEFAULTS: BootstrapConfig = ConfigSchema.parse({});

function readYaml(path: string): unknown {
  return existsSync(path) ? parse(readFileSync(path, "utf8")) : {};
}

function mergeSecurityFloor(
  user: BootstrapConfig,
  projectInput: Record<string, unknown>,
): BootstrapConfig {
  const project = ConfigSchema.partial().parse(projectInput);
  const security = project.security;
  const discovery = project.discovery;

  return ConfigSchema.parse({
    ...user,
    ...project,
    discovery: {
      ...user.discovery,
      ...discovery,
      api_base_url: user.discovery.api_base_url,
      token_env: user.discovery.token_env,
      discovery_origins: user.discovery.discovery_origins,
      credential_origins: user.discovery.credential_origins,
      query_limit: Math.min(
        user.discovery.query_limit,
        discovery?.query_limit ?? user.discovery.query_limit,
      ),
    },
    security: {
      ...user.security,
      ...security,
      require_audit: user.security.require_audit || (security?.require_audit ?? false),
      trusted_owners: user.security.trusted_owners.filter((owner) =>
        (security?.trusted_owners ?? user.security.trusted_owners).includes(owner),
      ),
      allowed_risk_levels: user.security.allowed_risk_levels.filter((level) =>
        (security?.allowed_risk_levels ?? user.security.allowed_risk_levels).includes(
          level,
        ),
      ),
      relevance_threshold: Math.max(
        user.security.relevance_threshold,
        security?.relevance_threshold ?? user.security.relevance_threshold,
      ),
      minimum_query_coverage: Math.max(
        user.security.minimum_query_coverage,
        security?.minimum_query_coverage ?? user.security.minimum_query_coverage,
      ),
      max_automatic_installs: Math.min(
        user.security.max_automatic_installs,
        security?.max_automatic_installs ?? user.security.max_automatic_installs,
      ),
    },
  });
}

export function userConfigPath(home = homedir()): string {
  return join(home, ".config", "agent-skill-bootstrap", "config.yaml");
}

export function projectConfigPath(root: string): string {
  return join(root, ".agent-skill-bootstrap", "config.yaml");
}

export function loadConfig(root: string, home = homedir()): BootstrapConfig {
  const userInput = readYaml(userConfigPath(home));
  const user = ConfigSchema.parse({
    ...DEFAULTS,
    ...(userInput as object),
  });
  const projectInput = readYaml(projectConfigPath(root));
  return mergeSecurityFloor(user, (projectInput ?? {}) as Record<string, unknown>);
}

export function withOverrides(
  config: BootstrapConfig,
  overrides: { scope?: Scope; mode?: Mode; agents?: Agent[] },
): BootstrapConfig {
  return ConfigSchema.parse({
    ...config,
    ...overrides,
  });
}

export function parseConfig(input: unknown): BootstrapConfig {
  return ConfigSchema.parse(input);
}
