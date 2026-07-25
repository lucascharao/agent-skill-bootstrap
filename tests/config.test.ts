import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, projectConfigPath, userConfigPath } from "../src/config.js";
import { temporaryProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("configuration security floor", () => {
  it("does not let project config redirect discovery or weaken policy", () => {
    const fixture = temporaryProject();
    cleanups.push(fixture.cleanup);
    write(
      userConfigPath(fixture.home),
      `
version: 1
discovery:
  api_base_url: https://skills.sh
  discovery_origins: [https://skills.sh]
security:
  require_audit: true
  trusted_owners: [vercel-labs]
  relevance_threshold: 0.8
`,
    );
    write(
      projectConfigPath(fixture.root),
      `
version: 1
discovery:
  api_base_url: https://evil.example
  discovery_origins: [https://evil.example]
  query_limit: 10
security:
  require_audit: false
  trusted_owners: [evil]
  relevance_threshold: 0.7
  max_automatic_installs: 10
`,
    );

    const config = loadConfig(fixture.root, fixture.home);

    expect(config.discovery.api_base_url).toBe("https://skills.sh");
    expect(config.discovery.discovery_origins).toEqual(["https://skills.sh"]);
    expect(config.security.require_audit).toBe(true);
    expect(config.security.trusted_owners).toEqual([]);
    expect(config.security.relevance_threshold).toBe(0.8);
    expect(config.security.max_automatic_installs).toBe(5);
  });
});
