import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBriefing } from "../src/briefing.js";
import { detectProject } from "../src/detection.js";
import { generateSkillSnapshot } from "../src/generate.js";
import { installSnapshot } from "../src/install.js";
import {
  analyzeManagedSkills,
  quarantineManagedSkills,
  restoreQuarantined,
} from "../src/maintenance.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("managed skill maintenance", () => {
  it("quarantines and restores only package-owned project skills", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    const detection = detectProject(fixture.root);
    const signal = detection.signals.find((item) => item.technology === "React")!;
    const generated = generateSkillSnapshot(
      signal,
      createBriefing(fixture.root, detection),
    );
    const installed = installSnapshot(
      generated.snapshot,
      generated.candidate,
      "codex",
      "project",
      fixture.root,
      fixture.home,
    );
    const unmanaged = join(fixture.root, ".agents", "skills", "manual-skill");
    mkdirSync(unmanaged, { recursive: true });
    writeFileSync(join(unmanaged, "SKILL.md"), "# Manual\n");

    const required = new Map([["codex" as const, new Set<string>()]]);
    const preview = quarantineManagedSkills(fixture.root, required, {
      dryRun: true,
      home: fixture.home,
    });
    expect(preview.quarantined).toHaveLength(1);
    expect(existsSync(installed.path)).toBe(true);

    const result = quarantineManagedSkills(fixture.root, required, {
      home: fixture.home,
    });
    expect(result.quarantined).toHaveLength(1);
    expect(existsSync(installed.path)).toBe(false);
    expect(existsSync(join(unmanaged, "SKILL.md"))).toBe(true);

    restoreQuarantined(fixture.root, generated.candidate.id);
    expect(existsSync(join(installed.path, "SKILL.md"))).toBe(true);
    expect(
      existsSync(join(installed.path, ".agent-skill-bootstrap-quarantine.json")),
    ).toBe(false);
    expect(
      analyzeManagedSkills(fixture.root, required, fixture.home).unmanaged,
    ).toHaveLength(1);
  });
});
