# Testing Strategy

## Enforced thresholds

The Vitest runner and CI enforce exactly:

- Lines: 80%
- Functions: 85%
- Statements: 80%
- Branches: 55%

Coverage is a minimum gate, not a quality claim. Security-critical behavior is
also covered by explicit regression and package smoke tests.

## Regression coverage

The suite covers:

- Project detection and deterministic briefing generation
- Manifest sanitization and instruction-only fallback generation
- skills.sh API schemas, credential routing, redirects, audit policy, and limits
- Official CLI search parsing without mutable automatic materialization
- `CODEX_HOME` and Codex fallback paths
- Global-before-project inventory decisions
- Ownership-manifest and content-digest validation
- Cache hit plus invalidation after removal or content alteration
- Root, parent, destination, and content symlink rejection
- Path-sibling prefix escape rejection
- Exact structured hook ownership
- Preservation of third-party hooks containing similar text
- Hook JSON compare-and-swap and atomic replacement primitives
- Event `cwd`, Claude project environment, and project-boundary resolution
- Recoverable quarantine and restoration of owned skills
- Lock timeout and stale-lock behavior
- Fail-closed hook output with sanitized warnings

Tests use isolated temporary projects and homes. Unit and integration tests do
not require live skills.sh services or write real agent configuration.

## Package smoke

`npm run smoke:package`:

1. Packs the real npm tarball
2. Installs it into a clean temporary prefix
3. Verifies the packaged CLI version
4. Creates isolated project and home directories
5. Exercises Claude Code project scope
6. Exercises Claude Code current-user scope
7. Exercises Codex project scope
8. Exercises Codex current-user scope with custom `CODEX_HOME`
9. Runs the copied persistent runtime with a `SessionStart` event
10. Verifies briefing/context creation and successful safe sync
11. Runs uninstall and confirms the owned runtime is removed

The smoke uses an unknown-stack fixture so it proves the lifecycle without
depending on live catalog availability. Catalog, API, fallback, and mutation
cases are deterministic test fixtures in the Vitest suite.

## CI gate

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:coverage
npm audit --omit=dev
npm run smoke:package
npm pack --dry-run
```

The release branch is not eligible for merge or npm publication unless every
command succeeds and architecture review finds no unproven public promise.
