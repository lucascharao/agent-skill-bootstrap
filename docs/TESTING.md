# Testing Strategy

## Targets

- Minimum 90% statement and branch coverage for core modules.
- 100% branch coverage for deduplication and security policy decisions.
- No test may require the live skills.sh API or mutate real user agent config.

## Unit Tests

- Project root resolution and boundary enforcement.
- Manifest and file signal detection.
- Query generation and deterministic fingerprinting.
- Deterministic project briefing from bounded manifest data.
- Valid instruction-only fallback skill generation.
- API response validation and error mapping.
- CLI search output parsing and ANSI removal.
- Stable ID normalization.
- Name-only legacy collisions never deduplicate.
- Global-before-project deduplication per target agent.
- Desired-minus-existing agent binding calculation.
- Detection matrix, relevance threshold, and deterministic tie-breaking.
- Exact relevance weights, required-term gate, optional metadata behavior, and
  max-score selection across workspaces.
- Minimum query coverage and negative corpus for repeated-keyword stuffing.
- Recommendation reasons tied to concrete project evidence.
- Audit and trusted-owner policy.
- Hook config merge and idempotency.
- Managed ownership, quarantine planning, and restoration.
- YAML configuration precedence and validation.
- Cross-platform path generation.

## Integration Tests

- Sync with a fake skills.sh HTTP server.
- Snapshot staging, internal digest, installed-copy verification, and rollback.
- Catalog hash persistence and content drift detection.
- Fallback to a fake official skills executable after API 401.
- Project install with an empty inventory.
- Project sync when the candidate already exists globally.
- Global candidate present for Claude while Codex remains missing.
- Repeated sync performs zero additional installation.
- Empty relevant catalog generates a project-local fallback.
- Stack change quarantines an obsolete managed fallback.
- Concurrent hook invocations share one lock.
- Strict concurrent startup waits up to 120 seconds, then reruns sync under the
  lock and may consume the persisted cache.
- Native concurrent startup waits up to 2 seconds, then stops preparation with
  a fail-closed timeout error.
- Locks older than 120 seconds and invalid lock metadata are recovered; the
  recorded PID is diagnostic and is not used as a liveness probe.
- Existing Claude and Codex hooks remain unchanged.
- Partial installation failure persists only successful entries.

## End-to-End Tests

- Pack the npm tarball and run it through `npx` in an isolated temporary home.
- Initialize project scope and verify generated config and hooks.
- Initialize global scope using a temporary platform config directory.
- Exercise interactive global/project selection and non-interactive equivalents.
- Verify the pinned persistent runtime works with registry network disabled.
- Run `scan`, `sync --dry-run`, `doctor`, and `uninstall`.
- Verify `--json` output contains no ANSI escape codes.
- Execute hook fixtures for both supported hosts and both lifecycle events;
  verify sync precedes the first permitted development action and that
  `additionalContext` contains deterministic briefing data and every required
  managed skill ID.
- Exercise strict `run` mode and verify the vendor process is not spawned until
  sync succeeds.
- Exercise hook timeout and assert `continue: false` with no false ready state.
- Cover ambiguous stacks, monorepos, false positives, and unknown projects.
- Cover API fallback without a token, expired cache, and complete offline mode.
- Verify uninstall removes only bootstrap-owned hook entries and runtimes.
- Verify backup and rollback after partially invalid vendor configuration.
- Verify supported minimum Node.js and pinned official skills CLI versions.
- Verify hooks execute the runtime-local `skills@1.5.19` binary and never
  invoke `npx` or resolve `@latest`.
- Lock approved, rejected, and tie-scored candidates as contract fixtures.
- Verify first-session context and skill visibility independently for Claude
  Code and Codex on macOS, Linux, and Windows fixtures.
- Verify disabled and untrusted hooks do not produce a false loaded state.
- Verify exact capability probing disables an incompatible fallback CLI.
- Verify strict mode blocks unaudited fallback installation.
- Verify project config cannot weaken the user security floor.
- Verify OIDC is never sent to project-controlled or redirected origins.
- Verify an alternate API origin cannot provide installable search, audit, or
  snapshot data until the exact origin is user-allowlisted, even without a
  credential.
- Verify endpoint segment encoding, response limits, schemas, retry clamps, and
  total request budget.
- Verify launchers recover from moved projects, nvm/asdf PATH changes, missing
  Node, and unsupported Node without starting agent work.
- Verify Codex matches its own documented `SessionStart` start sources and
  resolves a validated hook `cwd` when `git rev-parse` has no repository.
- Verify automatic maintenance never permanently deletes a skill.
- Verify unmanaged skills and links remain byte-for-byte unchanged.
- Verify restore preserves the quarantined skill contents and binding.

## Security Tests

- Reject path traversal and absolute paths from external metadata.
- Reject command-like values beginning with `-` and extreme metadata sizes.
- Reject symlinked vendor configs, symlinked staging paths, duplicate normalized
  paths, and digest mismatch after installation.
- Redact absent, invalid, and expired token values from errors and diagnostics.
- Cover HTTP 429, 503, cache fallback, and fail-closed preparation errors.
- Reject malformed API data.
- Reject failed, high-risk, or critical-risk audit results.
- Reject unaudited skills from untrusted owners by default.
- Ensure tokens never appear in state, logs, or thrown error messages.
- Ensure all child processes are spawned without a shell.
- Ensure `.env`, credentials, arbitrary source, and prompt history never enter
  briefing or generated skill content.

## Quality Gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm pack --dry-run
```
