# Technical Architecture Review

Reviewer: Atlas, architecture perspective

Date: 2026-07-25

Initial decision: CHANGES_REQUIRED

## Findings

The review required:

1. Immutable revision or snapshot materialization to close audit/download
   time-of-check/time-of-use risk.
2. A host matrix for first-session skill visibility.
3. Strict waiting semantics for an existing lock.
4. Capability validation and safer unaudited fallback rules.
5. Operational hook paths, schemas, trust, timeout, ownership, and atomic-write
   contracts.
6. Removal of unsafe name-only legacy deduplication.
7. Expanded security and lifecycle tests.

## Resolution

The architecture now installs API candidates from an exact validated snapshot,
pins fallback repository commits, blocks unaudited fallback in strict mode,
defines per-host first-session behavior, waits on locks in strict mode, probes
the exact local skills CLI, specifies complete adapter contracts, uses
compare-and-swap atomic writes, treats name-only matches as collisions, and
adds the requested tests.

A second independent gate required credential-origin isolation,
non-weakenable user security floors, exact API encoding/schema/retry contracts,
runtime Node re-resolution, and a stricter relevance gate. The architecture now
restricts OIDC to user-allowlisted HTTPS origins, merges security monotonically,
specifies API limits, resolves Node per hook environment with repair
diagnostics, and requires query coverage plus a higher weighted score with
keyword-stuffing negatives.

A final gate clarified that every automatic discovery origin, authenticated or
not, is controlled by a user-owned allowlist; Codex owns an explicit matcher
derived from its documented events; non-Git projects fall back to a validated
hook working directory; and only native mode is fail-open while offline.

Final decision: APPROVE.
