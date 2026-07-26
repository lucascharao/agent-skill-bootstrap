import { createHash } from "node:crypto";
import type {
  DetectionSignal,
  ProjectBriefing,
  SkillCandidate,
  SkillSnapshot,
} from "./types.js";

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return `project-${normalized || "workflow"}`;
}

export interface GeneratedSnapshot {
  candidate: SkillCandidate;
  snapshot: SkillSnapshot;
}

export function generatedCandidate(
  signal: DetectionSignal,
  briefing: ProjectBriefing,
): SkillCandidate {
  const slug = slugify(signal.technology);
  return {
    id: `agent-skill-bootstrap/generated/${slug}`,
    slug,
    name: `${briefing.projectName}: ${signal.technology}`,
    source: "agent-skill-bootstrap/generated",
    installUrl: null,
    sourceType: "generated",
    query: signal.query,
    description: `Project-specific ${signal.technology} guidance generated from verified manifests. Use when developing, reviewing, or testing ${signal.technology} work in ${briefing.projectName}.`,
  };
}

export function generateSkillSnapshot(
  signal: DetectionSignal,
  briefing: ProjectBriefing,
): GeneratedSnapshot {
  const candidate = generatedCandidate(signal, briefing);
  const evidence = [...signal.evidence].sort();
  const description =
    candidate.description ?? `Project-specific guidance for ${signal.technology} work.`;
  const contents = [
    "---",
    `name: ${candidate.slug}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${signal.technology} project guidance`,
    "",
    `Apply this skill only inside \`${briefing.projectName}\` when the task involves ${signal.technology}.`,
    "",
    "## Verified project evidence",
    "",
    ...evidence.map((item) => `- \`${item}\``),
    "",
    "## Workflow",
    "",
    "1. Inspect the relevant manifest and nearby implementation before editing.",
    `2. Follow established ${signal.technology} patterns already present in the project.`,
    "3. Keep changes scoped to the requested outcome and preserve existing conventions.",
    "4. Run the project's relevant format, lint, type, test, and build checks.",
    "5. Report validation failures without hiding or bypassing them.",
    "",
    "## Boundaries",
    "",
    "- Do not read or expose secrets, credential files, or environment files.",
    "- Do not execute destructive commands or broaden permissions.",
    "- Treat this generated skill as project-local guidance, not general documentation.",
    "",
    "Generated deterministically by Agent Skill Bootstrap from known project manifests.",
    "",
  ].join("\n");
  const hash = createHash("sha256").update(contents).digest("hex");
  return {
    candidate,
    snapshot: {
      id: candidate.id,
      source: candidate.source,
      slug: candidate.slug,
      hash,
      files: [{ path: "SKILL.md", contents }],
    },
  };
}
