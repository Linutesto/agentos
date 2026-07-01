# AGENTS.md — AgentOS

Canonical guide for AI coding agents (Claude Code, Codex, Cursor, etc.) working in
this repository. Human docs live in `README.md` and `docs/`.

## What this is

**AgentOS** is a TypeScript "cognitive kernel" for AI agents plus a **mobile-first
web platform** that runs chat + agentic workflows over the NVIDIA NIM model catalog
(OpenAI-compatible). One agent loop (ReAct), a dynamic ToolBus, permission-gated
full-PC access, runtime tool-forging, and a bundled 88-skill library.

## Layout

```
src/
  cli.ts              # commander CLI: `agentos server|chat|tui|tool|config|...`
  agent/
    loop.ts           # ReAct AgentLoop (JSON protocol, cancellation via AbortSignal)
    parser.ts         # strict JSON action parser
    prompt.ts         # buildAgentSystemPrompt() — LIVE env-aware system prompt
    observation.ts    # observation formatting
  bus/
    toolbus.ts        # Tool registry: register/list/search/describe/execute + risk/timeout
    eventbus.ts       # typed event bus with '*' wildcard (drives SSE trace)
  providers/
    nvidia.ts         # NVIDIA NIM: streaming + models() + timeouts (main provider)
    openai.ts gemini.ts ollama.ts cloudflare-ai.ts
  tools/              # each file exports Tool objects (see "Adding a tool")
    bash curl websearch filesystem code vision forge skills memory bus cloudflare
  server/
    server.ts         # node:http + SSE web server (all /api/* endpoints)
    auth.ts           # scrypt PIN + HMAC session tokens
    permissions.ts    # PermissionManager (mode: ask|full, filesystem scope)
    store.ts          # conversation persistence (JSON)
  skills/registry.ts  # loads the bundled skills catalog
  memory/sqlite.ts    # node:sqlite persistence
web/                  # vanilla mobile UI (index.html, app.js, style.css, login.html)
skills/               # bundled agentos-skills catalog (Apache-2.0, 88 SKILL.md)
dist/                 # tsc output (do not edit)
```

## Build / run / test

```bash
npx tsc                      # build (ESM, NodeNext, strict) → dist/
npm test                     # if tests are present
node dist/cli.js server      # run the web platform (port 8787)
node dist/cli.js tool exec <name> '<json-args>'   # run one tool directly (no perms)
```

The deployed instance runs as a **systemd --user service**:
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)   # needed from a non-login shell
systemctl --user restart agentos            # after every rebuild
journalctl --user -u agentos -f             # logs
```

## Conventions (match the existing code)

- **ESM + NodeNext**: import local files with the `.js` extension (e.g. `'./loop.js'`)
  even though sources are `.ts`. Node ≥ 22 (uses `node:sqlite`, `AbortSignal.any`).
- **Strict TypeScript.** No `any` unless mirroring existing patterns.
- Tools are plain objects implementing the `Tool` interface (`src/bus/toolbus.ts`):
  `{ name, description, tags, riskLevel, schema, timeout?, execute }`.
- **`riskLevel` drives the permission gate**: `low` runs unprompted; `medium`/`high`
  require approval in Ask mode. Set it honestly (writes/exec = high, http = medium,
  reads/search = low).
- **No shell string interpolation.** Use `execFile`/`fetch`, never `exec(\`... ${x}\`)`.
  (Two command-injection bugs were fixed this way — don't reintroduce them.)
- Secrets/keys never in source. NVIDIA key: `~/.config/nvidia-nim/env`. Auth hash:
  `~/.config/agentos/auth.json` (mode 600).

## Adding a tool (the extension point)

1. Create `src/tools/mytool.ts` exporting a `Tool` (copy `filesystem.ts`).
2. Register it in **both** `src/server/server.ts` and `src/cli.ts`.
3. It auto-appears in the agent's system prompt, the `/api/tools` list, the UI drawer,
   and the permission gating — no other wiring needed.

## Gotchas

- After changing server/tool code you MUST `npx tsc && systemctl --user restart agentos`;
  the browser serves `web/` fresh (no rebuild needed for UI-only changes).
- The agent system prompt is rebuilt every turn (`buildAgentSystemPrompt`) with live
  data (model, time, scope, mode, counts) — keep it accurate if you add capabilities.
- `meta/llama-3.3-70b-instruct` on NIM intermittently hangs; providers have timeouts.
- Reasoning models (deepseek-v4, some qwen) are slow to first token.
- Do not commit or push unless explicitly asked.
