# CODEX.md

This repository follows **[AGENTS.md](./AGENTS.md)** — read it first for the project
map, build/run commands, coding conventions, and gotchas.

## OpenAI Codex specifics

- Language: TypeScript, ESM (`"type": "module"`), `module: NodeNext`. Import local
  files with a `.js` suffix even from `.ts` sources. Node ≥ 22.
- Build: `npx tsc` → `dist/`. There is no bundler; `dist/` is the run artifact.
- Entry point: `src/cli.ts` (commander). The web server is `src/server/server.ts`.
- When adding capabilities, add a `Tool` in `src/tools/` and register it in both
  `src/server/server.ts` and `src/cli.ts`. Set `riskLevel` correctly — it gates the
  human approval flow.
- Never interpolate untrusted strings into a shell (`exec`); use `execFile`/`fetch`.
- Keep changes minimal and typed; run `npx tsc` to verify before finishing.
