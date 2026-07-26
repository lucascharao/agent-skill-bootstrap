# Security Policy

## Supported versions

Agent Skill Bootstrap is currently a pre-release. Security fixes are applied to
the latest release on the default branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory flow for this repository and include:

- Affected version and operating system
- Reproduction steps
- Expected and observed behavior
- Potential impact
- Any proposed mitigation

Please avoid accessing data that is not yours and do not test against third
party infrastructure without authorization.

## Security boundaries

The CLI treats these inputs as untrusted:

- Project configuration
- skills.sh search, detail, and audit responses
- Official skills CLI output
- Skill file paths and content
- Existing agent hook configuration

Project configuration cannot override credential routing or weaken the
user-level security floor. Automatic API content is accepted only from exact
user-allowlisted HTTPS origins. Files are staged and validated before an atomic
directory rename.

Native hooks and strict launcher mode fail closed when project preparation
cannot complete. The package does not report a host as ready when its hook is
missing, disabled, untrusted, or unverifiable.

Automatic maintenance is limited to project skill directories containing a
valid Agent Skill Bootstrap ownership manifest. Obsolete owned skills are moved
to recoverable quarantine. The automatic flow never permanently deletes skills
and never moves unmanaged directories or symlinks.

## Out of scope

The project does not secure the Claude Code, Codex, Git, Node.js, or npm
installations themselves. It also cannot override enterprise policies or a host
that disables hooks.
