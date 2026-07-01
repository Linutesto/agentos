# Tools, Skills & Forging

## The tool catalog (26)

| Tool | Risk | Purpose |
|---|---|---|
| `web_search` | low | DuckDuckGo search (no key) → title/url/snippet |
| `fetch_url` | low | Fetch a page/API → readable text |
| `fs_list` | low | List a directory |
| `fs_read` | low | Read a text file |
| `fs_search` | low | ripgrep/grep across a directory (no shell — execFile) |
| `fs_write` | high | Write/append a file (creates dirs) |
| `fs_delete` | high | Delete a file/dir (recursive) |
| `python` | high | Run a Python 3 snippet, capture stdout/stderr |
| `node` | high | Run a Node.js (ESM) snippet |
| `bash` | high | Run a shell command |
| `curl` | medium | HTTP request via fetch (no shell) → status/headers/body |
| `analyze_image` | low | Vision model describes an image (URL or data URI) |
| `forge_tool` | high | Create a new sandboxed tool at runtime (see below) |
| `skill_search` | low | Search the 88-skill library |
| `skill_load` | low | Load a skill's full instructions |
| `memory.search` / `memory.write` | low/medium | Persistent key/value memory |
| `bus.search` / `bus.describe` | low | Introspect the tool catalog |
| `cloudflare.*` | low–high | Verify token, list accounts/zones/workers, DNS list/create/delete |

`riskLevel` drives the permission gate: `low` runs unprompted, `medium`/`high` require
approval in **Ask** mode. See [SECURITY.md](SECURITY.md).

## Skills (88)

The bundled catalog (`skills/`, from [@framers/agentos-skills](https://github.com/framerslab/agentos-skills),
Apache-2.0) is a set of `SKILL.md` capability guides across social media, cloud/devops,
media generation, productivity, security, and comms.

Agent workflow:
1. `skill_search("post to bluesky")` → ranked matches.
2. `skill_load("bluesky-bot")` → the full instructions.
3. The agent follows them using its other tools (`bash`, `curl`, `fs_*`, …).

Browse them in the UI: **⚙ → Browse skills**, or `GET /api/skills`.

## Tool-forging

`forge_tool` lets the agent extend itself. It supplies `name`, `description`, an
`input_schema`, and JS `code` defining `async function execute(input)`. The code is:

1. **Statically screened** — rejects `require`, `process`, `eval`, `Function`, `import`,
   `child_process`, `fs`, `globalThis`, `Reflect`, `WebAssembly`, etc.
2. **Compiled** to surface syntax errors at forge time.
3. **Run in a hardened `node:vm`** — `codeGeneration: {strings:false, wasm:false}`,
   minimal globals (`JSON`, `Math`, `Date`, `URL`, `TextEncoder`, …) plus an allowlisted
   `fetch` with a 12s timeout. No filesystem, no process, no require.

The forged tool registers on the ToolBus (risk `medium`) and is callable for the rest of
the session. It disappears on restart.

Adapted from [@framers/agentos](https://github.com/framerslab/agentos) `SandboxedToolForge` (Apache-2.0).

## Adding a built-in tool

Create `src/tools/mytool.ts` exporting a `Tool`, then register it in `src/server/server.ts`
and `src/cli.ts`. It auto-appears in the system prompt, `/api/tools`, the UI, and gating.
Never interpolate untrusted input into a shell — use `execFile`/`fetch`.
