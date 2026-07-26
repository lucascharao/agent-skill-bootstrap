import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import {
  hookPath,
  installHooks,
  ownershipMarker,
  removeOwnedHook,
} from "../src/hooks.js";
import type { RuntimeInstall } from "../src/runtime.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("hook installation", () => {
  it("preserves existing hooks and adds one owned SessionStart entry", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const path = hookPath("claude-code", "project", fixture.root, fixture.home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: "startup", hooks: [{ command: "existing" }] }],
        },
      }),
    );
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
      node: "/absolute/node",
    };

    installHooks(
      ["claude-code"],
      "project",
      fixture.root,
      runtime,
      parseConfig({}),
      fixture.home,
    );
    const unchanged = installHooks(
      ["claude-code"],
      "project",
      fixture.root,
      runtime,
      parseConfig({}),
      fixture.home,
    );
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { SessionStart: unknown[]; UserPromptSubmit?: unknown[] };
    };

    expect(value.hooks.SessionStart).toHaveLength(2);
    expect(value.hooks.UserPromptSubmit).toBeUndefined();
    expect(JSON.stringify(value)).toContain("existing");
    expect(JSON.stringify(value)).toContain(ownershipMarker("project", "claude-code"));
    expect(JSON.stringify(value)).toContain("'/absolute/node'");
    expect(unchanged).toEqual([]);
  });

  it("installs only SessionStart at user scope and respects CODEX_HOME", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(fixture.home, "custom-codex");
    cleanups.push(() => {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    });
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
      node: "/absolute/node",
    };

    const changed = installHooks(
      ["claude-code", "codex"],
      "global",
      fixture.root,
      runtime,
      parseConfig({ scope: "global" }),
      fixture.home,
    );

    expect(changed).toHaveLength(2);
    for (const agent of ["claude-code", "codex"] as const) {
      const path = hookPath(agent, "global", fixture.root, fixture.home);
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        hooks: { SessionStart: unknown[]; UserPromptSubmit?: unknown[] };
      };
      expect(value.hooks.SessionStart).toHaveLength(1);
      expect(value.hooks.UserPromptSubmit).toBeUndefined();
    }
    expect(hookPath("codex", "global", fixture.root, fixture.home)).toBe(
      join(fixture.home, "custom-codex", "hooks.json"),
    );
  });

  it("removes only hooks carrying the exact structured ownership marker", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const path = hookPath("codex", "project", fixture.root, fixture.home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `owned --owner '${ownershipMarker("project", "codex")}'`,
                },
              ],
            },
            {
              hooks: [
                {
                  command: `third-party mentions ${ownershipMarker("project", "codex")}`,
                },
              ],
            },
            { hooks: [{ command: "user-hook" }] },
          ],
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: `legacy-owned --owner '${ownershipMarker("project", "codex")}'`,
                },
              ],
            },
          ],
        },
      }),
    );

    expect(removeOwnedHook(path, "codex", "project", fixture.root, fixture.home)).toBe(
      true,
    );
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { SessionStart: unknown[]; UserPromptSubmit: unknown[] };
    };
    expect(value.hooks.SessionStart).toHaveLength(2);
    expect(JSON.stringify(value)).toContain("user-hook");
    expect(JSON.stringify(value)).toContain("third-party mentions");
    expect(value.hooks.UserPromptSubmit).toHaveLength(0);
    expect(removeOwnedHook(path, "codex", "project", fixture.root, fixture.home)).toBe(
      false,
    );
  });

  it("refuses a symlinked hook configuration parent", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const outside = join(fixture.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(fixture.root, ".codex"));
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
      node: "/absolute/node",
    };

    expect(() =>
      installHooks(
        ["codex"],
        "project",
        fixture.root,
        runtime,
        parseConfig({}),
        fixture.home,
      ),
    ).toThrow(/symlinked managed path/);
  });

  it("rejects an invalid array-shaped hooks value without changing it", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const path = hookPath("codex", "project", fixture.root, fixture.home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hooks: ["invalid"] }));
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
      node: "/absolute/node",
    };

    expect(() =>
      installHooks(
        ["codex"],
        "project",
        fixture.root,
        runtime,
        parseConfig({}),
        fixture.home,
      ),
    ).toThrow(/invalid hooks/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hooks: ["invalid"] });
  });

  it("rejects invalid SessionStart entries without changing them", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const path = hookPath("claude-code", "project", fixture.root, fixture.home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ hooks: { SessionStart: "invalid" } }));
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
      node: "/absolute/node",
    };

    expect(() =>
      installHooks(
        ["claude-code"],
        "project",
        fixture.root,
        runtime,
        parseConfig({}),
        fixture.home,
      ),
    ).toThrow(/invalid SessionStart/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      hooks: { SessionStart: "invalid" },
    });
  });
});
