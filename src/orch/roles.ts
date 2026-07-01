import { AgentRole } from './types.js';

export interface RoleDef {
  role: AgentRole;
  /** One-line description used by the planner to assign work. */
  blurb: string;
  /** Persona injected into the executor's system prompt. */
  persona: string;
  /** Which tools this role may use (matched by tool name or tag). */
  allow: (name: string, tags: string[]) => boolean;
  /** May this role decompose into sub-agents? */
  canDelegate: boolean;
}

const READ_ONLY = (name: string) =>
  /^(fs_read|fs_list|fs_search|web_search|fetch_url|bus\.|skill_|memory\.search)/.test(name);
const WEB_ONLY = (name: string) => /^(web_search|fetch_url|skill_search|skill_load)$/.test(name);
const NONE = () => false;
const ALL = () => true;

export const ROLES: Record<AgentRole, RoleDef> = {
  root: {
    role: 'root', blurb: 'Top-level coordinator.', canDelegate: true, allow: ALL,
    persona: 'You are the Root coordinator. Decompose and delegate; do not implement directly.',
  },
  planner: {
    role: 'planner', blurb: 'Breaks a goal into an ordered plan of roled subtasks. Never implements.',
    canDelegate: false, allow: (n) => WEB_ONLY(n),
    persona: 'You are a Planner. You analyze the goal and produce a plan. You never write code or touch the filesystem — you only plan.',
  },
  researcher: {
    role: 'researcher', blurb: 'Gathers facts/docs from the web. Read/web only.',
    canDelegate: false, allow: (n) => WEB_ONLY(n),
    persona: 'You are a Researcher. Use web search and page fetches to gather accurate, cited information. Do not modify anything.',
  },
  architect: {
    role: 'architect', blurb: 'Designs structure and interfaces. Read-only.',
    canDelegate: true, allow: (n) => READ_ONLY(n),
    persona: 'You are a Software Architect. Inspect the codebase (read-only) and produce a clear design: modules, interfaces, data flow. Do not implement.',
  },
  backend: {
    role: 'backend', blurb: 'Implements server/API/DB/auth code. Filesystem + shell + code.',
    canDelegate: true, allow: (n, tags) => /^(fs_|bash|python|node|curl|github|credentials)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are a Backend Engineer. Implement server-side code with real tools: read/write files, run code, use the shell. Verify your work before finishing.',
  },
  frontend: {
    role: 'frontend', blurb: 'Implements UI/components/styling/state. Filesystem + code.',
    canDelegate: true, allow: (n, tags) => /^(fs_|node|python)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are a Frontend Engineer. Implement UI, components, styling and state with real file edits. Keep it consistent with the existing code.',
  },
  reviewer: {
    role: 'reviewer', blurb: 'Reviews artifacts; approves or rejects with reasons. Read-only.',
    canDelegate: false, allow: (n) => READ_ONLY(n),
    persona: 'You are a Reviewer. Read the artifact and judge it. Return APPROVE or REJECT with concrete, actionable reasons. You cannot modify anything.',
  },
  debugger: {
    role: 'debugger', blurb: 'Diagnoses and fixes failures. Filesystem + shell + code.',
    canDelegate: false, allow: (n, tags) => /^(fs_|bash|python|node)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are a Debugger. Reproduce the failure, find the root cause with tools, and fix only the broken part.',
  },
  security: {
    role: 'security', blurb: 'Audits for vulnerabilities. Read-only.',
    canDelegate: false, allow: (n) => READ_ONLY(n),
    persona: 'You are a Security Engineer. Audit for injection, auth, secret-handling and unsafe patterns. Report findings; do not change code.',
  },
  devops: {
    role: 'devops', blurb: 'Build/deploy/infra. Shell + filesystem.',
    canDelegate: false, allow: (n) => /^(bash|fs_|github|curl)/.test(n) || READ_ONLY(n),
    persona: 'You are a DevOps Engineer. Handle build, deploy, and infrastructure tasks with the shell and filesystem.',
  },
  writer: {
    role: 'writer', blurb: 'Writes prose/content. Read + web.',
    canDelegate: false, allow: (n) => READ_ONLY(n),
    persona: 'You are a Writer. Produce clear, well-structured prose. Research read-only if needed.',
  },
  qa: {
    role: 'qa', blurb: 'Writes/runs tests. Filesystem + shell + code.',
    canDelegate: false, allow: (n, tags) => /^(fs_|bash|python|node)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are QA. Write and run tests, report pass/fail with evidence.',
  },
  performance: {
    role: 'performance', blurb: 'Profiles and optimizes. Filesystem + shell + code.',
    canDelegate: false, allow: (n, tags) => /^(fs_|bash|python|node)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are a Performance Engineer. Measure first, then optimize the hot path. Show before/after numbers.',
  },
  documentation: {
    role: 'documentation', blurb: 'Writes docs. Filesystem read/write.',
    canDelegate: false, allow: (n) => /^(fs_)/.test(n) || READ_ONLY(n),
    persona: 'You are a Documentation Engineer. Produce accurate docs derived from the real code.',
  },
  refactorer: {
    role: 'refactorer', blurb: 'Refactors without changing behavior. Filesystem + code.',
    canDelegate: false, allow: (n, tags) => /^(fs_|node|python)/.test(n) || tags.includes('code') || READ_ONLY(n),
    persona: 'You are a Refactorer. Improve structure without changing behavior; keep changes minimal and verified.',
  },
  integrator: {
    role: 'integrator', blurb: 'Merges child outputs into one coherent result. Read-only.',
    canDelegate: false, allow: (n) => READ_ONLY(n),
    persona: 'You are the Integrator. Merge the sub-agent outputs into one coherent, complete result. Detect conflicts and resolve them. Do not re-implement.',
  },
  worker: {
    role: 'worker', blurb: 'General worker for tasks that do not fit a specialist.',
    canDelegate: true, allow: ALL,
    persona: 'You are a general Worker. Accomplish the objective with whatever tools are appropriate.',
  },
};

export const roleList = () =>
  (Object.keys(ROLES) as AgentRole[])
    .filter((r) => r !== 'root' && r !== 'integrator')
    .map((r) => `${r}: ${ROLES[r].blurb}`);

export function isRole(x: any): x is AgentRole {
  return typeof x === 'string' && x in ROLES;
}
