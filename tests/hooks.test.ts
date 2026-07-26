import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { hookPath, installHooks, MARKER, removeOwnedHook } from "../src/hooks.js";
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
    };

    installHooks(
      ["claude-code"],
      "project",
      fixture.root,
      runtime,
      parseConfig({}),
      fixture.home,
    );
    installHooks(
      ["claude-code"],
      "project",
      fixture.root,
      runtime,
      parseConfig({}),
      fixture.home,
    );
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { SessionStart: unknown[]; UserPromptSubmit: unknown[] };
    };

    expect(value.hooks.SessionStart).toHaveLength(2);
    expect(value.hooks.UserPromptSubmit).toHaveLength(1);
    expect(JSON.stringify(value)).toContain("existing");
    expect(JSON.stringify(value)).toContain("agent-skill-bootstrap:owned");
  });

  it("installs both lifecycle events at user scope without touching project config", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const runtime: RuntimeInstall = {
      root: "/runtime",
      cli: "/runtime/cli.js",
      skillsBinary: "/runtime/skills.mjs",
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
        hooks: { SessionStart: unknown[]; UserPromptSubmit: unknown[] };
      };
      expect(value.hooks.SessionStart).toHaveLength(1);
      expect(value.hooks.UserPromptSubmit).toHaveLength(1);
    }
  });

  it("removes only hooks carrying the shared ownership marker", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const path = hookPath("codex", "project", fixture.root, fixture.home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ command: `owned --owner ${MARKER}` }] },
            { hooks: [{ command: "user-hook" }] },
          ],
          UserPromptSubmit: [{ hooks: [{ command: `owned --owner ${MARKER}` }] }],
        },
      }),
    );

    expect(removeOwnedHook(path)).toBe(true);
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { SessionStart: unknown[]; UserPromptSubmit: unknown[] };
    };
    expect(value.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(value)).toContain("user-hook");
    expect(value.hooks.UserPromptSubmit).toHaveLength(0);
    expect(JSON.stringify(value)).not.toContain(MARKER);
    expect(removeOwnedHook(path)).toBe(false);
  });
});
