# Deployment

## Always-on systemd (user) service

`~/.config/systemd/user/agentos.service`:

```ini
[Unit]
Description=AgentOS Web Platform (NVIDIA NIM chat + agentic workflows)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/USER/agent0
ExecStart=/path/to/node /home/USER/agent0/dist/cli.js server --port 8787 --host 0.0.0.0
Environment=PATH=/path/to/node/bin:/home/USER/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Enable + boot-persistence (linger runs the service without an interactive login):

```bash
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now agentos
```

> From a non-login shell, export `XDG_RUNTIME_DIR=/run/user/$(id -u)` before any
> `systemctl --user` command.

The `Environment=PATH=…` line matters: the agent's tools shell out to `python3`, `node`,
`rg`, `grep`, `curl`, so those must resolve under systemd's minimal PATH. The `ExecStart`
uses an absolute `node` path — update it if you change Node versions (e.g. via nvm).

## Update after a code change

```bash
cd ~/agent0
npx tsc
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart agentos
journalctl --user -u agentos -f     # watch it come up
```

UI-only edits (`web/`) are served fresh — no rebuild/restart needed, just reload the page.

## Access

- **Private (recommended):** reach it over Tailscale at `http://<tailscale-ip>:8787`.
  No app on the phone — just a browser to that IP + the PIN.
- **Public:** don't expose port 8787 directly. Put a TLS terminator with an identity gate
  in front (Cloudflare Tunnel + Access, or Caddy + auth). See [SECURITY.md](SECURITY.md).

## Configuration

| What | Where |
|---|---|
| NVIDIA NIM key | `~/.config/nvidia-nim/env` (`NVIDIA_API_KEY=…`) or `$NVIDIA_API_KEY` |
| Admin PIN hash | `~/.config/agentos/auth.json` (mode 600) |
| Permissions/scope | `~/.config/agentos/settings.json` |
| Conversations | `~/.config/agentos/conversations.json` |
| Memory DB | `~/.config/agentos/memory.db` |
| Default model / port | `--model` / `--port` flags on `server` |
