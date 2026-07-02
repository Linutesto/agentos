// Hierarchical multi-agent execution engine — core types.

export type AgentRole =
  | 'root'
  | 'planner'
  | 'researcher'
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'reviewer'
  | 'debugger'
  | 'security'
  | 'devops'
  | 'writer'
  | 'qa'
  | 'performance'
  | 'documentation'
  | 'refactorer'
  | 'integrator'
  | 'worker';

export type AgentStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'waiting'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Budget {
  maxSteps: number;    // total LLM/tool iterations across ALL agents
  maxTokens: number;   // token accounting ceiling (estimate)
  maxChildren: number; // fan-out per node
  maxDepth: number;    // recursion depth
  timeMs: number;      // wall-clock ceiling for the whole run
}

export interface SubAgent {
  id: string;
  parentId: string | null;
  goal: string;
  role: AgentRole;
  status: AgentStatus;
  depth: number;
  budget: Budget;
  allowedTools: string[];
  children: string[];
  note?: string;
  summary?: string;   // compact upward-flowing summary
  result?: string;    // full artifact/output
  confidence?: number;
  error?: string;
  tokensUsed: number;
  createdAt: number;
  finishedAt?: number;
}

export interface TaskAnalysis {
  difficulty: number;      // 0..1
  estFiles: number;
  estTokens: number;
  estTimeMs: number;
  tools: string[];
  skills: string[];
  risk: 'low' | 'medium' | 'high';
  confidence: number;      // 0..1
  shouldDelegate: boolean;
  reason: string;
}

export type ExecMode = 'sequential' | 'parallel' | 'adaptive';

export interface PlanTask {
  role: AgentRole;
  goal: string;
  deps: number[]; // indices of tasks that must finish first
}

export interface Plan {
  mode: ExecMode;
  tasks: PlanTask[];
}

// Events streamed to the dashboard.
export type OrchEvent =
  | { type: 'agent.created'; agent: SubAgent }
  | { type: 'agent.status'; id: string; status: AgentStatus; note?: string }
  | { type: 'agent.tokens'; id: string; tokensUsed: number }
  | { type: 'agent.tool'; id: string; name: string; phase: 'start' | 'done' | 'error' }
  | { type: 'agent.review'; id: string; target: string; verdict: 'approve' | 'reject'; reasons: string }
  | { type: 'agent.done'; id: string; summary?: string; confidence?: number }
  | { type: 'agent.failed'; id: string; error: string }
  | { type: 'stats'; stats: RunStats }
  | { type: 'final'; content: string; status: string; stats: RunStats };

export interface Bottleneck {
  id: string;
  role: AgentRole;
  goal: string;
  elapsedMs: number;
}

export interface RunStats {
  total: number;
  running: number;
  queued: number;      // pending/waiting on dependencies
  done: number;
  failed: number;
  tokensUsed: number;
  costUsd: number;     // estimate
  stepsUsed: number;   // total iterations consumed
  maxSteps: number;    // step budget
  maxDepthReached: number;
  elapsedMs: number;
  bottleneck: Bottleneck | null; // longest currently-running agent
}
