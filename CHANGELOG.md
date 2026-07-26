# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-26

### Added

- Interactive project or user-level installation
- Stack detection and deterministic relevance scoring
- Authenticated skills.sh API adapter
- Pinned official skills CLI for discovery-only fallback
- Global-first per-agent deduplication
- Claude Code and Codex fail-closed `SessionStart` lifecycle hooks
- Deterministic project briefing and context handoff
- Safe project-local skill generation when no catalog candidate qualifies
- Automatic, recoverable quarantine and explicit restore workflow
- Persistent runtime, cache, lock, doctor, dry-run, and JSON output
- Security-focused snapshot validation and atomic materialization
- Package smoke for every declared host and scope

### Changed

- Grok Build was removed from the initial release because its passive startup
  hooks cannot prove that newly generated context is loaded before the first
  model response.
- Replaced the MIT license with the Agent Skill Bootstrap Source-Available
  License. Official copies may be installed and used, but modification and
  redistribution require prior written permission.
- Mutable CLI candidates are never installed automatically; the runtime
  generates a safe project-local fallback when no immutable audited API
  snapshot is available.
- Codex current-user paths now respect `${CODEX_HOME:-~/.codex}`.
- Cache reuse now requires binding, ownership, file, and digest revalidation.
- Hook ownership is exact and structured; updates and removals use atomic
  compare-and-swap writes.
- Windows was removed from the 0.1 support contract pending packaged smoke
  evidence.

[Unreleased]: https://github.com/lucascharao/agent-skill-bootstrap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lucascharao/agent-skill-bootstrap/releases/tag/v0.1.0
