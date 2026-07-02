import { randomUUID } from 'node:crypto';
import { Tool, ToolBus } from '../bus/toolbus.js';
import { EventBus, AgentEvent } from '../bus/eventbus.js';
import { AgentLoop, ChatMessage } from '../agent/loop.js';
import { buildAgentSystemPrompt, AgentEnv } from '../agent/prompt.js';
import { NvidiaProvider } from '../providers/nvidia.js';
import {
  AgentRole, AgentStatus, Budget, SubAgent, TaskAnalysis, Plan, PlanTask, OrchEvent, RunStats,
} from './types.js';
import { ROLES, roleList, isRole } from './roles.js';

export interface OrchestratorConfig {
  tools: Tool[];
  provider: NvidiaProvider;
  model: string;
  env: AgentEnv;                                   // for the leaf ReAct prompt (scope/mode/…)
  emit: (ev: OrchEvent) => void;                   // stream to dashboard
  wrapBus?: (bus: ToolBus) => ToolBus;             // apply permission gate to a scoped bus
  signal?: AbortSignal;
  budget?: Partial<Budget>;
  forceDecompose?: boolean;                        // always split the root goal into sub-agents
  review?: boolean;                                // review producer artifacts (default true)
  maxFixCycles?: number;                           // review→fix iterations (default 1)
  costPerMTok?: number;                            // $ per 1M tokens for the cost estimate
}

const DEFAULT_BUDGET: Budget = { maxTokens: 400_000, maxChildren: 6, maxDepth: 3, timeMs: 8 * 60_000 };

/** Find and parse the first balanced JSON value in a model reply. */
function extractJson<T = any>(text: string): T | null {
  const a = text.indexOf('{');
  const b = text.indexOf('[');
  const starts = [a, b].filter((i) => i >= 0);
  if (!starts.length) return null;
  const s = Math.min(...starts);
  const open = text[s];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const raw = text.slice(s, i + 1);
        try { return JSON.parse(raw); }
        catch { try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
      }
    }
  }
  return null;
}

export class Orchestrator {
  private cfg: OrchestratorConfig;
  private budget: Budget;
  private agents = new Map<string, SubAgent>();
  private start = 0;
  private tokensUsed = 0;

  constructor(cfg: OrchestratorConfig) {
    this.cfg = cfg;
    this.budget = { ...DEFAULT_BUDGET, ...(cfg.budget || {}) };
  }

  // ---- lifecycle ----
  private now() { return Date.now(); }
  private overTime() { return this.now() - this.start > this.budget.timeMs; }
  private aborted() { return this.cfg.signal?.aborted; }

  private stats(): RunStats {
    const a = [...this.agents.values()];
    const now = this.now();
    const active = a.filter((x) => ['running', 'planning', 'reviewing'].includes(x.status));
    // Bottleneck = the active agent that has been running the longest.
    let bottleneck: RunStats['bottleneck'] = null;
    for (const x of active) {
      const el = now - x.createdAt;
      if (!bottleneck || el > bottleneck.elapsedMs) bottleneck = { id: x.id, role: x.role, goal: x.goal.slice(0, 60), elapsedMs: el };
    }
    const rate = this.cfg.costPerMTok ?? 0; // NIM free tier → 0 by default
    return {
      total: a.length,
      running: active.length,
      queued: a.filter((x) => x.status === 'pending' || x.status === 'waiting').length,
      done: a.filter((x) => x.status === 'done').length,
      failed: a.filter((x) => x.status === 'failed' || x.status === 'cancelled').length,
      tokensUsed: this.tokensUsed,
      costUsd: (this.tokensUsed / 1_000_000) * rate,
      maxDepthReached: a.reduce((m, x) => Math.max(m, x.depth), 0),
      elapsedMs: now - this.start,
      bottleneck,
    };
  }

  private setStatus(ag: SubAgent, status: AgentStatus, note?: string) {
    ag.status = status; if (note) ag.note = note;
    this.cfg.emit({ type: 'agent.status', id: ag.id, status, note });
    this.cfg.emit({ type: 'stats', stats: this.stats() });
  }

  private newAgent(goal: string, role: AgentRole, depth: number, parentId: string | null): SubAgent {
    const ag: SubAgent = {
      id: randomUUID().slice(0, 8), parentId, goal, role, status: 'pending', depth,
      budget: this.budget, allowedTools: this.allowedToolNames(role), children: [],
      tokensUsed: 0, createdAt: this.now(),
    };
    this.agents.set(ag.id, ag);
    if (parentId) this.agents.get(parentId)?.children.push(ag.id);
    this.cfg.emit({ type: 'agent.created', agent: ag });
    return ag;
  }

  private allowedToolNames(role: AgentRole): string[] {
    const def = ROLES[role];
    return this.cfg.tools.filter((t) => def.allow(t.name, t.tags)).map((t) => t.name);
  }

