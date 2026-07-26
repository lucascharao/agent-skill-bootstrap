# ADR 0001: Hybrid lifecycle bootstrap

Status: Accepted

Date: 2026-07-25

## Context

The product must prepare a project briefing and relevant agent skills before
development begins in Claude Code or Codex. Both hosts support lifecycle hooks,
but their trust and context behavior differ. Shadowing vendor executables would
make ordering deterministic but introduces unacceptable operational risk.

The skills.sh API v1 also requires Vercel OIDC, which is not normally present on
a local workstation.

## Decision

Use vendor-native `SessionStart` and `UserPromptSubmit` hooks backed by a shared
idempotent sync engine. Expose the same engine through explicit diagnostic
commands, while keeping normal operation fully automatic after setup.
Use the authenticated API v1 when a token is available and the official
`skills` CLI as the local fallback.

Do not create command shims named `claude` or `codex`. Do not bypass hook trust.

Copy the compiled runtime into a pinned, owned project or user directory during
initialization so hooks remain offline-capable after the transient `npx`
process exits.

Create a deterministic briefing from bounded manifest evidence. If no catalog
skill passes policy, create an instruction-only project skill. Reevaluate owned
skills when the fingerprint changes and move obsolete assets to recoverable
quarantine; never permanently delete them automatically.

Hook preparation fails closed rather than falsely reporting readiness. Offer
`run <agent>` as a strict launcher fallback when a host environment disables
hooks.

Grok Build is excluded from `0.1.0`. Its official contract documents passive
startup and prompt hooks whose stdout is ignored, so the release cannot prove
that newly generated context is available before the first model response.

## Consequences

Positive:

- Native integration without taking over the user's `PATH`.
- Consistent behavior across automatic and manual execution.
- Automatic preparation and context handoff after one setup.
- Recoverable maintenance limited to package-owned assets.
- Clear separation between detection, discovery, policy, and installation.

Negative:

- Trust approval remains a required user step.
- Automatic behavior cannot be guaranteed where hooks are disabled.
- Network or policy failure stops preparation instead of silently starting
  without promised context.
- The first release uses a GitHub npm spec until the package is published to the
  public npm registry.

## Alternatives

- Vendor-command wrappers: rejected due to executable shadowing and IDE gaps.
- Hooks only: rejected because it lacks recovery and diagnostics.
- Background daemon: rejected for v1 due to persistence, security, and support
  complexity.
