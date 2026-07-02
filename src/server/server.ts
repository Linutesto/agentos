import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { ToolBus, Tool } from '../bus/toolbus.js';
import { EventBus, AgentEvent } from '../bus/eventbus.js';
import { Orchestrator } from '../orch/orchestrator.js';
import { MemoryDatabase } from '../memory/sqlite.js';
import { AgentLoop, ChatMessage } from '../agent/loop.js';
import { buildAgentSystemPrompt } from '../agent/prompt.js';
import { NvidiaProvider } from '../providers/nvidia.js';
import { PermissionManager, PermMode, pathArg } from './permissions.js';
import { ConversationStore } from './store.js';
import { Auth } from './auth.js';

import { bashTool } from '../tools/bash.js';
import { curlTool } from '../tools/curl.js';
import { webTools } from '../tools/websearch.js';
import { filesystemTools } from '../tools/filesystem.js';
import { codeTools } from '../tools/code.js';
import { createVisionTool } from '../tools/vision.js';
import { createForgeTool } from '../tools/forge.js';
import { createSkillTools } from '../tools/skills.js';
import { SkillRegistry } from '../skills/registry.js';
import { cloudflareTools } from '../tools/cloudflare.js';
import { createMemorySearchTool, createMemoryWriteTool } from '../tools/memory.js';
import { createBusSearchTool, createBusDescribeTool } from '../tools/bus.js';
import { credentialTools } from '../tools/credentials.js';
import { browserTools } from '../tools/browser.js';
import { createAliasTools } from '../tools/aliases.js';
import { createSkillDependencyTool } from '../tools/skilldeps.js';
import { githubTools } from '../tools/github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '../../web');
const SETTINGS_FILE = path.join(os.homedir(), '.config', 'agentos', 'settings.json');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

interface ServerOptions {
  apiKey: string;
  port: number;
  host: string;
  defaultModel: string;
}

/** A ToolBus wrapper that runs a permission gate before each execution. */
class PermissionedBus extends ToolBus {
  constructor(private inner: ToolBus, private gate: (n: string, a: any) => Promise<void>) {
    super();
  }
  async execute(name: string, args: any) {
    await this.gate(name, args);
    return this.inner.execute(name, args);
  }
  list() { return this.inner.list(); }
  search(q: string) { return this.inner.search(q); }
  describe(n: string) { return this.inner.describe(n); }
  enable(n: string) { this.inner.enable(n); }
  disable(n: string) { this.inner.disable(n); }
}

