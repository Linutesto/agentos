import { Tool } from '../bus/toolbus.js';
import { MemoryDatabase } from '../memory/sqlite.js';

export const createMemorySearchTool = (db: MemoryDatabase): Tool => ({
  name: 'memory.search',
  description: 'Search for a saved memory by key',
  tags: ['memory', 'storage'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key']
  },
  execute: async ({ key }) => {
    const val = db.readMemory(key);
    return val ? { found: true, value: val } : { found: false };
  }
});

export const createMemoryWriteTool = (db: MemoryDatabase): Tool => ({
  name: 'memory.write',
  description: 'Write or overwrite a memory key-value pair',
  tags: ['memory', 'storage'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: { 
      key: { type: 'string' },
      value: { type: 'string' }
    },
    required: ['key', 'value']
  },
  execute: async ({ key, value }) => {
    db.writeMemory(key, value);
    return { success: true, key };
  }
});
