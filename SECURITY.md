# Security Policy

## Supported versions

Security fixes are accepted on the default branch (`main`) of this repository.

## Reporting a vulnerability

If you find a security issue (credential leak, RCE, path traversal, unsafe defaults, etc.):

1. **Do not** open a public GitHub issue that includes secrets or a full exploit against third-party systems.
2. Prefer a private channel (GitHub Security Advisory / email to the maintainer) when available.
3. Include: affected path, impact, and a minimal reproduction without live keys.

## Hard rules for contributors

- Never commit `.env`, API keys, tokens, private keys, or session cookies.
- Never paste production credentials into issues, PRs, or sample configs.
- Treat `claudio` / the process wrapper as high-privilege local tooling (same class as other coding agents).
- Do not change secure-storage service name bases without a migration path (orphans OS keychain entries).

## Dependency audits

`openclaude-fork` may report transitive advisories (`bun audit`) inherited from upstream OpenClaude.
Prefer targeted upgrades over `bun update --latest` without review. The Cursor extension package
is audited separately with `npm audit` and should stay clean for releases.