export function startServer(opts: ServerOptions) {
  const eventBus = new EventBus();
  const db = new MemoryDatabase(eventBus);
  const provider = new NvidiaProvider({ apiKey: opts.apiKey, model: opts.defaultModel, timeoutMs: 90000 });
  const store = new ConversationStore();
  const perms = new PermissionManager();
  const auth = new Auth();
  const skills = new SkillRegistry();

  // Load persisted permission settings.
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (s.mode) perms.setMode(s.mode);
    if (s.scope) perms.setScope(s.scope);
  } catch {}
  const savePerms = () => {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(perms.state()));
    } catch {}
  };

  const bus = new ToolBus(eventBus);
  // Full tool registry as an array (reused by the orchestrator for role-scoped buses).
  const allTools: Tool[] = [
    bashTool,
    curlTool,
    ...webTools,
    ...filesystemTools,
    ...codeTools,
    createVisionTool(provider),
    createForgeTool(bus),
    ...createSkillTools(skills),
    createBusSearchTool(bus),
    createBusDescribeTool(bus),
    createMemorySearchTool(db),
    createMemoryWriteTool(db),
    ...credentialTools,
    ...browserTools,
    ...githubTools,
    ...cloudflareTools,
    ...createAliasTools(bus),
    createSkillDependencyTool(bus),
  ];
  for (const t of allTools) bus.register(t);

  const disabled = new Set<string>();
  const pendingApprovals = new Map<string, (decision: string) => void>();
  let modelCache: { at: number; data: any[] } | null = null;

  // ---------- helpers ----------
  const send = (res: http.ServerResponse, code: number, body: any, ctype = 'application/json') => {
    res.writeHead(code, { 'Content-Type': ctype });
    res.end(ctype === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req: http.IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 30_000_000) reject(new Error('body too large'));
      });
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
      });
    });
  const sseInit = (res: http.ServerResponse) =>
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  const sseSend = (res: http.ServerResponse, obj: any) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* client gone */ }
  };
  const toolList = () => bus.list().map((t) => ({ ...t, enabled: !disabled.has(t.name) }));

  const serveStatic = (res: http.ServerResponse, urlPath: string) => {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const full = path.resolve(WEB_DIR, rel);
    if (!full.startsWith(WEB_DIR)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(full, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      send(res, 200, buf, MIME[path.extname(full)] || 'application/octet-stream');
    });
  };

  // Ask the connected client to approve an action; resolves on /api/approve.
  const requestApproval = (res: http.ServerResponse, info: any): Promise<string> => {
    const id = randomUUID();
    sseSend(res, { type: 'approval', id, ...info });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovals.delete(id);
        resolve('timeout');
      }, 180000);
      pendingApprovals.set(id, (d) => {
        clearTimeout(timer);
        pendingApprovals.delete(id);
        resolve(d);
      });
    });
  };

  // Build the permission gate for one agent run bound to its SSE stream.
  const makeGate = (res: http.ServerResponse) => async (name: string, args: any) => {
    const target = pathArg(args);
    if (target && !perms.inScope(target)) {
      throw new Error(
        `Blocked by scope: '${target}' is outside the allowed area (${perms.scope}). Widen the scope in Settings to allow.`
      );
    }
    let risk = 'high';
    try { risk = (bus.describe(name) as any).riskLevel; } catch {}
    if (perms.mode === 'full' || risk === 'low') return;
    const decision = await requestApproval(res, { name, args, risk });
    if (decision !== 'approve') {
      throw new Error(`Action '${name}' was denied by the user${decision === 'timeout' ? ' (timed out)' : ''}.`);
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const p = url.pathname;

    try {
      // ---------- auth gate ----------
      const cookies: Record<string, string> = {};
      for (const c of (req.headers.cookie || '').split(';')) {
        const i = c.indexOf('=');
        if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
      }
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

      if (p === '/api/login' && req.method === 'POST') {
        const { pin } = await readBody(req);
        const r = auth.verify(pin, ip);
        if (!r.ok) return send(res, 401, { error: r.error || 'unauthorized' });
        res.setHeader('Set-Cookie', `agentos_sess=${auth.issueToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', 'agentos_sess=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        return send(res, 200, { ok: true });
      }
      if (p === '/api/auth' && req.method === 'GET') {
        return send(res, 200, { enabled: auth.enabled, authed: auth.validToken(cookies['agentos_sess']) });
      }

      if (!auth.validToken(cookies['agentos_sess'])) {
        if (p === '/style.css' || p === '/login.html') return serveStatic(res, p);
        if (p.startsWith('/api/')) return send(res, 401, { error: 'unauthorized' });
        if (req.method === 'GET') return serveStatic(res, '/login.html');
        return send(res, 401, { error: 'unauthorized' });
      }

      // ---------- meta ----------
      if (p === '/api/info' && req.method === 'GET')
        return send(res, 200, { defaultModel: opts.defaultModel, provider: 'nvidia-nim' });

      if (p === '/api/models' && req.method === 'GET') {
        if (!modelCache || Date.now() - modelCache.at > 300_000)
          modelCache = { at: Date.now(), data: await provider.models() };
        return send(res, 200, { models: modelCache.data });
      }

      if (p === '/api/tools' && req.method === 'GET') return send(res, 200, { tools: toolList() });

      if (p === '/api/skills' && req.method === 'GET') {
        const q = url.searchParams.get('q');
        return send(res, 200, { count: skills.count, skills: q ? skills.search(q, 30) : skills.list() });
      }
      if (p.startsWith('/api/skills/') && req.method === 'GET') {
        const name = decodeURIComponent(p.split('/').pop() || '');
        const s = skills.read(name);
        return s ? send(res, 200, s) : send(res, 404, { error: 'not found' });
      }

      if (p === '/api/tools/toggle' && req.method === 'POST') {
        const { name, enabled } = await readBody(req);
        if (enabled) { bus.enable(name); disabled.delete(name); }
        else { bus.disable(name); disabled.add(name); }
        return send(res, 200, { tools: toolList() });
      }

      // ---------- settings (permissions + scope) ----------
      if (p === '/api/settings' && req.method === 'GET')
        return send(res, 200, { ...perms.state(), home: os.homedir() });

      if (p === '/api/settings' && req.method === 'POST') {
        const { mode, scope } = await readBody(req);
        if (mode) perms.setMode(mode as PermMode);
        if (scope) perms.setScope(scope);
        savePerms();
        return send(res, 200, { ...perms.state(), home: os.homedir() });
      }

      // ---------- approvals ----------
      if (p === '/api/approve' && req.method === 'POST') {
        const { id, decision } = await readBody(req);
        const fn = pendingApprovals.get(id);
        if (fn) fn(decision);
        return send(res, 200, { ok: !!fn });
      }

      // ---------- conversations ----------
      if (p === '/api/conversations' && req.method === 'GET')
        return send(res, 200, { conversations: store.list() });
      if (p === '/api/conversations' && req.method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, store.save(body));
      }
      if (p.startsWith('/api/conversations/')) {
        const id = decodeURIComponent(p.split('/').pop() || '');
        if (req.method === 'GET') {
          const c = store.get(id);
          return c ? send(res, 200, c) : send(res, 404, { error: 'not found' });
        }
        if (req.method === 'DELETE') { store.delete(id); return send(res, 200, { ok: true }); }
      }

      // ---------- plain streaming chat ----------
      if (p === '/api/chat' && req.method === 'POST') {
        const { model, messages, temperature } = await readBody(req);
        sseInit(res);
        const ac = new AbortController();
        res.on('close', () => ac.abort());
        try {
          const { finish } = await provider.chatStream(messages as ChatMessage[], {
            model, temperature, signal: ac.signal,
            onToken: (t) => sseSend(res, { type: 'token', text: t }),
          });
          sseSend(res, { type: 'done', finish });
        } catch (e: any) {
          if (!ac.signal.aborted) sseSend(res, { type: 'error', error: e.message });
        }
        return res.end();
      }

      // ---------- agent loop (permission-gated tools) ----------
      if (p === '/api/agent' && req.method === 'POST') {
        const { model, prompt, history, temperature, maxSteps } = await readBody(req);
        sseInit(res);

        const runAc = new AbortController();
        const onClose = () => runAc.abort();
        res.on('close', onClose);
        req.on('aborted', onClose);

        const forward = (ev: AgentEvent) => {
          if (ev.name === 'model.called') sseSend(res, { type: 'thinking', iter: ev.payload.iterations });
          else if (ev.name === 'tool.started')
            sseSend(res, { type: 'tool', phase: 'start', name: ev.payload.name, args: ev.payload.args });
          else if (ev.name === 'tool.finished')
            sseSend(res, { type: 'tool', phase: 'done', name: ev.payload.name, result: ev.payload.result });
          else if (ev.name === 'tool.failed')
            sseSend(res, { type: 'tool', phase: 'error', name: ev.payload.name, error: ev.payload.error });
        };
        eventBus.on('*', forward);

        const gatedBus = new PermissionedBus(bus, makeGate(res));
        const system = buildAgentSystemPrompt(bus, {
          scope: perms.scope,
          mode: perms.mode,
          model: model || opts.defaultModel,
          endpoint: 'NVIDIA NIM (integrate.api.nvidia.com)',
          temperature,
          skillCount: skills.count,
        });
        const steps = Math.min(Math.max(parseInt(maxSteps, 10) || 20, 4), 60);
        const loop = new AgentLoop({
          bus: gatedBus,
          eventBus,
          maxIterations: steps,
          signal: runAc.signal,
          chat: (msgs) =>
            provider.chat([{ role: 'system', content: system }, ...msgs], model, {
              temperature,
              signal: runAc.signal,
            }),
        });

        try {
          const seed = Array.isArray(history) && history.length
            ? `Conversation so far:\n${history.map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[media]'}`).join('\n')}\n\nUser: ${prompt}`
            : prompt;
          const result = await loop.run(seed);
          sseSend(res, {
            type: 'final',
            status: result.status,
            content: result.finalContent ?? result.error ?? '(no output)',
            iterations: result.iterations,
          });
        } catch (e: any) {
          sseSend(res, { type: 'error', error: e.message });
        } finally {
          eventBus.off('*', forward);
        }
        return res.end();
      }

      // ---------- orchestrator (hierarchical multi-agent) ----------
      if (p === '/api/orchestrate' && req.method === 'POST') {
        const { model, goal, budget, decompose, review, maxFixCycles, costPerMTok } = await readBody(req);
        sseInit(res);
        const runAc = new AbortController();
        res.on('close', () => runAc.abort());
        const orch = new Orchestrator({
          tools: allTools,
          provider,
          model: model || opts.defaultModel,
          env: {
            scope: perms.scope,
            mode: perms.mode,
            model: model || opts.defaultModel,
            endpoint: 'NVIDIA NIM (integrate.api.nvidia.com)',
            skillCount: skills.count,
          },
          emit: (ev) => sseSend(res, ev),
          wrapBus: (b) => new PermissionedBus(b, makeGate(res)),
          signal: runAc.signal,
          budget,
          forceDecompose: !!decompose,
          review: review !== false,
          maxFixCycles: typeof maxFixCycles === 'number' ? maxFixCycles : 1,
          costPerMTok: typeof costPerMTok === 'number' ? costPerMTok : 0.15,
        });
        try {
          await orch.run(String(goal || '').trim());
        } catch (e: any) {
          sseSend(res, { type: 'error', error: e.message });
        }
        return res.end();
      }

      if (req.method === 'GET') return serveStatic(res, p);
      return send(res, 404, { error: 'not found' });
    } catch (e: any) {
      if (!res.headersSent) send(res, 500, { error: e.message });
      else res.end();
    }
  });

  server.listen(opts.port, opts.host, () => {
    console.log(`\n  AgentOS Web  →  http://${opts.host}:${opts.port}`);
    console.log(`  Local:        http://localhost:${opts.port}`);
    console.log(`  Default model: ${opts.defaultModel}`);
    console.log(`  Permissions:   ${perms.mode.toUpperCase()}  ·  scope: ${perms.scope}`);
    console.log(`  Tools: ${bus.list().map((t) => t.name).join(', ')}\n`);
  });

  return server;
}
