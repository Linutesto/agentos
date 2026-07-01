<div align="center">

# ▚ AgentOS

**A cognitive kernel for AI agents — with a mobile-first web platform for chat and agentic workflows over the entire NVIDIA NIM model catalog.**

Agents that *remember, use real tools, browse the web, control the machine (safely), and forge their own tools* — all from your phone.

`TypeScript` · `ESM` · `Node ≥ 22` · terminal + pink aesthetic

</div>

---

## Highlights

- **Any model, instantly.** One OpenAI-compatible provider over [NVIDIA NIM](https://build.nvidia.com) — 120+ models (Qwen, Llama, DeepSeek, Nemotron, Gemma, vision models…), searchable in the UI, switchable mid-conversation.
- **Two modes.** *Chat* (direct streaming, human-in-the-loop) and *Agent* (a ReAct loop that calls tools, with a live step trace, a Stop button, and configurable depth).
- **26 real tools.** Web search, page fetch, filesystem (list/read/write/delete/search), Python & Node code runners, shell, image/vision analysis, memory, Cloudflare, and more.
- **Full-PC access — gated.** A permission system with **Ask** (approve each risky action from your phone) and **Full** modes, plus a **filesystem scope** the agent is confined to.
- **Runtime tool-forging.** The agent writes a new tool as a sandboxed JS function (`node:vm`), and it joins its toolset for the session.
- **88-skill library.** A bundled catalog of capability guides (social, cloud/devops, media, productivity…) the agent can `skill_search` and `skill_load`.
- **Environment-aware.** The agent's system prompt is regenerated every turn with live data: model, endpoint, time of day, host, scope, permission mode, tool/skill counts.
- **Secure & always-on.** PIN login (scrypt + HMAC sessions), runs as a systemd service, reachable privately over Tailscale.
- **Mobile-first UI.** Tuned for the Pixel 9 Pro XL: model picker, temperature, permissions, saved chats, skills browser, approval prompts, image upload.

## Quick start

```bash
# 1. Build
npm install
npx tsc

# 2. Provide an NVIDIA NIM key (free at build.nvidia.com)
mkdir -p ~/.config/nvidia-nim
echo 'NVIDIA_API_KEY=nvapi-…' > ~/.config/nvidia-nim/env

# 3. (optional) set an admin PIN
AGENTOS_PIN='your-pin' node -e "import('./dist/server/auth.js').then(m=>m.Auth.writeCredential(process.env.AGENTOS_PIN))"

# 4. Run the web platform
node dist/cli.js server            # → http://0.0.0.0:8787
```

Open `http://localhost:8787` (or your Tailscale IP from a phone), enter the PIN, and go.

## CLI

```bash
agentos server [-p 8787] [-m qwen/qwen3.5-397b-a17b]   # web platform
agentos chat                        # terminal chat/agent
agentos tui                         # terminal dashboard
agentos tool list|search|describe|exec <…>
agentos config set-secret <key> <value>
```

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kernel, agent loop, ToolBus, event flow, request lifecycle |
| [docs/API.md](docs/API.md) | Every HTTP/SSE endpoint |
| [docs/TOOLS.md](docs/TOOLS.md) | The 26 tools, skills, and tool-forging |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, permissions, scope, sandboxing, threat model |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | systemd service, Tailscale, updating |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents working on the repo |
| [docs/KERNEL_FR.md](docs/KERNEL_FR.md) | Original kernel/TUI notes (français) |

## Architecture at a glance

```
        Phone browser (Tailscale)
                 │  PIN cookie over the tailnet
                 ▼
   ┌──────────────────────────────┐
   │  node:http + SSE  (server.ts)│
   │  auth · permissions · store  │
   └───────┬──────────────┬───────┘
           │ chat         │ agent
           ▼              ▼
   NVIDIA NIM        AgentLoop (ReAct)
   (stream)          │  buildAgentSystemPrompt (live env)
                     ▼
              PermissionedBus ──gate──► approval prompt (Ask mode)
                     │
                     ▼
                 ToolBus ──► 26 tools · forge · 88 skills
```

## Credits

- Runtime tool-forging is adapted from **[@framers/agentos](https://github.com/framerslab/agentos)** (Apache-2.0).
- The bundled skills catalog is **[@framers/agentos-skills](https://github.com/framerslab/agentos-skills)** (Apache-2.0); see `skills/NOTICE`.
- Model inference via **[NVIDIA NIM](https://build.nvidia.com)**.

## License

See [LICENSE](LICENSE). Bundled skills retain their Apache-2.0 license under `skills/`.
