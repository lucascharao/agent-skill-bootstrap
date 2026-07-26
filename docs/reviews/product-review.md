# Product Review

Reviewer: Product Owner gate

Date: 2026-07-26

Status: Approved direction; implementation evidence pending

## Release direction

Version 0.1 must promise only behavior that can be demonstrated from the packed
artifact:

- Claude Code and Codex
- macOS and Linux
- Project and current-user scopes
- One fail-closed `SessionStart` hook
- Immutable audited catalog snapshots or safe project-local fallback
- Global-first deduplication without false cache readiness
- Recoverable maintenance limited to package-owned skills

Grok Build, Windows, command wrappers, mutable automatic installation, and
unverifiable readiness claims are outside the 0.1 contract.
