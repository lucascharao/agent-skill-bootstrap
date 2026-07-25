# ADR 0001: Hybrid lifecycle bootstrap

Status: Accepted

Date: 2026-07-25

## Context

The product must install relevant agent skills before development begins in
Claude Code, Codex, and Grok Build. The hosts support lifecycle hooks, but their
trust, output, and refresh behavior differ. Shadowing vendor executables would
make ordering deterministic but introduces unacceptable operational risk.

The skills.sh API v1 also requires Vercel OIDC, which is not normally present on
a local workstation.

## Decision

Use vendor-native lifecycle hooks backed by a shared idempotent sync engine.
Expose the same engine through explicit `sync`, `scan`, and `doctor` commands.
Use the authenticated API v1 when a token is available and the official
`skills` CLI as the local fallback.

Do not create command shims named `claude`, `codex`, or `grok`. Do not bypass
hook trust.

Copy the compiled runtime into a pinned, owned project or user directory during
initialization so hooks remain offline-capable after the transient `npx`
process exits.

Offer `run <agent>` as the strict deterministic mode. Native hooks are the
best-effort default; strict mode completes sync before spawning the agent.

## Consequences

Positive:

- Native integration without taking over the user's `PATH`.
- Consistent behavior across automatic and manual execution.
- Safe fail-open degradation in native hook mode for offline and managed
  environments; strict mode remains intentionally fail-closed.
- Clear separation between detection, discovery, policy, and installation.

Negative:

- Trust approval remains a required user step.
- Automatic behavior cannot be guaranteed where hooks are disabled.
- A runtime that does not refresh its skill inventory may require one restart.
- The first release uses a GitHub npm spec until the package is published to the
  public npm registry.

## Alternatives

- Vendor-command wrappers: rejected due to executable shadowing and IDE gaps.
- Hooks only: rejected because it lacks recovery and diagnostics.
- Background daemon: rejected for v1 due to persistence, security, and support
  complexity.
