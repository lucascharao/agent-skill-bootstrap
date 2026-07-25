import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { hookPath, installHooks } from "../src/hooks.js";
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
      hooks: { SessionStart: unknown[] };
    };

    expect(value.hooks.SessionStart).toHaveLength(2);
    expect(JSON.stringify(value)).toContain("existing");
    expect(JSON.stringify(value)).toContain("agent-skill-bootstrap:owned");
  });
});
