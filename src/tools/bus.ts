import { Tool, ToolBus } from '../bus/toolbus.js';

export const createBusSearchTool = (bus: ToolBus): Tool => ({
  name: 'bus.search',
  description: 'Search for available tools in the ToolBus',
  tags: ['meta', 'bus', 'discovery'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keyword' }
    },
    required: ['query']
  },
  execute: async (args: { query: string }) => {
    return { results: bus.search(args.query) };
  }
});

export const createBusDescribeTool = (bus: ToolBus): Tool => ({
  name: 'bus.describe',
  description: 'Get the full schema and details of a specific tool',
  tags: ['meta', 'bus', 'discovery'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Exact name of the tool' }
    },
    required: ['name']
  },
  execute: async (args: { name: string }) => {
    return { tool: bus.describe(args.name) };
  }
});