  // ---- LLM helpers (accounted) ----
  private async llm(messages: ChatMessage[], agent?: SubAgent): Promise<string> {
    const promptChars = messages.reduce((a, m) => a + String((m as any).content).length, 0);
    const out = await this.cfg.provider.chat(messages, this.cfg.model, { signal: this.cfg.signal });
    const t = Math.ceil((promptChars + out.length) / 4);
    this.tokensUsed += t;
    if (agent) { agent.tokensUsed += t; this.cfg.emit({ type: 'agent.tokens', id: agent.id, tokensUsed: agent.tokensUsed }); }
    return out;
  }

  // ---- planning / analysis ----
  private async analyze(goal: string, depth: number, agent: SubAgent): Promise<TaskAnalysis> {
    if (depth >= this.budget.maxDepth) {
      return { difficulty: 0.3, estFiles: 1, estTokens: 4000, estTimeMs: 60000, tools: [], skills: [], risk: 'low', confidence: 0.6, shouldDelegate: false, reason: 'max depth reached — execute directly' };
    }
    const sys = 'You estimate task complexity for an agent OS. Reply with ONLY a JSON object, no prose.';
    const user = `Task: ${goal}\n\nReturn JSON: {"difficulty":0..1,"estFiles":int,"estTokens":int,"estTimeMs":int,"tools":[],"skills":[],"risk":"low|medium|high","confidence":0..1,"shouldDelegate":bool,"reason":"..."}\n"shouldDelegate" = true when the task has multiple distinct deliverables, spans several skills/roles (e.g. research + code + review), or needs many steps. Trivial single-step tasks should NOT delegate.`;
    const out = await this.llm([{ role: 'system', content: sys }, { role: 'user', content: user }], agent);
    const j = extractJson<TaskAnalysis>(out);
    if (!j) return { difficulty: 0.5, estFiles: 1, estTokens: 6000, estTimeMs: 90000, tools: [], skills: [], risk: 'medium', confidence: 0.4, shouldDelegate: false, reason: 'analysis parse failed — execute directly' };
    return j;
  }

  private async plan(goal: string, agent: SubAgent): Promise<Plan> {
    const sys = `You are a Planner for a hierarchical agent OS. Split the goal into a minimal set of subtasks assigned to specialist roles. You never implement. Reply with ONLY JSON.`;
    const user = `Goal: ${goal}\n\nAvailable roles:\n${roleList().join('\n')}\n\nReturn JSON: {"mode":"sequential|parallel|adaptive","tasks":[{"role":"<role>","goal":"<single clear objective>","deps":[<indices of prerequisite tasks>]}]}\nRules: at most ${this.budget.maxChildren} tasks; each task one objective; use deps to order work; prefer parallel where tasks are independent.`;
    const out = await this.llm([{ role: 'system', content: sys }, { role: 'user', content: user }], agent);
    const j = extractJson<Plan>(out);
    if (!j || !Array.isArray(j.tasks) || !j.tasks.length) {
      return { mode: 'sequential', tasks: [{ role: 'worker', goal, deps: [] }] };
    }
    j.tasks = j.tasks.slice(0, this.budget.maxChildren).map((t) => ({
      role: isRole(t.role) ? t.role : 'worker',
      goal: String(t.goal || goal),
      deps: Array.isArray(t.deps) ? t.deps.filter((d) => Number.isInteger(d)) : [],
    }));
    if (!['sequential', 'parallel', 'adaptive'].includes(j.mode)) j.mode = 'adaptive';
    return j;
  }

  // ---- leaf execution (a scoped ReAct agent) ----
  private scopedBus(role: AgentRole, evb: EventBus): ToolBus {
    const def = ROLES[role];
    const bus = new ToolBus(evb);
    for (const t of this.cfg.tools) if (def.allow(t.name, t.tags)) bus.register(t);
    return this.cfg.wrapBus ? this.cfg.wrapBus(bus) : bus;
  }

