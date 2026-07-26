export const AGENTS = ["claude-code", "codex"] as const;
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

export interface ProjectBriefing {
  schema: 1;
  projectName: string;
  projectType: "application" | "library" | "cli" | "software-project";
  root: string;
  workspaces: string[];
  technologies: Array<{
    name: string;
    confidence: number;
    evidence: string[];
  }>;
  queries: string[];
  fingerprint: string;
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

export interface GeneratedSkill {
  candidate: SkillCandidate;
  signal: DetectionSignal;
}

export interface QuarantinedSkill {
  id: string;
  agent: Agent;
  originalPath: string;
  quarantinePath: string;
  reason: string;
}

export interface SyncResult {
  status: "ok" | "skipped" | "degraded";
  detection: ProjectDetection;
  briefing: ProjectBriefing;
  selected: SkillCandidate[];
  generated: SkillCandidate[];
  installed: InstalledSkill[];
  quarantined: QuarantinedSkill[];
  skipped: Array<{ candidate: SkillCandidate; reason: string }>;
  warnings: string[];
}
