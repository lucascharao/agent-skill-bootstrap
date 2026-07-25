import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSnapshot } from "../src/install.js";
import { alreadyInstalled, inventory } from "../src/inventory.js";
import type { SkillCandidate, SkillSnapshot } from "../src/types.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const candidate: SkillCandidate = {
  id: "vercel-labs/skills/react",
  source: "vercel-labs/skills",
  slug: "react",
  name: "React",
  installUrl: "https://github.com/vercel-labs/skills",
  query: "react",
};
const snapshot: SkillSnapshot = {
  id: candidate.id,
  source: candidate.source,
  slug: candidate.slug,
  hash: "catalog-hash",
  files: [{ path: "SKILL.md", contents: "# React\n" }],
};

describe("skill installation and inventory", () => {
  it("materializes an API snapshot and inventories it", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const installed = installSnapshot(
      snapshot,
      candidate,
      "codex",
      "project",
      fixture.root,
      fixture.home,
    );
    expect(existsSync(join(installed.path, "SKILL.md"))).toBe(true);
    expect(inventory("project", fixture.root, fixture.home)).toEqual([
      expect.objectContaining({ id: candidate.id, agent: "codex" }),
    ]);
  });

  it("checks the global inventory before project scope", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    installSnapshot(
      snapshot,
      candidate,
      "claude-code",
      "global",
      fixture.root,
      fixture.home,
    );
    expect(
      alreadyInstalled(
        candidate.id,
        "claude-code",
        "project",
        fixture.root,
        fixture.home,
      )?.scope,
    ).toBe("global");
  });

  it("recognizes skills installed previously by the official CLI", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const root = join(fixture.home, ".agents", "skills", candidate.slug);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "# Existing React skill\n");
    writeFileSync(
      join(fixture.home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          [candidate.slug]: {
            source: candidate.source,
            skillFolderHash: "existing-hash",
          },
        },
      }),
    );

    expect(
      alreadyInstalled(candidate.id, "codex", "project", fixture.root, fixture.home),
    ).toEqual(
      expect.objectContaining({
        id: candidate.id,
        hash: "existing-hash",
        scope: "global",
      }),
    );
  });

  it("rejects path traversal in API snapshots", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    mkdirSync(join(fixture.root, ".agents"), { recursive: true });
    expect(() =>
      installSnapshot(
        {
          ...snapshot,
          files: [...(snapshot.files ?? []), { path: "../escape", contents: "x" }],
        },
        candidate,
        "codex",
        "project",
        fixture.root,
        fixture.home,
      ),
    ).toThrow(/Unsafe skill file path/);
    expect(existsSync(join(fixture.root, ".agents", "escape"))).toBe(false);
  });
});
