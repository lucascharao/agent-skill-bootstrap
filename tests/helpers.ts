import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

export function temporaryProject(): {
  root: string;
  home: string;
  cleanup: () => void;
} {
  mkdirSync(join(process.cwd(), "tests"), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), "tests", ".tmp-project-"));
  const home = join(root, "home");
  mkdirSync(home);
  return {
    root,
    home,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
