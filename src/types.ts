export const AGENTS = ["claude-code", "codex", "grok"] as const;
export type Agent = (typeof AGENTS)[number];
export type Scope = "global" | "project";
export type Mode = "native" | "strict";

export interface DetectionSignal {
  technology: string;
  confidence: number;
  evidence: string[];
  query: string;
  requiredTerms: string[];
}

export interface ProjectDetection {
  root: string;
  fingerprint: string;
  signals: DetectionSignal[];
}

export interface SkillCandidate {
  id: string;
  slug: string;
  name: string;
  source: string;
  installUrl: string | null;
  description?: string | undefined;
  query: string;
  sourceType?: string | undefined;
  isDuplicate?: boolean | undefined;
}

export interface SkillFile {
  path: string;
  contents: string;
}

export interface SkillSnapshot {
  id: string;
  source: string;
  slug: string;
  hash: string | null;
  files: SkillFile[] | null;
}

export interface SkillAudit {
  provider: string;
  status: "pass" | "warn" | "fail";
  riskLevel?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined;
  summary: string;
}

export interface InstalledSkill {
  id: string;
  slug: string;
  source: string;
  hash: string | null;
  agent: Agent;
  scope: Scope;
  path: string;
}

export interface SyncResult {
  status: "ok" | "skipped" | "degraded";
  detection: ProjectDetection;
  selected: SkillCandidate[];
  installed: InstalledSkill[];
  skipped: Array<{ candidate: SkillCandidate; reason: string }>;
  warnings: string[];
}
