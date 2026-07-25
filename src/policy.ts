import type { BootstrapConfig } from "./config.js";
import type { DetectionSignal, SkillAudit, SkillCandidate } from "./types.js";

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 2),
  );
}

export interface Relevance {
  accepted: boolean;
  score: number;
  requiredMatch: boolean;
  queryCoverage: number;
}

export function scoreCandidate(
  candidate: SkillCandidate,
  signal: DetectionSignal,
  config: BootstrapConfig,
): Relevance {
  const candidateTokens = tokens(
    [
      candidate.id,
      candidate.slug,
      candidate.name,
      candidate.source,
      candidate.description,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const queryTokens = [...tokens(signal.query)];
  const requiredMatch = signal.requiredTerms.some((term) =>
    candidateTokens.has(term.toLowerCase()),
  );
  const queryCoverage =
    queryTokens.length === 0
      ? 0
      : queryTokens.filter((term) => candidateTokens.has(term)).length /
        queryTokens.length;
  const trustedOwner = config.security.trusted_owners.includes(
    candidate.source.split("/")[0] ?? "",
  );
  const score =
    0.35 * signal.confidence +
    0.15 * Number(requiredMatch) +
    0.4 * queryCoverage +
    0.1 * Number(trustedOwner);

  return {
    accepted:
      requiredMatch &&
      queryCoverage >= config.security.minimum_query_coverage &&
      score >= config.security.relevance_threshold &&
      !candidate.isDuplicate,
    score,
    requiredMatch,
    queryCoverage,
  };
}

export function auditAllowed(audits: SkillAudit[], config: BootstrapConfig): boolean {
  if (audits.length === 0) return !config.security.require_audit;
  return (
    audits.every((audit) => audit.status !== "fail") &&
    audits.every(
      (audit) =>
        audit.riskLevel === undefined ||
        config.security.allowed_risk_levels.includes(audit.riskLevel),
    )
  );
}

export function fallbackAllowed(
  candidate: SkillCandidate,
  config: BootstrapConfig,
): boolean {
  const owner = candidate.source.split("/")[0] ?? "";
  return config.security.trusted_owners.includes(owner);
}
