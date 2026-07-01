import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../../skills');

export interface SkillMeta {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  keywords: string[];
  path: string; // relative to skills dir, e.g. registry/curated/1password
}

/**
 * Loads the bundled agentos-skills catalog (Apache-2.0, see skills/NOTICE).
 * The registry.json gives searchable metadata; SKILL.md bodies are the
 * capability instructions the agent reads to accomplish specialized tasks.
 */
export class SkillRegistry {
  private skills: SkillMeta[] = [];

  constructor() {
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, 'registry.json'), 'utf8'));
      // registry.skills is { curated: [...], community: [...] }
      const all = Array.isArray(reg.skills)
        ? reg.skills
        : Object.values(reg.skills || {}).flat();
      this.skills = (all as any[]).map((s: any) => ({
        id: s.id,
        name: s.name,
        displayName: s.displayName || s.name,
        description: s.description || '',
        category: s.category || 'general',
        keywords: s.keywords || [],
        path: s.path,
      }));
    } catch {
      this.skills = [];
    }
  }

  get count() {
    return this.skills.length;
  }

  list(): { name: string; description: string; category: string }[] {
    return this.skills.map((s) => ({ name: s.name, description: s.description, category: s.category }));
  }

  /** Keyword/description ranked search. */
  search(query: string, limit = 8): { name: string; description: string; category: string; score: number }[] {
    const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = this.skills.map((s) => {
      const hay = `${s.name} ${s.displayName} ${s.description} ${s.category} ${s.keywords.join(' ')}`.toLowerCase();
      let score = 0;
      for (const term of q) {
        if (s.name.toLowerCase().includes(term)) score += 5;
        else if (s.keywords.some((k) => k.toLowerCase() === term)) score += 4;
        else if (hay.includes(term)) score += 1;
      }
      return { name: s.name, description: s.description, category: s.category, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Return the full SKILL.md instructions for a skill. */
  read(name: string): { name: string; category: string; instructions: string } | null {
    const skill = this.skills.find((s) => s.name === name || s.id === name);
    if (!skill) return null;
    const file = path.resolve(SKILLS_DIR, skill.path, 'SKILL.md');
    if (!file.startsWith(SKILLS_DIR)) return null; // traversal guard
    try {
      return { name: skill.name, category: skill.category, instructions: fs.readFileSync(file, 'utf8') };
    } catch {
      return null;
    }
  }
}
