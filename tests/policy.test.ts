import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { auditAllowed, fallbackAllowed, scoreCandidate } from "../src/policy.js";
import type { DetectionSignal, SkillCandidate } from "../src/types.js";

const config = parseConfig({});
const signal: DetectionSignal = {
  technology: "React",
  confidence: 0.9,
  evidence: ["package:react"],
  query: "react frontend",
  requiredTerms: ["react"],
};

function candidate(id: string, name = id): SkillCandidate {
  const parts = id.split("/");
  return {
    id,
    source: parts.slice(0, -1).join("/"),
    slug: parts.at(-1) ?? "skill",
    name,
    query: signal.query,
    installUrl: `https://github.com/${parts.slice(0, 2).join("/")}`,
  };
}

describe("selection policy", () => {
  it("accepts a relevant skill from a trusted owner", () => {
    const result = scoreCandidate(
      candidate("vercel-labs/skills/react-frontend"),
      signal,
      config,
    );
    expect(result.accepted).toBe(true);
    expect(result.queryCoverage).toBe(1);
  });

  it("rejects keyword stuffing without required query coverage", () => {
    const result = scoreCandidate(
      candidate("random/repo/react-react-react"),
      signal,
      config,
    );
    expect(result.accepted).toBe(false);
  });

  it("enforces audit risk and trusted fallback policy", () => {
    expect(
      auditAllowed(
        [
          {
            provider: "test",
            status: "pass",
            riskLevel: "LOW",
            summary: "safe",
          },
        ],
        config,
      ),
    ).toBe(true);
    expect(
      auditAllowed(
        [
          {
            provider: "test",
            status: "warn",
            riskLevel: "HIGH",
            summary: "risky",
          },
        ],
        config,
      ),
    ).toBe(false);
    expect(fallbackAllowed(candidate("vercel-labs/skills/react"), config)).toBe(true);
    expect(fallbackAllowed(candidate("unknown/repo/react"), config)).toBe(false);
  });
});
