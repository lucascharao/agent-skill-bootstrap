import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  it("recognizes the global copy layout produced by skills@1.5.19", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const root = join(fixture.home, ".agents", "skills", "frontend-design");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "# Existing frontend skill\n");
    writeFileSync(
      join(fixture.home, ".agents", ".skill-lock.json"),
      readFileSync(
        join(process.cwd(), "tests", "fixtures", "skills-1.5.19-global-lock.json"),
        "utf8",
      ),
    );

    expect(
      alreadyInstalled(
        "anthropics/skills/frontend-design",
        "codex",
        "project",
        fixture.root,
        fixture.home,
      ),
    ).toEqual(
      expect.objectContaining({
        id: "anthropics/skills/frontend-design",
        scope: "global",
        path: root,
      }),
    );
  });

  it("recognizes an official global symlink only when it targets the canonical copy", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const canonical = join(fixture.home, ".agents", "skills", "frontend-design");
    const binding = join(fixture.home, ".claude", "skills", "frontend-design");
    mkdirSync(canonical, { recursive: true });
    mkdirSync(join(fixture.home, ".claude", "skills"), { recursive: true });
    writeFileSync(join(canonical, "SKILL.md"), "# Existing frontend skill\n");
    symlinkSync(canonical, binding);
    writeFileSync(
      join(fixture.home, ".agents", ".skill-lock.json"),
      readFileSync(
        join(process.cwd(), "tests", "fixtures", "skills-1.5.19-global-lock.json"),
        "utf8",
      ),
    );

    expect(
      alreadyInstalled(
        "anthropics/skills/frontend-design",
        "claude-code",
        "project",
        fixture.root,
        fixture.home,
      ),
    ).toEqual(expect.objectContaining({ scope: "global", path: binding }));
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

  it("rejects a symlinked skill root before writing outside the project", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const outside = join(fixture.root, "outside");
    mkdirSync(join(fixture.root, ".agents"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(fixture.root, ".agents", "skills"));

    expect(() =>
      installSnapshot(
        snapshot,
        candidate,
        "codex",
        "project",
        fixture.root,
        fixture.home,
      ),
    ).toThrow(/symlinked managed path/);
    expect(existsSync(join(outside, candidate.slug))).toBe(false);
  });

  it("rejects a symlinked project boundary", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const actual = join(fixture.root, "actual");
    const linked = join(fixture.root, "linked");
    mkdirSync(actual);
    symlinkSync(actual, linked);

    expect(() =>
      installSnapshot(snapshot, candidate, "codex", "project", linked, fixture.home),
    ).toThrow(/symlinked managed path/);
  });
});
