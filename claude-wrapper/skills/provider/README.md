# Deprecated — do not install as a Claude Code skill

Provider setup must **not** collect API keys in chat (transcript / logs risk).

Use the terminal UI instead:

```bash
node ../enable-provider.js
```

`install-provider-command.js` no longer installs `~/.claude/skills/provider`.
`uninstall-provider-skill.js` removes any leftover skill.
