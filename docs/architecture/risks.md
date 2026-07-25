# Risks and Mitigation Strategy

## Risks

- **API authentication unavailable:** A local machine may not have a Vercel OIDC
  token. Severity: high.
- **Untrusted skill installation:** A catalog result may contain malicious or
  unsafe instructions. Severity: high.
- **Startup latency:** Network discovery on every session can delay the agent.
  Severity: medium.
- **Concurrent startup:** Multiple agents may race to install the same skill.
  Severity: medium.
- **Hook disabled or untrusted:** A host may skip the automatic bootstrap.
  Severity: high.
- **Runtime refresh gap:** A host may not expose a newly installed skill until
  restart. Severity: medium.
- **Configuration corruption:** Merging hooks may damage existing settings.
  Severity: high.

## Mitigation Strategy

- API authentication unavailable is addressed by the official `skills find`
  fallback and explicit provider diagnostics.
- Untrusted skill installation is addressed by audit checks, trusted-owner
  policy, duplicate filtering, copy mode, dry-run, and an install cap.
- Startup latency is addressed by manifest fingerprints, a bounded timeout,
  process locks, and a 24-hour cache.
- Concurrent startup is addressed by an atomic per-project lock and an
  idempotent global-first inventory check.
- Disabled or untrusted hooks are addressed by transparent trust instructions,
  `doctor`, and the explicit `sync` command.
- Runtime refresh gaps are addressed by a restart notice and agent-specific
  discovery verification.
- Configuration corruption is addressed by schema validation, owned-entry
  merging, backups, atomic writes, and fixture-based integration tests.
