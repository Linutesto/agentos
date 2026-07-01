# CLAUDE.md

This project follows **[AGENTS.md](./AGENTS.md)** — read it first for structure, build
commands, conventions, the tool-extension point, and gotchas.

## Claude Code specifics

- Build after edits: `npx tsc`. Restart the live service:
  `export XDG_RUNTIME_DIR=/run/user/$(id -u) && systemctl --user restart agentos`.
- Test a single tool without the server: `node dist/cli.js tool exec <name> '<json>'`.
- Test an endpoint: log in first (`POST /api/login {"pin":"…"}` with a cookie jar),
  then hit `/api/*` — all routes except login/logout/auth require the session cookie.
- Prefer the dedicated Read/Edit/Grep tools over shell `cat`/`sed`.
- Security-sensitive areas — treat with care and never weaken:
  `server/auth.ts`, `server/permissions.ts`, and any tool that runs code/shell
  (`bash`, `python`, `node`, `forge`). No shell string interpolation.
- Do not commit, push, or restart external services unless asked.
