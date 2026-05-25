# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in Claude Forge, please report it responsibly:

1. **Do NOT** open a public issue
2. Email: Open a private security advisory on [GitHub](https://github.com/sangrokjung/claude-forge/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity (Critical: ASAP, High: 1 week, Medium: 2 weeks)

## Scope

### In Scope
- Secrets accidentally committed to the repository
- Hook scripts with command injection vulnerabilities
- Settings that could lead to data exposure
- Permission configurations that are overly permissive

### Out of Scope
- Vulnerabilities in Claude Code itself (report to [Anthropic](https://github.com/anthropics/claude-code/issues))
- Vulnerabilities in MCP servers (report to respective maintainers)
- Social engineering attacks

## Best Practices for Users

1. **Never commit secrets** to your fork
   - Use `settings.local.json` for sensitive environment variables
   - `settings.local.json` is in `.gitignore` by default

2. **Review hooks before enabling**
   - All hook scripts are in `hooks/` directory
   - Read each script before running `install.sh`

3. **Keep your fork updated**
   ```bash
   git fetch upstream
   git merge upstream/main
   ```

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
