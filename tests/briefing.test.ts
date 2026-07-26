import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBriefing } from "../src/briefing.js";
import { detectProject } from "../src/detection.js";
import { generateSkillSnapshot } from "../src/generate.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("project briefing and generated skills", () => {
  it("creates a deterministic briefing from bounded manifest data", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({
        name: "example-cli",
        bin: { example: "dist/cli.js" },
        workspaces: ["packages/*", "apps/*"],
        dependencies: { react: "19.0.0" },
      }),
    );
    writeFileSync(join(fixture.root, ".env"), "API_SECRET=must-not-appear\n");

    const detection = detectProject(fixture.root);
    const first = createBriefing(fixture.root, detection);
    const second = createBriefing(fixture.root, detection);

    expect(first).toEqual(second);
    expect(first.projectName).toBe("example-cli");
    expect(first.projectType).toBe("cli");
    expect(first.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(JSON.stringify(first)).not.toContain("must-not-appear");
  });

  it("generates a valid, deterministic, instruction-only project skill", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    const detection = detectProject(fixture.root);
    const briefing = createBriefing(fixture.root, detection);
    const signal = detection.signals.find((item) => item.technology === "React");
    expect(signal).toBeDefined();

    const first = generateSkillSnapshot(signal!, briefing);
    const second = generateSkillSnapshot(signal!, briefing);
    const skill = first.snapshot.files?.[0]?.contents ?? "";

    expect(first).toEqual(second);
    expect(first.candidate.id).toBe("agent-skill-bootstrap/generated/project-react");
    expect(skill).toMatch(/^---\nname: project-react\ndescription: ".+"\n---\n/);
    expect(skill).toContain("package:react");
    expect(skill).not.toMatch(/\b(rm -rf|sudo|curl .*\|)\b/i);
    expect(first.snapshot.files).toHaveLength(1);
  });
});
