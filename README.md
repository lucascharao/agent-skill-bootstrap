# Agent Skill Bootstrap

Detect the technology stack in a project and install only the relevant
[skills.sh](https://skills.sh) agent skills before Claude Code, Codex, or Grok
Build starts working.

Agent Skill Bootstrap is a local-first CLI. It can be installed for one project
or for the current user account, checks global skills before adding project
copies, and preserves existing agent hook configuration.

> Status: `0.1.0` pre-release. The repository is npm-ready; until the first npm
> publication, run it directly from GitHub.

## Why

Agent skill libraries are useful, but manually selecting and installing skills
for every repository is repetitive. Installing everything globally creates
noise and makes agent context harder to reason about.

This tool uses project evidence—manifests, dependencies, and configuration
files—to build a deterministic stack fingerprint. It searches the skills.sh
catalog, applies relevance and security policy, and installs only missing skill
bindings.

## Quick start

Requirements:

- Node.js 22.20 or newer
- Git for skills discovered through the official CLI fallback
- At least one supported agent: Claude Code, Codex, or Grok Build

Run the interactive installer:

```bash
npx github:lucascharao/agent-skill-bootstrap
```

The installer asks:

1. Project or global scope
2. Native or strict startup mode
3. Which agents should receive skills

`global` means the current user account. It never installs into a system root
and never requires `sudo`.

For automation:

```bash
npx github:lucascharao/agent-skill-bootstrap init \
  --scope project \
  --mode native \
  --agents claude-code,codex,grok \
  --non-interactive
```

## Startup modes

### Native hooks

Native mode installs vendor-supported `SessionStart` hooks. It is automatic and
fail-open: an unavailable catalog does not block the agent session.

Hosts decide when newly installed skills become visible. A first session may
need one restart. Project hooks may also require explicit trust in Codex and
Grok Build.

### Strict launcher

Strict mode completes discovery, policy checks, and installation before it
spawns the requested agent:

```bash
agent-skill-bootstrap run codex
agent-skill-bootstrap run claude -- --model sonnet
agent-skill-bootstrap run grok
```

The installer prints a persistent runtime command when the package itself was
started through transient `npx`. Strict mode fails closed; it does not start the
agent if required discovery or audit checks cannot complete.

## Commands

```text
agent-skill-bootstrap [init]   Configure runtime, hooks, and initial sync
agent-skill-bootstrap scan     Show detected technologies and evidence
agent-skill-bootstrap sync     Discover and install missing skills
agent-skill-bootstrap doctor   Diagnose runtime, hooks, trust, and inventory
agent-skill-bootstrap run      Synchronize, then start an agent
agent-skill-bootstrap uninstall --yes
```

Useful flags:

```text
--scope project|global
--mode native|strict
--agents claude-code,codex,grok
--root <path>
--dry-run
--force
--json
--non-interactive
```

Examples:

```bash
agent-skill-bootstrap scan --json
agent-skill-bootstrap sync --dry-run
agent-skill-bootstrap sync --force
agent-skill-bootstrap doctor --json
```

## How discovery works

The authenticated skills.sh v1 API is the preferred provider. The API currently
requires a Vercel OIDC token, normally available as `VERCEL_OIDC_TOKEN`.

If no token is available, native mode uses the exact bundled version of the
official `skills` CLI. Fallback candidates are limited to trusted owners.
Strict mode does not automatically install unaudited fallback results.

For API installs, the tool:

1. Searches with a bounded query
2. Requires stack-specific term and query coverage
3. Checks partner audit results
4. Fetches an immutable file snapshot
5. Validates paths and content limits
6. Materializes the skill atomically

The official CLI currently has no Grok target. Agent Skill Bootstrap
materializes a vetted candidate into an isolated temporary directory and copies
the same checked snapshot into `.grok/skills`.

## Deduplication

Deduplication is evaluated for each stable skill identity and target agent:

- Global inventory is checked before project inventory.
- Existing official CLI lock files are recognized.
- An existing Claude binding does not hide a missing Codex or Grok binding.
- Name-only collisions do not authorize a skip.
- Repeated syncs are idempotent.

Default skill directories:

| Agent       | Project          | Global             |
| ----------- | ---------------- | ------------------ |
| Claude Code | `.claude/skills` | `~/.claude/skills` |
| Codex       | `.agents/skills` | `~/.agents/skills` |
| Grok Build  | `.grok/skills`   | `~/.grok/skills`   |

## Configuration

Project configuration:

```text
.agent-skill-bootstrap/config.yaml
```

User configuration:

```text
~/.config/agent-skill-bootstrap/config.yaml
```

See [`config/default.yaml`](config/default.yaml) for all defaults.

Project configuration cannot weaken the user security floor. In particular, it
cannot redirect the API, change the credential environment variable, add
trusted owners, lower relevance thresholds, disable required audits, or
increase automatic install limits.

## Security

- No shell is used for external process arguments.
- Authentication is sent only to exact user-allowlisted HTTPS origins.
- Redirects never forward authorization across origins.
- External file paths are validated against traversal and size limits.
- Skills are copied rather than linked.
- Hook JSON is backed up and atomically updated.
- Existing hook entries are preserved.
- Uninstall removes only entries marked as owned by this tool.
- No telemetry is collected.

Read [SECURITY.md](SECURITY.md) for reporting and threat-model details.

## Honest limitations

No third-party tool can guarantee startup execution when an IDE, enterprise
policy, sandbox, or agent host disables hooks. Native mode reports that boundary
instead of bypassing trust. Use strict mode when ordering is a hard
requirement.

The skills.sh API audit endpoint is not tied to a snapshot revision. Automatic
API installs therefore fetch and stage one exact detail snapshot after policy
approval, then verify the staged result before committing it.

## Development

```bash
npm install
npm run check
```

The implementation is TypeScript ESM. Tests never write to real agent
directories or call live services.

Architecture and decisions:

- [Architecture](docs/ARCHITECTURE.md)
- [Hybrid lifecycle ADR](docs/adr/0001-hybrid-lifecycle-bootstrap.md)
- [Testing strategy](docs/TESTING.md)

## License

[MIT](LICENSE)
