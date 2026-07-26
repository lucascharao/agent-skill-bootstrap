# Risks and mitigations

- **API authentication unavailable — high.** The pinned official CLI performs
  discovery only. The runtime generates an instruction-only project skill and
  does not execute mutable remote content.
- **Untrusted skill content — high.** Automatic catalog installation requires
  relevance, audit, allowed risk, immutable hash, complete snapshot, safe
  paths, and matching digest.
- **False-ready cache — high.** TTL and fingerprint are never sufficient;
  expected bindings, ownership, files, symlinks, and digests are revalidated.
- **Concurrent startup — medium.** State and locks are isolated per canonical
  project. Atomic creation serializes sync.
- **Hook disabled or untrusted — high.** Trust is never bypassed. `doctor`
  reports the distinction and preparation failures return `continue: false`.
- **Configuration corruption — high.** Exact ownership, backup, symlink
  rejection, compare-and-swap, and atomic rename preserve third-party data.
- **Unsupported host/platform — medium.** Version 0.1 promises only Claude Code
  and Codex on macOS/Linux, backed by package smoke for both scopes.
