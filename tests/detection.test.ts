import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject } from "../src/detection.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("detectProject", () => {
  it("detects a Next.js TypeScript project from manifests", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    writeFileSync(
      join(fixture.root, "package.json"),
      JSON.stringify({
        dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
        devDependencies: { typescript: "5.0.0" },
      }),
    );
    writeFileSync(join(fixture.root, "tsconfig.json"), "{}");

    const detection = detectProject(fixture.root);

    expect(detection.signals.map((signal) => signal.technology)).toEqual(
      expect.arrayContaining(["Next.js", "React", "TypeScript"]),
    );
    expect(detection.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a conservative general signal for an unknown project", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    expect(detectProject(fixture.root).signals).toEqual([
      expect.objectContaining({ technology: "General software project" }),
    ]);
  });

  it("detects package manifests inside a bounded monorepo", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const app = join(fixture.root, "apps", "web");
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
    );

    const detection = detectProject(fixture.root);

    const next = detection.signals.find((signal) => signal.technology === "Next.js");
    expect(next).toBeDefined();
    expect(next?.evidence).toContain("apps/web/package:next");
  });
});
