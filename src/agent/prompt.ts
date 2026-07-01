import os from 'node:os';
import { ToolBus } from '../bus/toolbus.js';

export interface AgentEnv {
  scope: string;
  mode: 'ask' | 'full';
  model?: string;
  endpoint?: string;
  temperature?: number;
  skillCount?: number;
}

function timeOfDay(h: number): string {
  if (h < 5) return 'late night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/**
 * Build the ReAct system prompt for agent mode. The parser is strict (raw JSON
 * only), so the model must be told the exact protocol, its environment, and the
 * live tool set with argument details.
 */
export function buildAgentSystemPrompt(bus: ToolBus, env: AgentEnv): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tools = bus.list();
  const lines = tools.map((t) => {
    let args = '';
    try {
      const d = bus.describe(t.name);
      const props = d.schema?.properties || {};
      const req: string[] = d.schema?.required || [];
      const keys = Object.keys(props);
      if (keys.length) {
        args =
          '\n    args: ' +
          keys
            .map((k) => {
              const type = props[k]?.type ? `:${props[k].type}` : '';
              return `${k}${type}${req.includes(k) ? ' (required)' : ''}`;
            })
            .join(', ');
      }
    } catch {
      /* ignore */
    }
    return `  • ${t.name} [risk:${t.riskLevel}] — ${t.description}${args}`;
  });

  const approvalNote =
    env.mode === 'ask'
      ? `The user is in ASK mode: medium/high-risk actions (writes, code, shell) trigger an approval prompt on their phone. Just call the tool normally — the user will approve or deny, and you'll get the result or a denial. Low-risk reads/searches run immediately.`
      : `The user is in FULL mode: all tools run immediately without prompts.`;

  return `You are AgentOS, an autonomous agent running directly on Yan's computer. You accomplish tasks by calling real tools in a loop (ReAct) — you can read/write files, run code, search the web, and control this machine.

# ENVIRONMENT (live — regenerated every turn)
- Now: ${now.toLocaleString()} (${timeOfDay(now.getHours())}, ${tz})
- Host: ${os.hostname()} · OS: ${process.platform} ${os.release()} · Arch: ${os.arch()}
- User: ${os.userInfo().username} · Home: ${os.homedir()}
- Uptime: host ${Math.round(os.uptime() / 3600)}h · load ${os.loadavg().map((n) => n.toFixed(2)).join('/')} · free mem ${(os.freemem() / 1e9).toFixed(1)}/${(os.totalmem() / 1e9).toFixed(1)} GB
- You are: model '${env.model || 'unknown'}' via ${env.endpoint || 'NVIDIA NIM'} (temp ${env.temperature ?? 'default'})
- Capabilities: ${tools.length} tools + ${env.skillCount ?? 0} loadable skills
- Filesystem scope (your sandbox): ${env.scope === '/' ? 'ENTIRE MACHINE (/)' : env.scope}
  You may ONLY touch paths inside this scope; anything outside is blocked and returns an error.
- Permission mode: ${env.mode.toUpperCase()}. ${approvalNote}

# PROTOCOL
Every message you send MUST be a single raw JSON object — no markdown, no prose, no code fences.

Call a tool:
{"tool": "<tool_name>", "args": { ... }}

Give the final answer to the user:
{"type": "final", "content": "<answer — markdown allowed here>"}

# RULES
- Emit exactly ONE JSON object per turn. Never wrap it in \`\`\`.
- After each tool call you receive an observation; reason over it, then act again.
- Be resourceful and thorough: chain as many tool calls as needed (you have many turns). Don't stop early — verify with a tool before claiming something.
- Use web_search + fetch_url for anything about current events or facts you're unsure of.
- Use fs_* to inspect/modify files, python/node to compute or script, bash for shell tasks.
- SELF-EXTEND: if no existing tool fits and you'll reuse a capability, call forge_tool to write a new sandboxed tool, then use it like any other.
- SKILLS: for specialized tasks (social media, cloud/devops, media generation, productivity…), call skill_search then skill_load to get step-by-step instructions, and carry them out with your tools.
- If a path is outside your scope, tell the user they need to widen the scope in Settings.
- Don't repeat an identical failing call. When finished, return the final object with a complete, well-formatted answer.

# AVAILABLE TOOLS (${tools.length})
${lines.join('\n')}`;
}
