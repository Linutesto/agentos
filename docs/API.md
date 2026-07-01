# HTTP / SSE API

Base URL: `http://<host>:8787`. All routes except the auth ones require a valid
`agentos_sess` cookie (obtained via `POST /api/login`). Unauthenticated `/api/*`
requests return `401`; unauthenticated page requests are served the login page.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/login` | `{ "pin": "…" }` | Sets `agentos_sess` httpOnly cookie (30d). 401 on wrong PIN; per-IP lockout after 5 fails. |
| POST | `/api/logout` | — | Clears the cookie. |
| GET  | `/api/auth` | — | `{ enabled, authed }`. |

## Meta

| Method | Path | Returns |
|---|---|---|
| GET | `/api/info` | `{ defaultModel, provider }` |
| GET | `/api/models` | `{ models: [{id,name}] }` (cached 5 min) |
| GET | `/api/tools` | `{ tools: [{name,description,riskLevel,enabled}] }` |
| POST | `/api/tools/toggle` | `{name, enabled}` → updated tool list |

## Settings (permissions + scope)

| Method | Path | Body / Returns |
|---|---|---|
| GET | `/api/settings` | `{ mode, scope, home }` |
| POST | `/api/settings` | `{ mode?: "ask"|"full", scope?: string }` → new state (persisted) |

## Approvals

| Method | Path | Body |
|---|---|---|
| POST | `/api/approve` | `{ id, decision: "approve"|"deny" }` — answers an `approval` SSE event |

## Conversations

| Method | Path | Notes |
|---|---|---|
| GET | `/api/conversations` | list `{id,title,model,mode,updated}` |
| POST | `/api/conversations` | save `{id,title,mode,model,messages}` |
| GET | `/api/conversations/:id` | full conversation |
| DELETE | `/api/conversations/:id` | delete |

## Skills

| Method | Path | Notes |
|---|---|---|
| GET | `/api/skills` | `{ count, skills:[{name,description,category}] }` |
| GET | `/api/skills?q=…` | ranked search |
| GET | `/api/skills/:name` | `{ name, category, instructions }` (SKILL.md body) |

## Chat (SSE)

`POST /api/chat` — body `{ model, messages:[{role,content}], temperature? }`.
`content` may be a string or an array of `{type:"text"|"image_url", …}` for vision.

Streamed events (`data: {…}\n\n`):
- `{type:"token", text}` — a content delta
- `{type:"done", finish}` — `finish:"length"` means truncated
- `{type:"error", error}`

## Agent (SSE)

`POST /api/agent` — body `{ model, prompt, history?, temperature?, maxSteps? }`
(`maxSteps` 4–60, default 20). Close the connection to cancel the run.

Streamed events:
- `{type:"thinking", iter}` — model call N started
- `{type:"tool", phase:"start", name, args}`
- `{type:"tool", phase:"done", name, result}` / `phase:"error", error`
- `{type:"approval", id, name, args, risk}` — **Ask mode**: reply via `POST /api/approve`
- `{type:"final", status, content, iterations}` — `status: success|failed|timeout|cancelled`
- `{type:"error", error}`
