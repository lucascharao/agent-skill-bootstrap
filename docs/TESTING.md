# Testing Strategy

## Targets

- Minimum 90% statement and branch coverage for core modules.
- 100% branch coverage for deduplication and security policy decisions.
- No test may require the live skills.sh API or mutate real user agent config.

## Unit Tests

- Project root resolution and boundary enforcement.
- Manifest and file signal detection.
- Query generation and deterministic fingerprinting.
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
- YAML configuration precedence and validation.
- Cross-platform path generation.

## Integration Tests

- Sync with a fake skills.sh HTTP server.
- Snapshot staging, internal digest, installed-copy verification, and rollback.
- Catalog hash persistence and content drift detection.
- Fallback to a fake official skills executable after API 401.
- Project install with an empty inventory.
- Project sync when the candidate already exists globally.
- Global candidate present for Claude only while Codex and Grok remain missing.
- Repeated sync performs zero additional installation.
- Concurrent hook invocations share one lock.
- Strict concurrent startup waits and consumes the first sync result.
- Native concurrent startup times out to an explicit in-progress state.
- Stale lock recovery after a crashed owner process.
- Existing Claude, Codex, and Grok hooks remain unchanged.
- Partial installation failure persists only successful entries.

## End-to-End Tests

- Pack the npm tarball and run it through `npx` in an isolated temporary home.
- Initialize project scope and verify generated config and hooks.
- Initialize global scope using a temporary platform config directory.
- Exercise interactive global/project selection and non-interactive equivalents.
- Verify the pinned persistent runtime works with registry network disabled.
- Run `scan`, `sync --dry-run`, `doctor`, and `uninstall`.
- Verify `--json` output contains no ANSI escape codes.
- Execute hook fixtures for all three hosts and verify sync precedes the first
  permitted development action.
- Exercise strict `run` mode and verify the vendor process is not spawned until
  sync succeeds.
- Exercise hook timeout, fail-open output, and restart-required output without a
  false loaded/success state.
- Cover ambiguous stacks, monorepos, false positives, and unknown projects.
- Cover API fallback without a token, expired cache, and complete offline mode.
- Verify uninstall removes only bootstrap-owned hook entries and runtimes.
- Verify backup and rollback after partially invalid vendor configuration.
- Verify supported minimum Node.js and pinned official skills CLI versions.
- Verify hooks execute the runtime-local `skills@1.5.19` binary and never
  invoke `npx` or resolve `@latest`.
- Lock approved, rejected, and tie-scored candidates as contract fixtures.
- Verify first-session visibility and restart-required behavior independently
  for Claude Code, Codex, and Grok Build on macOS, Linux, and Windows fixtures.
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

## Security Tests

- Reject path traversal and absolute paths from external metadata.
- Reject command-like values beginning with `-` and extreme metadata sizes.
- Reject symlinked vendor configs, symlinked staging paths, duplicate normalized
  paths, and digest mismatch after installation.
- Redact absent, invalid, and expired token values from errors and diagnostics.
- Cover HTTP 429, 503, cache fallback, native fail-open offline operation, and
  strict fail-closed offline operation.
- Reject malformed API data.
- Reject failed, high-risk, or critical-risk audit results.
- Reject unaudited skills from untrusted owners by default.
- Ensure tokens never appear in state, logs, or thrown error messages.
- Ensure all child processes are spawned without a shell.

## Quality Gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm pack --dry-run
```
