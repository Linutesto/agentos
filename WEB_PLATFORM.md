# AgentOS Web Platform

Mobile-first chat + agentic-workflow UI over the NVIDIA NIM catalog (121 models),
built on the AgentOS kernel (ToolBus + AgentLoop).

## Run
    agentos-web                 # port 8787, binds 0.0.0.0, default model qwen/qwen3.5-397b-a17b
    agentos-web --port 9000 --model meta/llama-3.3-70b-instruct

Or directly: `node dist/cli.js server`.

## Open on the Pixel (over Tailscale)
    http://<your-tailscale-ip>:8787
LAN: http://<your-lan-ip>:8787 · Local: http://localhost:8787

## Features
- **Model picker** — searchable list of every model your NVIDIA key can reach.
- **Chat mode** — direct streaming conversation. Attach an image (📎) → auto-switches to a vision model.
- **Agent mode** — ReAct loop: the model calls tools, live step trace on screen.
- **Control panel** (⚙): temperature slider, permission mode, scope, and per-tool toggles.
- **Saved chats** (📚) — save/reload/delete conversations (~/.config/agentos/conversations.json).
- Streaming markdown, truncation warnings.

## Permissions & scope (full PC access, safely)
- **Permission mode** — `Ask` (approve each medium/high-risk action via an in-app prompt)
  or `Full` (agent runs everything unattended). Low-risk reads/search never prompt.
- **Scope** — the filesystem area the agent may touch. Default = home. Set to `/` for the
  whole PC, or a subdir to confine it. Out-of-scope paths are blocked in *both* modes.
- Persisted to ~/.config/agentos/settings.json. Default is **Ask + home** (safe).

## Tools (23)
web_search, fetch_url · fs_list/read/write/delete/search · python, node (code runners) ·
analyze_image (vision) · bash, curl · memory.* · bus.* · cloudflare.*
Risk drives the approval prompt: writes/exec = high, http = medium, reads/search = low.

## Authentication
PIN login (scrypt-hashed + salted in ~/.config/agentos/auth.json, mode 600; HMAC-signed
httpOnly session cookie, 30-day; timing-safe compare; 5-fail → 5-min per-IP lockout).
Change the PIN:
    AGENTOS_PIN='newpin' node -e "import('/home/yan/agent0/dist/server/auth.js').then(m=>m.Auth.writeCredential(process.env.AGENTOS_PIN))"
    systemctl --user restart agentos
Disable auth entirely: delete ~/.config/agentos/auth.json and restart.

## Always-on service (systemd --user, boot-persistent via linger)
    systemctl --user status agentos        # health
    systemctl --user restart agentos       # after a rebuild
    journalctl --user -u agentos -f        # logs
Unit: ~/.config/systemd/user/agentos.service. After editing code: `npm run build`
(or `npx tsc`) then `systemctl --user restart agentos`.

## Key
Read from `NVIDIA_API_KEY`, else `agentos config set-secret nvidia_api_key <key>`,
else `~/.config/nvidia-nim/env`.

## Add a plugin/tool
Drop a `Tool` (see src/tools/websearch.ts or filesystem.ts) and register it in
src/server/server.ts. Set its `riskLevel` (drives approval gating). It auto-appears in
the agent's system prompt and the UI tool list.
