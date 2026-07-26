# ADR 0001: Native SessionStart bootstrap with safe local fallback

Status: Accepted

Date: 2026-07-26

## Context

The product must prepare a project briefing and required skills before
development begins. Claude Code and Codex expose startup hooks, but both retain
host trust and policy controls. The skills.sh API requires Vercel OIDC and
cannot be assumed on a local workstation. Search-only CLI results point to
mutable remote sources and cannot justify automatic execution.

## Decision

Use one vendor-native `SessionStart` hook backed by a shared fail-closed sync
engine. Do not install `UserPromptSubmit` in 0.1 and do not shadow the `claude`
or `codex` executable.

Resolve the project from the event `cwd` (or Claude's official project
environment) and enforce the configured boundary. Use exact structured hook
ownership, compare-and-swap, atomic replacement, and symlink-safe managed
paths.

Use the authenticated skills.sh API only when an immutable snapshot and
acceptable audit are available. The pinned official CLI may discover
candidates, but its mutable result is never materialized automatically.
Generate a deterministic instruction-only project skill when no admitted
snapshot or verified existing binding is available.

Cache entries are hints. Before reuse, revalidate every expected agent binding,
ownership manifest, file, and content digest.

Support only Claude Code and Codex on macOS and Linux in version 0.1. Preserve
both project and current-user scopes because the packaged smoke test proves all
four host/scope combinations.

## Consequences

Positive:

- One automatic setup followed by native startup behavior
- No executable shadowing or shell-profile changes
- No mutable remote code installed by the hook
- Cache cannot create a false-ready state after local mutation
- Existing third-party hooks and unmanaged skills remain untouched
- Public contract matches executable CI evidence

Negative:

- Initial host trust approval is unavoidable
- A host that disables hooks is unsupported
- Corrupt occupied managed destinations stop startup until repaired
- API-unavailable machines receive local instruction-only fallbacks instead of
  remote catalog code

## Exclusions

Grok Build is excluded because its passive startup output does not prove
first-response context loading. Windows is excluded until the packaged smoke
matrix runs on and verifies that platform.
