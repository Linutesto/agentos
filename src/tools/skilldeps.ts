import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Tool, ToolBus } from '../bus/toolbus.js';
import { getSecret } from '../config/secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.resolve(__dirname, '../../skills/registry/curated');

interface SkillDeps {
  name: string;
  tools: string[];
  secrets: string[];
  bins: string[];
}

function parseList(src: string, key: string): string[] {
  const values = new Set<string>();
  const inline = src.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'm'));
  if (inline) {
    for (const raw of inline[1].split(',')) {
      const v = raw.trim().replace(/^['"]|['"]$/g, '');
      if (v) values.add(v);
    }
  }
  const block = src.match(new RegExp(`${key}:\\s*\\n((?:\\s+-\\s*[^\\n]+\\n?)+)`, 'm'));
  if (block) {
    for (const line of block[1].split('\n')) {
      const v = line.replace(/^\s+-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      if (v) values.add(v);
    }
  }
  return [...values].sort();
}

function parseSkill(file: string): SkillDeps {
  const txt = fs.readFileSync(file, 'utf8');
  const frontmatter = txt.match(/^---\n([\s\S]*?)\n---/)?.[1] || txt.slice(0, 1600);
  const name = (frontmatter.match(/^name:\s*([^\n]+)/m)?.[1] || path.basename(path.dirname(file)))
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const bins = new Set(parseList(frontmatter, 'bins'));
  for (const match of frontmatter.matchAll(/bins:\s*\[([^\]]*)\]/g)) {
    for (const raw of match[1].split(',')) {
      const v = raw.trim().replace(/^['"]|['"]$/g, '');
      if (v) bins.add(v);
    }
  }
  for (const match of frontmatter.matchAll(/env:\s*\[([^\]]*)\]/g)) {
    for (const raw of match[1].split(',')) {
      const v = raw.trim().replace(/^['"]|['"]$/g, '');
      if (v) parseList(frontmatter, 'requires_secrets').push(v);
    }
  }
  return {
    name,
    tools: parseList(frontmatter, 'requires_tools'),
    secrets: [...new Set([...parseList(frontmatter, 'requires_secrets'), ...parseList(frontmatter, 'env')])].sort(),
    bins: [...bins].sort(),
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

function hasBin(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function hasSecret(key: string): Promise<boolean> {
  if (await getSecret(key)) return true;
  const envName = key.replace(/[.-]/g, '_').toUpperCase();
  if (process.env[envName]) return true;
  if (key === 'github.token') {
    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return true;
    try {
      execFileSync('gh', ['auth', 'token'], { stdio: 'ignore' });
      return true;
    } catch {}
  }
  return false;
}

export function createSkillDependencyTool(bus: ToolBus): Tool {
  return {
    name: 'skill_dependencies',
    description:
      'Report whether a skill has its declared tools, credentials, and command-line binaries available in this AgentOS runtime.',
    tags: ['skills', 'diagnostics', 'setup'],
    riskLevel: 'low',
    timeout: 10000,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional skill name. Omit for a global summary.' },
      },
    },
    execute: async (args: { name?: string }) => {
      const registered = new Set(bus.list().map((t) => t.name));
      const skills = walk(SKILLS_ROOT).map(parseSkill);
      const selected = args.name ? skills.filter((s) => s.name === args.name) : skills;
      const rows = await Promise.all(
        selected.map(async (s) => {
          const missingTools = s.tools.filter((t) => !registered.has(t));
          const missingSecrets = (
            await Promise.all(s.secrets.map(async (key) => ({ key, exists: await hasSecret(key) })))
          )
            .filter((x) => !x.exists)
            .map((x) => x.key);
          const missingBins = s.bins.filter((b) => !hasBin(b));
          return {
            name: s.name,
            ok: missingTools.length === 0 && missingSecrets.length === 0 && missingBins.length === 0,
            tools: { declared: s.tools.length, missing: missingTools },
            secrets: { declared: s.secrets.length, missing: missingSecrets },
            bins: { declared: s.bins.length, missing: missingBins },
          };
        })
      );
      if (args.name) return rows[0] || { error: `Skill '${args.name}' not found.` };
      const ready = rows.filter((r) => r.ok).length;
      return {
        total: rows.length,
        ready,
        blocked: rows.length - ready,
        mostBlocked: rows
          .filter((r) => !r.ok)
          .sort(
            (a, b) =>
              b.tools.missing.length +
              b.secrets.missing.length +
              b.bins.missing.length -
              (a.tools.missing.length + a.secrets.missing.length + a.bins.missing.length)
          )
          .slice(0, 20),
      };
    },
  };
}
