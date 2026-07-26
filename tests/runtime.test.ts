import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSkillsBinary,
  installRuntime,
  nodeSupported,
  platformSupported,
  runtimeHealthy,
  SKILLS_VERSION,
} from "../src/runtime.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("persistent runtime", () => {
  it.each([
    ["22.19.0", false],
    ["22.20.0", true],
    ["24.0.0", true],
  ])("checks the supported Node floor for %s", (version, supported) => {
    expect(nodeSupported(version)).toBe(supported);
  });

  it("supports only the declared operating systems", () => {
    expect(platformSupported("darwin")).toBe(true);
    expect(platformSupported("linux")).toBe(true);
    expect(platformSupported("win32")).toBe(false);
  });

  it("finds the exact packaged skills binary", () => {
    expect(findSkillsBinary()).toMatch(/skills[/\\]bin[/\\]cli\.mjs$/);
  });

  it("validates the pinned dependency and absolute Node runtime", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const root = join(fixture.root, "runtime");
    const cli = join(root, "cli.js");
    const skillsBinary = join(root, "node_modules", "skills", "bin", "cli.mjs");
    mkdirSync(join(root, "node_modules", "skills", "bin"), { recursive: true });
    writeFileSync(cli, "#!/usr/bin/env node\n");
    writeFileSync(skillsBinary, "#!/usr/bin/env node\n");
    writeFileSync(
      join(root, "node_modules", "skills", "package.json"),
      JSON.stringify({ version: SKILLS_VERSION }),
    );

    expect(runtimeHealthy({ root, cli, skillsBinary, node: process.execPath })).toBe(
      true,
    );
    expect(
      runtimeHealthy({ root, cli, skillsBinary, node: join(root, "missing-node") }),
    ).toBe(false);
  });

  it("refuses to install an unbuilt TypeScript runtime", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);

    expect(() => installRuntime("project", fixture.root, fixture.home)).toThrow(
      /Build the project/,
    );
  });
});
