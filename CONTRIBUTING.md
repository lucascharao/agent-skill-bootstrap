# Contributing

Thanks for helping improve Agent Skill Bootstrap.

## Development setup

Requirements:

- Node.js 22.20 or newer
- npm 10 or newer

```bash
git clone https://github.com/lucascharao/agent-skill-bootstrap.git
cd agent-skill-bootstrap
npm install
npm run check
```

## Pull requests

Keep changes focused and include tests for observable behavior. Public behavior
changes should update the README and, when architectural, the relevant ADR.

Before opening a pull request:

```bash
npm run check
```

Do not use real agent directories, live credentials, or live catalog calls in
tests. Use isolated fixtures and injected adapters.

Commit messages should be concise, imperative, and written in English.

## Reporting bugs

Include the CLI version, Node.js version, operating system, selected scope and
mode, sanitized `doctor --json` output, and minimal reproduction steps. Never
include OIDC tokens or private skill contents.
