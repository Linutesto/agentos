# Multi-Agent Orchestration (Swarm)

A hierarchical execution engine that decomposes a goal into a tree of role-scoped
sub-agents. Each leaf is a permission-gated ReAct agent reusing the normal agent loop.
Source: `src/orch/` (`types.ts`, `roles.ts`, `orchestrator.ts`).

## Flow

```
goal
 └─ Root ── analyze ── delegate? ──no──► execute directly (leaf) ──► review→fix
                        │yes
                        ▼
                     Planner ──► roled subtasks (with deps)
                        │
          sequential / parallel / adaptive execution
                        │
        each subtask ──► (recurse) or leaf ──► review→fix
                        │
                    Integrator ──► merged result
```

- **Task analysis** (LLM) decides *delegate vs execute directly*; `decompose:true`
  forces a tree; delegation also triggers when estimated difficulty ≥ 0.6.
- **Planner** splits the goal into subtasks assigned to roles, with dependencies.
- **Execution** honors deps; independent tasks run concurrently (`parallel`/`adaptive`),
  or one-at-a-time (`sequential`).
- **Integrator** merges child outputs into one coherent result.

## Roles (17)

Each role has a **tool allowlist** enforced by a scoped ToolBus:

| Role | Tools |
|---|---|
| planner | web only (never implements) |
| researcher | web only |
| architect | read-only |
| backend | fs + shell + code + curl + github |
| frontend | fs + code |
| reviewer | read-only |
| debugger / qa / performance / refactorer | fs + code |
| security | read-only |
| devops | shell + fs |
| writer / documentation | read (+ fs for docs) |
| integrator | read-only |
| worker | all |

## Review → Fix loop

Every producer artifact is reviewed. A **Reviewer** agent (read-only) returns
`{approve, reasons}`. On **reject**, a dedicated **Fix agent** is spawned that addresses
only the reviewer's points, then the artifact is re-reviewed — bounded by `maxFixCycles`
(default 1). Parsing failures fail *open* (approve) to avoid endless loops. Disable with
`review:false`.

## Budgets & recovery

- `maxSteps` — total ReAct iterations shared across **all** sub-agents (the Swarm slider,
  100–1000, default 300). Each leaf is sized from the remaining budget, capped at 40
  iterations per leaf.
- `maxDepth` (recursion), `maxChildren` (fan-out), `maxTokens` (accounted), `timeMs`
  (wall-clock). Exceeding any bound stops spawning and finalizes.
- **Failure recovery**: each node retries once, then is marked failed — a failed
  sub-agent never crashes the whole run; the integrator works with what succeeded.

## API

`POST /api/orchestrate` (SSE). Body:
```json
{ "model": "...", "goal": "...", "decompose": true, "review": true,
  "maxFixCycles": 1, "costPerMTok": 0.15,
  "budget": { "maxSteps": 300, "maxDepth": 3, "maxChildren": 6, "maxTokens": 2000000, "timeMs": 1800000 } }
```
Streams `agent.created | agent.status | agent.tokens | agent.tool | agent.review |
agent.done | agent.failed | stats | final`.

## Dashboard (Swarm mode)

Live execution tree (status icons, spinners, collapsible nodes, per-agent tokens +
current tool + review verdict) and a metrics bar: total / running / **queued** / done /
failed / tokens / **estimated cost** / depth / elapsed / **current bottleneck**. A Stop
button aborts the run (closing the SSE stream cancels every sub-agent).

> Cost is an estimate: `tokens/1e6 × costPerMTok` (NIM is free; the figure shows what the
> same run would cost on a paid provider at the given rate).
