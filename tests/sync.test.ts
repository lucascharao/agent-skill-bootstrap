import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { SkillsCli } from "../src/discovery.js";
import { syncSkills } from "../src/sync.js";
import type { SkillCandidate } from "../src/types.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

class FakeSkillsCli extends SkillsCli {
  readonly candidate: SkillCandidate = {
    id: "vercel-labs/skills/react-frontend",
    source: "vercel-labs/skills",
    slug: "react-frontend",
    name: "React Frontend",
    query: "react frontend",
    installUrl: "https://github.com/vercel-labs/skills",
  };

  constructor() {
    super("/not-used", process.cwd());
  }

  override search(query: string): Promise<SkillCandidate[]> {
    return Promise.resolve([{ ...this.candidate, query }]);
  }

  override materialize(
    _source: string,
    slug: string,
    destination: string,
  ): Promise<string> {
    const root = join(destination, ".agents", "skills", slug);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "SKILL.md"), "# React Frontend\n");
    return Promise.resolve(root);
  }
}

describe("sync engine", () => {
  it("installs once for every target and then deduplicates", async () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    const config = parseConfig({
      scope: "project",
      agents: ["claude-code", "codex", "grok"],
      discovery: { provider: "cli" },
    });
    const cli = new FakeSkillsCli();
    const options = {
      root: fixture.root,
      scope: "project" as const,
      agents: config.agents,
      config,
      home: fixture.home,
      skillsBinary: "/not-used",
      cli,
      force: true,
    };

    const first = await syncSkills(options);
    const second = await syncSkills(options);

    expect(first.installed).toHaveLength(3);
    expect(second.installed).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
  });

  it("fails closed when strict mode would use unaudited CLI fallback", async () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    const config = parseConfig({
      mode: "strict",
      discovery: { provider: "cli" },
    });

    await expect(
      syncSkills({
        root: fixture.root,
        scope: "project",
        agents: ["codex"],
        config,
        home: fixture.home,
        skillsBinary: "/not-used",
        cli: new FakeSkillsCli(),
        force: true,
      }),
    ).rejects.toThrow(/Strict mode blocks unaudited/);
  });

  it("does not search or install when the stack is unknown", async () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const cli = new FakeSkillsCli();
    let searches = 0;
    cli.search = () => {
      searches += 1;
      return Promise.resolve([]);
    };

    const result = await syncSkills({
      root: fixture.root,
      scope: "project",
      agents: ["codex"],
      config: parseConfig({ discovery: { provider: "cli" } }),
      home: fixture.home,
      skillsBinary: "/not-used",
      cli,
      force: true,
    });

    expect(searches).toBe(0);
    expect(result.installed).toHaveLength(0);
    expect(result.warnings).toContain(
      "No supported project stack was detected; automatic install skipped",
    );
  });
});