  private async executeLeaf(agent: SubAgent, context: string): Promise<void> {
    this.setStatus(agent, 'running');
    const evb = new EventBus();
    const fwd = (e: AgentEvent) => {
      if (e.name === 'tool.started') this.cfg.emit({ type: 'agent.tool', id: agent.id, name: e.payload.name, phase: 'start' });
      else if (e.name === 'tool.finished') this.cfg.emit({ type: 'agent.tool', id: agent.id, name: e.payload.name, phase: 'done' });
      else if (e.name === 'tool.failed') this.cfg.emit({ type: 'agent.tool', id: agent.id, name: e.payload.name, phase: 'error' });
    };
    evb.on('*', fwd);
    const scoped = this.scopedBus(agent.role, evb);
    const persona = ROLES[agent.role].persona;
    const sys = `${buildAgentSystemPrompt(scoped, this.cfg.env)}\n\n# YOUR ROLE\n${persona}\n\n# YOUR SINGLE OBJECTIVE\n${agent.goal}\n${context ? `\n# CONTEXT FROM OTHER AGENTS\n${context}\n` : ''}`;

    const loop = new AgentLoop({
      bus: scoped, eventBus: evb, maxIterations: 12, signal: this.cfg.signal,
      chat: (msgs) => this.llm([{ role: 'system', content: sys }, ...msgs], agent),
    });
    const res = await loop.run(agent.goal);
    agent.result = res.finalContent ?? res.error ?? '(no output)';
    agent.confidence = res.status === 'success' ? 0.8 : 0.3;
    if (res.status === 'success') this.finish(agent, 'done');
    else throw new Error(res.error || 'leaf execution failed');
  }

  private finish(agent: SubAgent, status: 'done' | 'failed') {
    agent.finishedAt = this.now();
    agent.summary = (agent.result || '').slice(0, 600);
    this.setStatus(agent, status);
    if (status === 'done') this.cfg.emit({ type: 'agent.done', id: agent.id, summary: agent.summary, confidence: agent.confidence });
    else this.cfg.emit({ type: 'agent.failed', id: agent.id, error: agent.error || 'failed' });
  }

  // ---- integration ----
  private async integrate(parent: SubAgent, children: SubAgent[]): Promise<string> {
    const done = children.filter((c) => c.status === 'done' && c.result);
    if (done.length === 1) return done[0].result!;
    if (!done.length) return children.map((c) => `- ${c.role}: FAILED (${c.error || 'no result'})`).join('\n');
    const integ = this.newAgent(`Integrate results for: ${parent.goal}`, 'integrator', parent.depth + 1, parent.id);
    this.setStatus(integ, 'running');
    const sys = ROLES.integrator.persona + ' Reply with the final merged result only (markdown allowed).';
    const parts = done.map((c) => `## ${c.role} (${c.goal})\n${c.result}`).join('\n\n');
    const out = await this.llm([{ role: 'system', content: sys }, { role: 'user', content: `Goal: ${parent.goal}\n\nSub-agent outputs:\n\n${parts}\n\nMerge into one coherent, complete result.` }], integ);
    integ.result = out;
    this.finish(integ, 'done');
    return out;
  }

  // ---- review → fix ----
  private reviewable(role: AgentRole) {
    return !['reviewer', 'integrator', 'planner', 'root'].includes(role);
  }

  private async reviewArtifact(reviewer: SubAgent, goal: string, artifact: string): Promise<{ approve: boolean; reasons: string }> {
    const sys = ROLES.reviewer.persona + ' Reply with ONLY a JSON object.';
    const user = `Goal:\n${goal}\n\nArtifact to review:\n${artifact.slice(0, 4000)}\n\nReturn JSON: {"approve":bool,"reasons":"concrete, actionable feedback"}. Approve only if the artifact correctly and completely satisfies the goal.`;
    const out = await this.llm([{ role: 'system', content: sys }, { role: 'user', content: user }], reviewer);
    const j = extractJson<{ approve: boolean; reasons: string }>(out);
    // Fail open (approve) if parsing fails, to avoid endless reject loops.
    return { approve: j?.approve !== false, reasons: String(j?.reasons || out).slice(0, 400) };
  }

  /** Review a producer's artifact; on reject spawn a dedicated Fix agent and re-review (bounded). */
  private async reviewLoop(agent: SubAgent): Promise<void> {
    if (this.cfg.review === false || !this.reviewable(agent.role)) return;
    if (this.aborted() || this.overTime()) return;
    const maxCycles = this.cfg.maxFixCycles ?? 1;
    let artifact = agent.result || '';

    for (let cycle = 0; cycle <= maxCycles; cycle++) {
      if (this.aborted() || this.overTime()) return;
      const reviewer = this.newAgent(`Review: ${agent.goal}`, 'reviewer', agent.depth + 1, agent.id);
      this.setStatus(reviewer, 'reviewing');
      const verdict = await this.reviewArtifact(reviewer, agent.goal, artifact);
      reviewer.result = `${verdict.approve ? 'APPROVE' : 'REJECT'} — ${verdict.reasons}`;
      reviewer.confidence = verdict.approve ? 0.9 : 0.5;
      this.finish(reviewer, 'done');
      this.cfg.emit({ type: 'agent.review', id: reviewer.id, target: agent.id, verdict: verdict.approve ? 'approve' : 'reject', reasons: verdict.reasons });

      if (verdict.approve) { agent.note = 'reviewed ✓'; this.cfg.emit({ type: 'agent.status', id: agent.id, status: agent.status, note: agent.note }); return; }
      if (cycle >= maxCycles) { agent.note = 'review unresolved'; this.cfg.emit({ type: 'agent.status', id: agent.id, status: agent.status, note: agent.note }); return; }

      // Rejected → dedicated Fix agent addressing only the reviewer's points.
      const fixer = this.newAgent(`Fix per review: ${agent.goal}`, agent.role, agent.depth + 1, agent.id);
      const ctx = `A reviewer REJECTED the previous attempt.\n\nReviewer feedback:\n${verdict.reasons}\n\nPrevious artifact:\n${artifact.slice(0, 3000)}\n\nFix ONLY the issues the reviewer raised; keep the rest. Produce the corrected artifact.`;
      await this.runWithRecovery(fixer, () => this.executeLeaf(fixer, ctx));
      if (fixer.status === 'done' && fixer.result) { artifact = fixer.result; agent.result = fixer.result; }
      else { agent.note = 'fix agent failed'; return; }
    }
  }

