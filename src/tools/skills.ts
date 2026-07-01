import { Tool } from '../bus/toolbus.js';
import { SkillRegistry } from '../skills/registry.js';

/**
 * Two tools that expose the bundled skills catalog to the agent:
 *  - skill_search: find skills relevant to a task
 *  - skill_load:   fetch a skill's full instructions to follow
 */
export function createSkillTools(registry: SkillRegistry): Tool[] {
  const searchTool: Tool = {
    name: 'skill_search',
    description: `Search the skill library (${registry.count} skills covering social media, cloud/devops, media generation, productivity, security, comms, etc.) for guidance on how to accomplish a specialized task. Returns matching skill names + descriptions.`,
    tags: ['skills', 'discovery', 'meta'],
    riskLevel: 'low',
    timeout: 5000,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do (e.g. "post to bluesky", "transcode video")' },
        limit: { type: 'number', description: 'Max results (default 8)' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string; limit?: number }) => ({
      query: args.query,
      results: registry.search(args.query, args.limit ?? 8),
    }),
  };

  const loadTool: Tool = {
    name: 'skill_load',
    description:
      'Load the full instructions for a skill (from skill_search). Returns a guide you should read and follow, using your other tools (bash, curl, fs_*, etc.) to carry out the steps.',
    tags: ['skills', 'meta'],
    riskLevel: 'low',
    timeout: 5000,
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name to load' } },
      required: ['name'],
    },
    execute: async (args: { name: string }) => {
      const skill = registry.read(args.name);
      if (!skill) return { error: `Skill '${args.name}' not found. Use skill_search first.` };
      return skill;
    },
  };

  return [searchTool, loadTool];
}
