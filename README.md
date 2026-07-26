# Agent Skill Bootstrap

Install once, then let Claude Code or Codex start every project with the right
briefing and only the skills it needs.

Agent Skill Bootstrap is a local-first CLI distributed through `npx`. It
detects a project's stack from known manifests, searches
[skills.sh](https://skills.sh), applies security and relevance policy, skips
skills already available globally or locally, and prepares the project before
the coding agent handles the first prompt.

## One-time setup

Requirements:

- Node.js 22.20 or newer
- Git for the official skills CLI fallback
- Claude Code, Codex, or both

Run:

```bash
npx agent-skill-bootstrap
```

Before the first npm release, use:

```bash
npx github:lucascharao/agent-skill-bootstrap
```

The installer asks only:

1. Whether the automation belongs to this project or the current user
2. Which supported coding agents should use it

It then installs a persistent, versioned runtime, merges owned lifecycle hooks
without replacing existing hooks, builds the first project briefing, and runs
the first skill cycle.

Project scope stores configuration and skills in the repository. User scope
installs the runtime and reusable catalog skills for the current user; generated
fallback skills remain project-local.

## What happens automatically

After setup, no recurring command is required. At session start and before the
first prompt, the installed hooks:

1. Detect the project from bounded manifest and configuration evidence
2. Build a deterministic briefing and fingerprint
3. Search the skills.sh catalog or the pinned official skills CLI
4. Apply relevance, trusted-owner, duplicate, and audit policy
5. Check global inventory before project inventory
6. Install only missing agent bindings
7. Generate a safe project-local skill when no catalog skill qualifies
8. Quarantine package-owned skills that became obsolete
9. Add the briefing and managed skill list to the agent context

Unchanged projects use a fast cache. A changed manifest triggers a fresh cycle.

## Generated fallback skills

When no relevant and safe catalog entry exists, Agent Skill Bootstrap creates a
small instruction-only `SKILL.md` from verified project evidence.

Generated skills:

- Are deterministic for the same briefing
- Contain only `name`, `description`, bounded evidence, workflow, and safety
  boundaries
- Never include `.env`, credentials, prompt history, or arbitrary source code
- Never include executable scripts or destructive commands
- Are always project-local and marked as owned by this package
- Are replaced by a qualifying catalog skill when one later becomes available

## Automatic maintenance

Only skills with an Agent Skill Bootstrap ownership manifest are eligible for
automatic maintenance. When one is no longer justified by the current
briefing, it is moved to:

```text
.agent-skill-bootstrap/quarantine/
```

Automatic maintenance never permanently deletes a skill. Unmanaged skills,
links, hooks, and configuration are never moved or overwritten.

Advanced diagnostic commands are available but are not required for normal use:

```bash
agent-skill-bootstrap analyze
agent-skill-bootstrap prune --dry-run
agent-skill-bootstrap prune --yes
agent-skill-bootstrap quarantine
agent-skill-bootstrap restore <skill-id-or-slug> --yes
agent-skill-bootstrap doctor
```

## Supported hosts and trust

### Claude Code

Claude Code supports `SessionStart` and `UserPromptSubmit` hooks, context
injection, and live skill reload. Project hooks still require the host's trust
approval.

### Codex

Codex supports `SessionStart` and `UserPromptSubmit` hooks and automatically
detects skill changes. Project hooks are ignored until the project and exact
hook definition are trusted.

The installer never approves or bypasses trust. `doctor` reports the hook as
configured, but not verified as ready, until the user confirms it in the host's
`/hooks` interface.

### Why Grok Build is not included

Grok Build is intentionally excluded from `0.1.0`. Its official hook contract
documents `SessionStart` and `UserPromptSubmit` as passive events whose stdout
is ignored; only `PreToolUse` can block. That does not prove that a newly
generated briefing and skill are loaded before the first model response, so the
project does not promise support it cannot verify.

## Discovery and security

The authenticated skills.sh API is preferred when a Vercel OIDC token is
available. Otherwise native mode uses the exact bundled version of the official
`skills` CLI. API installs fetch the detailed file snapshot after partner audit
checks; CLI fallback candidates are limited to configured trusted owners.

Default skill directories:

| Agent       | Project          | User               |
| ----------- | ---------------- | ------------------ |
| Claude Code | `.claude/skills` | `~/.claude/skills` |
| Codex       | `.agents/skills` | `~/.agents/skills` |

Security properties:

- External process arguments never use a shell
- Credentials are sent only to exact allowlisted HTTPS origins
- Redirects never forward credentials across origins
- Snapshot paths, size, symlinks, and digest are validated
- Writes use staging and atomic rename
- Hook JSON is backed up and merged
- Global inventory is checked before project installation
- No telemetry is collected

See [SECURITY.md](SECURITY.md) for the threat model.

## Advanced CLI

```text
agent-skill-bootstrap [init]             One-time setup and first cycle
agent-skill-bootstrap scan               Show project detection evidence
agent-skill-bootstrap sync               Run discovery manually
agent-skill-bootstrap analyze            Explain skill lifecycle decisions
agent-skill-bootstrap prune              Preview or quarantine obsolete skills
agent-skill-bootstrap quarantine         List recoverable skills
agent-skill-bootstrap restore            Restore a quarantined skill
agent-skill-bootstrap doctor             Diagnose runtime and hooks
agent-skill-bootstrap run <claude|codex> Strict launcher fallback
agent-skill-bootstrap uninstall --yes    Remove owned hooks and runtime
```

Useful automation flags:

```text
--scope project|global
--mode native|strict
--agents claude-code,codex
--root <path>
--dry-run
--force
--json
--non-interactive
```

Strict launcher mode is available when a managed environment disables hooks:

```bash
agent-skill-bootstrap run codex
agent-skill-bootstrap run claude -- --model sonnet
```

No third-party package can force an agent host to execute a disabled or
untrusted hook. The project reports that state as a limitation instead of
claiming the project is ready.

## Configuration

Project configuration:

```text
.agent-skill-bootstrap/config.yaml
```

User configuration:

```text
~/.config/agent-skill-bootstrap/config.yaml
```

See [config/default.yaml](config/default.yaml). Project configuration cannot
weaken the user's security floor.

## Development

```bash
npm install
npm run check
```

The implementation is TypeScript ESM. Tests use isolated temporary homes and do
not call live services.

- [Architecture](docs/ARCHITECTURE.md)
- [Lifecycle ADR](docs/adr/0001-hybrid-lifecycle-bootstrap.md)
- [Testing strategy](docs/TESTING.md)

## License

[MIT](LICENSE)
