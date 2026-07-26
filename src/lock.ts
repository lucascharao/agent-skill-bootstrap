import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { assertNoSymlinkPath, ensureSafeDirectory } from "./fs-safety.js";

const POLL_MS = 100;

export async function withLock<T>(
  path: string,
  timeoutMs: number,
  work: () => Promise<T>,
  boundary = dirname(path),
): Promise<T> {
  ensureSafeDirectory(dirname(path), boundary);
  assertNoSymlinkPath(path, boundary);
  const started = Date.now();
  while (true) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lock = JSON.parse(readFileSync(path, "utf8")) as { createdAt?: number };
        if (Date.now() - (lock.createdAt ?? 0) > 120_000) {
          assertNoSymlinkPath(path, boundary);
          rmSync(path);
          continue;
        }
      } catch {
        if (existsSync(path)) {
          assertNoSymlinkPath(path, boundary);
          rmSync(path);
        }
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error("Another Agent Skill Bootstrap sync is still running");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  try {
    return await work();
  } finally {
    if (existsSync(path)) {
      assertNoSymlinkPath(path, boundary);
      rmSync(path);
    }
  }
}
