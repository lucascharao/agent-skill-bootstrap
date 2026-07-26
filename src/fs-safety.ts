import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function isWithinBoundary(path: string, boundary: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBoundary = resolve(boundary);
  const relation = relative(resolvedBoundary, resolvedPath);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function assertWithinBoundary(path: string, boundary: string): void {
  if (!isWithinBoundary(path, boundary)) {
    throw new Error(`Managed path escapes its boundary: ${path}`);
  }
}

export function assertNoSymlinkPath(path: string, boundary = path): void {
  let current = resolve(path);
  const resolvedBoundary = resolve(boundary);
  assertWithinBoundary(current, resolvedBoundary);
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing symlinked managed path: ${current}`);
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (current === resolvedBoundary) return;
    current = dirname(current);
  }
}

export function ensureSafeDirectory(path: string, boundary: string): void {
  assertWithinBoundary(path, boundary);
  assertNoSymlinkPath(path, boundary);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertWithinBoundary(path, boundary);
  assertNoSymlinkPath(path, boundary);
}

export function safeAtomicWrite(
  path: string,
  contents: string,
  boundary: string,
  options: { mode?: number; expected?: string | null } = {},
): void {
  assertWithinBoundary(path, boundary);
  ensureSafeDirectory(dirname(path), boundary);
  assertNoSymlinkPath(path, boundary);

  const expected =
    options.expected === undefined
      ? existsSync(path)
        ? readFileSync(path, "utf8")
        : null
      : options.expected;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  assertWithinBoundary(temporary, boundary);
  writeFileSync(temporary, contents, { mode: options.mode ?? 0o600 });

  try {
    assertNoSymlinkPath(path, boundary);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current !== expected) {
      throw new Error(`Managed file changed during update: ${path}`);
    }
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}
