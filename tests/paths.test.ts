import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { briefingPath, codexHome, skillRoot, statePath } from "../src/paths.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("managed paths", () => {
  it("uses CODEX_HOME for global Codex skills", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const previous = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    cleanups.push(() => {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    });
    const custom = join(fixture.home, "codex-home");
    expect(codexHome(fixture.home, custom)).toBe(custom);
    expect(skillRoot("codex", "global", fixture.root, fixture.home)).toBe(
      join(fixture.home, ".codex", "skills"),
    );
  });

  it("rejects a relative CODEX_HOME", () => {
    expect(() => codexHome("/home/example", "relative/codex")).toThrow(
      /must be an absolute path/,
    );
  });

  it("isolates global state and briefing per canonical project", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const second = join(fixture.root, "second");
    mkdirSync(second);
    expect(statePath("global", fixture.root, fixture.home)).not.toBe(
      statePath("global", second, fixture.home),
    );
    expect(briefingPath("global", fixture.root, fixture.home)).not.toBe(
      briefingPath("global", second, fixture.home),
    );
  });
});
