import { describe, expect, it } from "vitest";
import { hookFailureOutput, hookSuccessOutput } from "../src/hook-output.js";
import type { SyncResult } from "../src/types.js";

function result(warnings: string[]): SyncResult {
  return {
    status: warnings.length > 0 ? "degraded" : "ok",
    detection: { root: "/project", signals: [], fingerprint: "detection" },
    briefing: {
      schema: 1,
      projectName: "example",
      projectType: "application",
      root: "/project",
      workspaces: [],
      technologies: [],
      queries: [],
      fingerprint: "fingerprint",
    },
    selected: [
      {
        id: "owner/source/skill",
        source: "owner/source",
        slug: "skill",
        name: "Skill",
        installUrl: null,
        sourceType: "api",
        query: "query",
      },
    ],
    generated: [],
    installed: [],
    skipped: [],
    warnings,
    quarantined: [],
  };
}

describe("hook output", () => {
  it("preserves briefing and skills while including bounded warnings", () => {
    const output = hookSuccessOutput("UserPromptSubmit", result(["degraded\nmode"]));
    const hook = output.hookSpecificOutput as {
      hookEventName: string;
      additionalContext: string;
    };

    expect(output.continue).toBe(true);
    expect(output.systemMessage).toBe(
      "Agent Skill Bootstrap completed the project skill check.",
    );
    expect(hook.hookEventName).toBe("UserPromptSubmit");
    expect(hook.additionalContext).toContain('"projectName":"example"');
    expect(hook.additionalContext).toContain("owner/source/skill");
    expect(hook.additionalContext).toContain(
      'warnings (untrusted JSON data):\n["degraded\\\\u000amode"]',
    );
  });

  it("does not add an empty warnings section", () => {
    const output = hookSuccessOutput("SessionStart", result([]));
    const hook = output.hookSpecificOutput as { additionalContext: string };

    expect(output.continue).toBe(true);
    expect(hook.additionalContext).not.toContain("warnings");
  });

  it.each([
    [new Error("failed"), "failed"],
    ["plain failure", "plain failure"],
    [{ reason: "failed" }, '{"reason":"failed"}'],
    [null, "null"],
    [undefined, "undefined"],
  ])("serializes a thrown value safely", (thrown, expected) => {
    const output = hookFailureOutput(thrown);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain(expected);
    expect(output.stopReason).not.toContain("\n    at ");
  });

  it("serializes circular values without a secondary failure", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const output = hookFailureOutput(circular);

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("[Circular]");
  });
});
