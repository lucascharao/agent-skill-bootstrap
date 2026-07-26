import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectRoot, resolveHookProjectRoot } from "../src/hook-root.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("hook project root resolution", () => {
  it("finds the nearest project root from a nested event cwd", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const nested = join(fixture.root, "src", "feature");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(fixture.root, "package.json"), "{}");

    expect(findProjectRoot(nested)).toBe(fixture.root);
    expect(
      resolveHookProjectRoot(
        "codex",
        "global",
        "/ignored",
        { hook_event_name: "SessionStart", cwd: nested },
        {},
      ),
    ).toBe(fixture.root);
  });

  it("uses CLAUDE_PROJECT_DIR and enforces the configured project boundary", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const nested = join(fixture.root, "src");
    mkdirSync(nested);

    expect(
      resolveHookProjectRoot(
        "claude-code",
        "project",
        fixture.root,
        { hook_event_name: "SessionStart", cwd: "/ignored" },
        { CLAUDE_PROJECT_DIR: nested },
      ),
    ).toBe(fixture.root);
  });

  it("fails closed when event cwd is missing or outside project scope", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const outside = join(fixture.root, "..", `${basename(fixture.root)}-outside`);
    mkdirSync(outside);
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }));

    expect(() =>
      resolveHookProjectRoot(
        "codex",
        "project",
        fixture.root,
        { hook_event_name: "SessionStart" },
        {},
      ),
    ).toThrow(/trusted project cwd/);
    expect(() =>
      resolveHookProjectRoot(
        "codex",
        "project",
        fixture.root,
        { hook_event_name: "SessionStart", cwd: outside },
        {},
      ),
    ).toThrow(/outside the configured project boundary/);
  });
});
