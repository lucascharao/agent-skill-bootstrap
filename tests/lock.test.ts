import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withLock } from "../src/lock.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function lockFixture(): string {
  const fixture = temporaryProject();
  cleanups.push(fixture.cleanup);
  const path = join(fixture.root, ".agent-skill-bootstrap", "sync.lock");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

describe("project synchronization lock", () => {
  it("fails closed when an active lock exceeds the caller timeout", async () => {
    const path = lockFixture();
    writeFileSync(path, JSON.stringify({ pid: 42, createdAt: Date.now() }));

    await expect(
      withLock(path, 0, () => Promise.resolve("unexpected")),
    ).rejects.toThrow(/still running/);
    expect(existsSync(path)).toBe(true);
  });

  it("recovers a lock that is stale by age", async () => {
    const path = lockFixture();
    writeFileSync(path, JSON.stringify({ pid: 42, createdAt: 0 }));

    await expect(withLock(path, 0, () => Promise.resolve("completed"))).resolves.toBe(
      "completed",
    );
    expect(existsSync(path)).toBe(false);
  });

  it("recovers invalid lock metadata", async () => {
    const path = lockFixture();
    writeFileSync(path, "not-json");

    await expect(withLock(path, 0, () => Promise.resolve("completed"))).resolves.toBe(
      "completed",
    );
    expect(existsSync(path)).toBe(false);
  });
});
