import { Tool } from '../bus/toolbus.js';
import { getSecret, setSecret, SECRETS_FILE } from '../config/secrets.js';
import fs from 'node:fs/promises';

async function readKeys(): Promise<string[]> {
  try {
    const data = JSON.parse(await fs.readFile(SECRETS_FILE, 'utf8'));
    return Object.keys(data).sort();
  } catch {
    return [];
  }
}

export const credentialsSetTool: Tool = {
  name: 'credentialsSet',
  description: 'Store a secret in the AgentOS credential vault (~/.config/agentos/secrets.json, mode 600).',
  tags: ['credentials', 'secrets', 'accounts'],
  riskLevel: 'high',
  redactArgs: ['value'],
  timeout: 5000,
  schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Secret key, e.g. github.token or facebook.accessToken' },
      value: { type: 'string', description: 'Secret value' },
    },
    required: ['key', 'value'],
  },
  execute: async (args: { key: string; value: string }) => {
    await setSecret(args.key, args.value);
    return { ok: true, key: args.key, stored: true };
  },
};

export const credentialsGetTool: Tool = {
  name: 'credentialsGet',
  description:
    'Check or retrieve a secret from the AgentOS credential vault. Returns only metadata unless reveal=true.',
  tags: ['credentials', 'secrets', 'accounts'],
  riskLevel: 'high',
  redactArgs: ['key'],
  timeout: 5000,
  schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Secret key to read' },
      reveal: { type: 'boolean', description: 'Return the raw value. Use only when needed for an immediate API call.' },
    },
    required: ['key'],
  },
  execute: async (args: { key: string; reveal?: boolean }) => {
    const value = await getSecret(args.key);
    if (!value) return { key: args.key, exists: false };
    if (!args.reveal) return { key: args.key, exists: true, length: value.length };
    return { key: args.key, exists: true, value };
  },
};

export const credentialsListTool: Tool = {
  name: 'credentialsList',
  description: 'List secret keys available in the AgentOS credential vault without revealing values.',
  tags: ['credentials', 'secrets', 'accounts'],
  riskLevel: 'low',
  timeout: 5000,
  schema: {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: 'Optional prefix filter, e.g. github or twitter.' },
    },
  },
  execute: async (args: { prefix?: string }) => {
    const keys = await readKeys();
    return { keys: args.prefix ? keys.filter((k) => k.startsWith(args.prefix!)) : keys };
  },
};

export const credentialsImportTool: Tool = {
  name: 'credentialsImport',
  description: 'Import multiple secrets from a JSON object into the AgentOS credential vault.',
  tags: ['credentials', 'secrets', 'accounts'],
  riskLevel: 'high',
  redactArgs: true,
  timeout: 10000,
  schema: {
    type: 'object',
    properties: {
      credentials: { type: 'object', description: 'Object mapping secret keys to secret values' },
    },
    required: ['credentials'],
  },
  execute: async (args: { credentials: Record<string, string> }) => {
    const entries = Object.entries(args.credentials || {}).filter(([, v]) => typeof v === 'string');
    for (const [key, value] of entries) await setSecret(key, value);
    return { ok: true, imported: entries.map(([key]) => key) };
  },
};

export const credentialTools: Tool[] = [
  credentialsSetTool,
  credentialsGetTool,
  credentialsListTool,
  credentialsImportTool,
];
