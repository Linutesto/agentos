import { Tool, ToolBus } from '../bus/toolbus.js';

function aliasTool(
  name: string,
  target: string,
  description: string,
  schema: Tool['schema'],
  mapArgs: (args: any) => any = (args) => args,
  riskLevel: Tool['riskLevel'] = 'low'
): Tool {
  return {
    name,
    description,
    tags: ['alias', target],
    riskLevel,
    schema,
    execute: async (args: any) => busRef!.execute(target, mapArgs(args)),
  };
}

let busRef: ToolBus | null = null;

export function createAliasTools(bus: ToolBus): Tool[] {
  busRef = bus;
  return [
    aliasTool(
      'web-search',
      'web_search',
      'Compatibility alias for skills that refer to web-search. Searches the web.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum results' },
        },
        required: ['query'],
      },
      (a) => ({ query: a.query, maxResults: a.maxResults ?? a.limit }),
      'low'
    ),
    aliasTool(
      'file_read',
      'fs_read',
      'Compatibility alias for fs_read.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          maxChars: { type: 'number', description: 'Maximum characters' },
        },
        required: ['path'],
      },
      (a) => ({ path: a.path, maxChars: a.maxChars }),
      'low'
    ),
    aliasTool(
      'file_write',
      'fs_write',
      'Compatibility alias for fs_write.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Content to write' },
          append: { type: 'boolean', description: 'Append instead of overwrite' },
        },
        required: ['path', 'content'],
      },
      (a) => ({ path: a.path, content: a.content, append: a.append }),
      'high'
    ),
    aliasTool(
      'list_directory',
      'fs_list',
      'Compatibility alias for fs_list.',
      {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path' } },
        required: ['path'],
      },
      (a) => ({ path: a.path }),
      'low'
    ),
    aliasTool(
      'shell_execute',
      'bash',
      'Compatibility alias for bash.',
      {
        type: 'object',
        properties: { command: { type: 'string', description: 'Command to execute' } },
        required: ['command'],
      },
      (a) => ({ command: a.command }),
      'high'
    ),
    aliasTool(
      'memory_search',
      'memory.search',
      'Compatibility alias for memory.search.',
      {
        type: 'object',
        properties: { key: { type: 'string', description: 'Memory key/query' } },
        required: ['key'],
      },
      (a) => ({ key: a.key }),
      'low'
    ),
    aliasTool(
      'memory_add',
      'memory.write',
      'Compatibility alias for memory.write.',
      {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key' },
          value: { type: 'string', description: 'Memory value' },
        },
        required: ['key', 'value'],
      },
      (a) => ({ key: a.key, value: a.value }),
      'medium'
    ),
    {
      name: 'filesystem',
      description:
        'Compatibility filesystem dispatcher. action=list|read|write|delete|search maps to the fs_* tools.',
      tags: ['alias', 'filesystem'],
      riskLevel: 'high',
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list, read, write, delete, or search' },
          path: { type: 'string', description: 'File or directory path' },
          content: { type: 'string', description: 'Content for write' },
          query: { type: 'string', description: 'Query for search' },
        },
        required: ['action', 'path'],
      },
      execute: async (args: any) => {
        if (args.action === 'list') return bus.execute('fs_list', { path: args.path });
        if (args.action === 'read') return bus.execute('fs_read', { path: args.path, maxChars: args.maxChars });
        if (args.action === 'write') return bus.execute('fs_write', { path: args.path, content: args.content ?? '' });
        if (args.action === 'delete') return bus.execute('fs_delete', { path: args.path });
        if (args.action === 'search') return bus.execute('fs_search', { dir: args.path, query: args.query });
        throw new Error(`Unknown filesystem action: ${args.action}`);
      },
    },
  ];
}
