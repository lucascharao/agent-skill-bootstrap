# Product Architecture Review

Reviewer: Pax, Product Owner perspective

Date: 2026-07-25

Initial decision: CHANGES_REQUIRED

## Findings

The initial design required stronger contracts for:

1. Deduplication by skill and target agent.
2. A persistent offline-capable runtime after transient `npx` initialization.
3. Deterministic relevance scoring and no-install behavior below confidence.
4. A formal best-effort versus strict pre-start guarantee.
5. Per-project isolation for global cache, state, and locks.

Additional tests were requested for partial agent coverage, actual hook
execution, stale locks, timeouts, offline behavior, owned uninstall, rollback,
malicious arguments, version compatibility, and packaged offline startup.

## Resolution

All five contracts and their requested acceptance tests were added to
`docs/ARCHITECTURE.md`, `docs/adr/0001-hybrid-lifecycle-bootstrap.md`, and
`docs/TESTING.md`.

The first re-review confirmed items 1, 4, and 5, and requested two final
corrections:

- Replace `npx skills@latest` in hooks with a runtime-local exact version.
- Specify the complete normalized relevance formula and contract examples.

The architecture now pins `skills@1.5.19`, invokes its local executable, raises
the Node.js floor to match the vendor package, and defines scoring weights,
required-term behavior, missing metadata behavior, multi-workspace selection,
tie-breaking, and fixtures.

Final decision: APPROVE.
