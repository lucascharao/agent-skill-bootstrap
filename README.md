# Agent Skill Bootstrap

Prepare the project briefing and required skills before Claude Code or Codex
starts development.

Agent Skill Bootstrap is a local-first CLI distributed through `npx`. After one
setup, an owned `SessionStart` hook detects the project, checks the
[skills.sh](https://skills.sh) catalog, validates existing bindings, installs
only immutable audited snapshots, and creates a safe project-local skill when
the catalog cannot provide one.

## Supported contract for 0.1.0

- Hosts: Claude Code and Codex
- Operating systems: macOS and Linux
- Scopes: current project or current user
- Lifecycle event: `SessionStart`
- Trust: the user must approve the hook in the host
- Failure behavior: preparation errors return `continue: false`

Windows and Grok Build are not promised by this release. The project does not
bypass host trust, enterprise policy, disabled hooks, or unavailable
filesystems.

## Install once

Requirements:

- Node.js 22.20.0 or newer
- Claude Code, Codex, or both

After the npm release:

```bash
npx agent-skill-bootstrap
```

Until then:

```bash
npx github:lucascharao/agent-skill-bootstrap
```

The installer asks only:

1. Whether automation belongs to this project or the current user
2. Which supported agents should use it

It then installs a pinned persistent runtime, merges one owned `SessionStart`
entry without replacing unrelated hooks, creates the first briefing, and runs
the first safe skill cycle.

## Automatic startup flow

After the host approves the hook, every supported session start:

1. Resolves the project from the trusted event `cwd`
2. Detects technologies from bounded manifests and known configuration files
3. Builds a deterministic project briefing and fingerprint
4. Revalidates cached bindings, manifests, files, and content digests
5. Searches skills.sh through its authenticated API or pinned official CLI
6. Admits only immutable API snapshots that pass audit and relevance policy
7. Reuses an existing verified global or local binding when available
8. Creates an instruction-only project skill when no safe snapshot qualifies
9. Quarantines obsolete package-owned project skills
10. Injects only the sanitized briefing and verified managed skill IDs

The official CLI is used for discovery only when an immutable audited API
snapshot is unavailable. A mutable branch, tag, or repository result is never
materialized automatically.

## Installation paths

| Host        | Project          | Current user                     |
| ----------- | ---------------- | -------------------------------- |
| Claude Code | `.claude/skills` | `~/.claude/skills`               |
| Codex       | `.agents/skills` | `${CODEX_HOME:-~/.codex}/skills` |

Codex user hooks follow the same home:
`${CODEX_HOME:-~/.codex}/hooks.json`.

Global state is isolated per canonical project:

```text
~/.config/agent-skill-bootstrap/projects/<project-hash>/
```

Generated fallback skills always remain inside the project, including when the
installer itself uses current-user scope.

## Generated fallback skills

When no relevant immutable snapshot passes policy, the CLI generates a small
deterministic `SKILL.md` from verified project evidence.

Generated skills:

- Contain instructions only, never scripts or executable assets
- Never read `.env`, credentials, prompt history, or arbitrary source files
- Remain project-local
- Carry an Agent Skill Bootstrap ownership manifest and content digest
- Can be moved only to recoverable quarantine, never automatically deleted

## Automatic maintenance

Only directories with a valid ownership manifest and matching content digest
are managed. Obsolete skills are moved to:

```text
.agent-skill-bootstrap/quarantine/
```

Unmanaged skills and third-party hooks are preserved. A third-party hook merely
mentioning the package name or marker is not considered owned.

Diagnostic commands are optional:

```bash
agent-skill-bootstrap scan
agent-skill-bootstrap sync
agent-skill-bootstrap analyze
agent-skill-bootstrap prune --dry-run
agent-skill-bootstrap prune --yes
agent-skill-bootstrap quarantine
agent-skill-bootstrap restore <skill-id-or-slug> --yes
agent-skill-bootstrap doctor
agent-skill-bootstrap uninstall --yes
```

Useful flags:

```text
--scope project|global
--agents claude-code,codex
--root <path>
--dry-run
--force
--json
--non-interactive
```

## Trust and diagnostics

The installer cannot approve its own hook. `doctor` distinguishes installation
health from host readiness:

- `supported-and-verified`: reserved for explicit host verification evidence
- `trust-required`: runtime and hook are installed but host approval is pending
- `installed-but-unverified`: files exist but the runtime cannot be verified
- `unsupported`: the host, platform, or installation is outside the 0.1 contract

No success message claims that a host loaded the hook when approval cannot be
verified.

## Security properties

- Exact structured `--owner` markers for hook update and removal
- Compare-and-swap plus atomic replacement for hook JSON
- Symlink rejection for managed boundaries, parents, staging, and destinations
- Path containment based on platform path semantics, not string prefixes
- Immutable snapshot, audit, size, file, and content-digest validation
- Per-project state, cache, briefing, and sync lock
- Cache invalidation when any required binding or asset changes
- No shell execution for external process arguments
- OIDC credentials sent only to exact allowlisted HTTPS origins
- No telemetry

See [SECURITY.md](SECURITY.md) for the threat model.

## Verification

The CI release gate runs:

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

The package smoke installs the real tarball in clean temporary homes and
exercises init, `SessionStart`, briefing/context creation, safe sync, and
uninstall for Claude Code and Codex in both declared scopes.

## Repository and license

The public repository is available for source visibility, issue reporting, and
release verification. External source-code contributions are not accepted.
Protected branches and pull requests guard the upstream repository.

Agent Skill Bootstrap is source-available proprietary software, not open
source. Official unmodified copies may be installed and used under the terms in
[LICENSE](LICENSE). Modification, derivative works, redistribution,
sublicensing, resale, or hosted redistribution require prior written
permission. Generated project output remains available for the user's own
projects as described by the license.

- [Architecture](docs/ARCHITECTURE.md)
- [Lifecycle decision](docs/adr/0001-hybrid-lifecycle-bootstrap.md)
- [Testing strategy](docs/TESTING.md)
