# Security

AgentOS gives an AI agent real access to your machine. This document describes the
controls and their limits. **Do not expose it to the public internet without an
identity layer in front** — run it privately (Tailscale) with a strong PIN.

## Authentication (`server/auth.ts`)

- PIN hashed with **scrypt + 16-byte random salt**, stored in
  `~/.config/agentos/auth.json` (mode `600`). No plaintext, never in source.
- Sessions are **HMAC-signed, expiring tokens** (stateless, survive restarts), delivered
  as an **httpOnly, SameSite=Lax** cookie. `SameSite=Lax` blocks cross-site POST/fetch,
  mitigating CSRF on state-changing endpoints.
- **Timing-safe** comparison; **per-IP lockout** after 5 failed attempts (5 min).
- If `auth.json` is absent, auth is disabled (open) — intended only for localhost dev.
- Change the PIN:
  ```bash
  AGENTOS_PIN='new' node -e "import('/path/agent0/dist/server/auth.js').then(m=>m.Auth.writeCredential(process.env.AGENTOS_PIN))"
  systemctl --user restart agentos
  ```

## Permissions & scope (`server/permissions.ts`)

- **Mode `ask`** (default): every medium/high-risk tool call (writes, code, shell)
  raises an approval prompt on the client; low-risk reads/searches run immediately.
- **Mode `full`**: everything runs unattended.
- **Scope**: a filesystem root the agent is confined to (default `$HOME`). Path arguments
  outside the scope are rejected **in both modes**. `/` means the whole machine.
- Persisted to `~/.config/agentos/settings.json`.

## Sandboxing

- **Forged tools** run in a hardened `node:vm` (no `require`/`process`/`fs`/`eval`,
  code-generation disabled, allowlisted `fetch` only). See [TOOLS.md](TOOLS.md).
- **Tool code that shells out uses `execFile`/`fetch`, never string-interpolated
  `exec`** — this repo had two command-injection bugs (`curl`, `fs_search`) that were
  fixed this way. Do not reintroduce shell interpolation.
- SQL uses parameterized statements. Static file serving is path-traversal guarded. The
  conversation store uses a null-prototype map + id validation (no prototype pollution).

## Known limitations (by design)

- **Scope confines the structured `fs_*` tools and web tools, but not `bash`/`python`/
  `node`** — those run at shell level and can read/write outside the scope. The **approval
  gate (Ask mode) is the real control** for those. True confinement requires a container
  or an isolate; not implemented.
- No symlink/realpath resolution on scope checks (a symlink inside scope pointing outside
  would follow).
- Concurrent agent runs share one EventBus → trace crosstalk (single-user assumption).
- Plain HTTP: the session cookie is not `Secure`. Fine over a private tailnet; put TLS in
  front (Cloudflare Tunnel / Caddy) before any public exposure, and add an identity gate.

## Reporting

This is a personal project. If you fork/publish it, add a real disclosure path and
consider containerizing the code-execution tools before multi-user or public use.
