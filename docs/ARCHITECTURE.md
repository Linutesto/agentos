# Architecture

AgentOS is a small, dependency-light kernel. LLMs act as clients that make "syscalls"
through a ToolBus; a web server wraps the kernel with streaming and a mobile UI.

## Core components

- **ToolBus** (`bus/toolbus.ts`) — dynamic registry of `Tool`s with `riskLevel`,
  per-tool `timeout`, enable/disable, search/describe, and an audit log. `execute()`
  races the tool against its timeout.
- **EventBus** (`bus/eventbus.ts`) — typed pub/sub with a `*` wildcard. Tool and model
  lifecycle events (`tool.started`, `tool.finished`, `model.called`, …) flow here; the
  server forwards them to the browser as SSE for the live agent trace.
- **AgentLoop** (`agent/loop.ts`) — a ReAct loop. Each turn the model must emit one JSON
  object: either `{"tool","args"}` or `{"type":"final","content"}` (strict parser in
  `agent/parser.ts`). Includes an error budget, a no-progress detector, `maxIterations`,
  and cancellation via an `AbortSignal`.
- **System prompt** (`agent/prompt.ts`) — `buildAgentSystemPrompt()` regenerates the
  prompt **every turn** with live environment data (host/OS, time of day, model,
  endpoint, temperature, filesystem scope, permission mode, tool + skill counts) and the
  full live tool schemas. This is what makes the agent environment-aware.
- **Providers** (`providers/*`) — `nvidia.ts` is primary (NVIDIA NIM, OpenAI-compatible):
  streaming chat, non-streaming chat (for the loop), `models()`, hard + idle timeouts,
  image content passthrough. `openai/gemini/ollama/cloudflare-ai` also exist.

## Server (`server/server.ts`)

A `node:http` server with SSE. Responsibilities:

1. **Auth gate** (`server/auth.ts`) on every request.
2. **Static** serving of `web/` (path-traversal guarded).
3. **Chat** — streams `provider.chatStream` tokens to the client.
4. **Agent** — builds a per-request `PermissionedBus` (see below) + `AgentLoop`, subscribes
   to the EventBus, and streams the step trace + final answer. Client disconnect aborts
   the run.
5. **Settings/tools/skills/conversations** endpoints.

## Permission flow (`server/permissions.ts`)

```
agent wants to call a tool
   │
   ▼
PermissionedBus.execute(name, args)
   │  gate:
   │  1. path arg outside scope?           → reject
   │  2. mode==full OR riskLevel==low?      → run
   │  3. else emit SSE {approval,id} and await POST /api/approve
   ▼
real ToolBus.execute(name, args)
```

`PermissionManager` holds `mode` (`ask`|`full`) and a filesystem `scope`, persisted to
`~/.config/agentos/settings.json`.

## Request lifecycle (agent turn)

```
POST /api/agent ─► auth ─► build live system prompt ─► AgentLoop.run(seed)
  └► loop: model → parse JSON → PermissionedBus.execute → observation → repeat
       every step emits SSE (thinking / tool / approval)
  └► final answer streamed as {type:"final"}
```

## Persistence

- `memory/sqlite.ts` — `node:sqlite` event/memory log (`~/.config/agentos/memory.db`).
- `server/store.ts` — saved conversations (`~/.config/agentos/conversations.json`).
- Forged tools and skill loads are session-scoped (gone on restart).

## Frontend (`web/`)

Vanilla JS, no framework. `app.js` holds all state, renders streaming markdown, the agent
trace, the approval modal, and the control/skills/model sheets. Talks to the API with
`fetch` + SSE parsing. Designed mobile-first (Pixel 9 Pro XL).
