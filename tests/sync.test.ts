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
      agents: ["claude-code", "codex"],
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

    expect(first.installed).toHaveLength(2);
    expect(second.installed).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
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
    expect(result.generated).toHaveLength(0);
    expect(result.warnings).toContain(
      "No supported project stack was detected; automatic install skipped",
    );
  });

  it("generates a project-local fallback when the catalog has no relevant skill", async () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    const cli = new FakeSkillsCli();
    cli.search = () => Promise.resolve([]);

    const result = await syncSkills({
      root: fixture.root,
      scope: "global",
      agents: ["codex"],
      config: parseConfig({
        scope: "global",
        discovery: { provider: "cli" },
      }),
      home: fixture.home,
      skillsBinary: "/not-used",
      cli,
      force: true,
      maintain: true,
    });

    expect(result.generated.map((item) => item.id)).toContain(
      "agent-skill-bootstrap/generated/project-react",
    );
    expect(result.installed.some((item) => item.scope === "project")).toBe(true);
    expect(result.installed.every((item) => item.path.startsWith(fixture.root))).toBe(
      true,
    );
  });

  it("automatically quarantines an obsolete managed fallback after a stack change", async () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const manifest = join(fixture.root, "package.json");
    const cli = new FakeSkillsCli();
    cli.search = () => Promise.resolve([]);
    const config = parseConfig({
      scope: "project",
      discovery: { provider: "cli" },
    });
    const options = {
      root: fixture.root,
      scope: "project" as const,
      agents: ["codex" as const],
      config,
      home: fixture.home,
      skillsBinary: "/not-used",
      cli,
      force: true,
      maintain: true,
    };

    writeFileSync(manifest, JSON.stringify({ dependencies: { react: "19.0.0" } }));
    await syncSkills(options);
    writeFileSync(manifest, JSON.stringify({ dependencies: { vue: "3.0.0" } }));
    const changed = await syncSkills(options);

    expect(changed.generated.map((item) => item.id)).toContain(
      "agent-skill-bootstrap/generated/project-vue",
    );
    expect(changed.quarantined.map((item) => item.id)).toContain(
      "agent-skill-bootstrap/generated/project-react",
    );
  });
});
