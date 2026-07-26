import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWithinBoundary, safeAtomicWrite } from "../src/fs-safety.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("filesystem safety", () => {
  it("rejects a sibling whose name only shares the boundary prefix", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const boundary = join(fixture.root, "skills");
    const sibling = join(fixture.root, "skills-escape", "file");

    expect(() => assertWithinBoundary(sibling, boundary)).toThrow(
      /escapes its boundary/,
    );
  });

  it("rejects an existing destination symlink", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const boundary = join(fixture.root, "managed");
    const outside = join(fixture.root, "outside");
    mkdirSync(boundary);
    mkdirSync(outside);
    symlinkSync(join(outside, "value"), join(boundary, "value"));

    expect(() => safeAtomicWrite(join(boundary, "value"), "content", boundary)).toThrow(
      /symlinked managed path/,
    );
  });

  it("uses compare-and-swap when an expected value is supplied", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    const boundary = join(fixture.root, "managed");
    const path = join(boundary, "state.json");
    mkdirSync(boundary);
    writeFileSync(path, "newer");

    expect(() =>
      safeAtomicWrite(path, "replacement", boundary, { expected: "older" }),
    ).toThrow(/changed during update/);
  });
});