  // ---- recursive node processing ----
  private async node(agent: SubAgent, context: string): Promise<void> {
    if (this.aborted()) { agent.error = 'cancelled'; this.finish(agent, 'failed'); return; }
    if (this.overTime()) { agent.error = 'time budget exceeded'; this.finish(agent, 'failed'); return; }
    if (this.tokensUsed > this.budget.maxTokens) { agent.error = 'token budget exceeded'; this.finish(agent, 'failed'); return; }

    this.setStatus(agent, 'planning');
    const canDelegate = ROLES[agent.role].canDelegate && agent.depth < this.budget.maxDepth;
    let delegate = false;
    if (canDelegate) {
      if (this.cfg.forceDecompose && agent.depth === 0) {
        delegate = true;
      } else {
        const analysis = await this.analyze(agent.goal, agent.depth, agent);
        delegate = analysis.shouldDelegate || analysis.difficulty >= 0.6;
      }
    }

    if (!delegate) {
      await this.runWithRecovery(agent, () => this.executeLeaf(agent, context));
      if (agent.status === 'done') await this.reviewLoop(agent);
      return;
    }

    // Decompose.
    const plan = await this.plan(agent.goal, agent);
    const tasks = plan.tasks;
    const children: SubAgent[] = tasks.map((t) => this.newAgent(t.goal, t.role, agent.depth + 1, agent.id));

    // Run respecting dependencies; independent tasks (parallel/adaptive) run concurrently.
    const doneIdx = new Set<number>();
    const results: (string | null)[] = new Array(tasks.length).fill(null);
    const runOne = async (i: number) => {
      const ctx = tasks[i].deps.map((d) => results[d]).filter(Boolean).map((r, k) => `From dependency ${k + 1}:\n${String(r).slice(0, 1500)}`).join('\n\n');
      await this.runWithRecovery(children[i], () => this.node(children[i], ctx));
      results[i] = children[i].result ?? null;
      doneIdx.add(i);
    };

    const remaining = new Set(tasks.map((_, i) => i));
    while (remaining.size && !this.aborted() && !this.overTime()) {
      const ready = [...remaining].filter((i) => tasks[i].deps.every((d) => doneIdx.has(d)));
      if (!ready.length) { // dependency deadlock — run the rest sequentially
        for (const i of [...remaining]) { await runOne(i); remaining.delete(i); }
        break;
      }
      const batch = plan.mode === 'sequential' ? [ready[0]] : ready;
      await Promise.all(batch.map((i) => runOne(i)));
      batch.forEach((i) => remaining.delete(i));
    }

    this.setStatus(agent, 'reviewing');
    agent.result = await this.integrate(agent, children);
    agent.confidence = children.filter((c) => c.status === 'done').length / Math.max(1, children.length);
    this.finish(agent, 'done');
  }

  /** Retry once on failure, else mark failed — never throw upward (no full-run crash). */
  private async runWithRecovery(agent: SubAgent, fn: () => Promise<void>): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await fn(); return; }
      catch (e: any) {
        agent.error = e?.message || String(e);
        if (attempt < 2 && !this.aborted() && !this.overTime()) { this.setStatus(agent, 'running', `retry after: ${agent.error}`); continue; }
        this.finish(agent, 'failed');
        return;
      }
    }
  }

  // ---- entry point ----
  async run(goal: string): Promise<{ content: string; status: string; stats: RunStats; agents: SubAgent[] }> {
    this.start = this.now();
    const root = this.newAgent(goal, 'root', 0, null);
    await this.node(root, '');
    const stats = this.stats();
    const content = root.result || root.error || '(no output)';
    const status = root.status === 'done' ? 'success' : root.status;
    this.cfg.emit({ type: 'final', content, status, stats });
    return { content, status, stats, agents: [...this.agents.values()] };
  }
}
