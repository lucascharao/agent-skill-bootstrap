# Repository Governance

Agent Skill Bootstrap is source-available proprietary software, not an open
source project. External source-code contributions, pull requests, forks for
development, and derivative works are not authorized by the project license.

Public access exists for source visibility, release verification, and issue
reporting. It does not grant permission to modify or redistribute the Software.
See [LICENSE](LICENSE) for the complete terms.

## Maintainer workflow

Only authorized maintainers may change the repository. Every change must use a
working branch and a pull request into the protected `main` branch. Direct
pushes, force-pushes, and branch deletion are disabled.

The expected GitHub protection is versioned in
`.github/branch-protection.json`. Administrators are subject to the same rules;
no standing bypass is configured. Emergency changes require an explicit,
temporary repository-owner decision and the protection must be restored
immediately afterward.

```bash
npm install
npm run check
```

## Reporting bugs

Bug reports and responsible security reports are welcome. Include the CLI
version, Node.js version, operating system, selected scope and mode, sanitized
`doctor --json` output, and minimal reproduction steps. Never include OIDC
tokens or private skill contents.
