import { Tool } from '../bus/toolbus.js';
import { getSecret } from '../config/secrets.js';

async function fetchCF(endpoint: string, method: string = 'GET', body?: any) {
  const token = await getSecret('cloudflare_token');
  if (!token) throw new Error('Missing cloudflare_token in secrets');

  const url = `https://api.cloudflare.com/client/v4${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  
  const data: any = await res.json();
  if (!data.success) {
    throw new Error(`CF Error: ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

export const cfVerifyTool: Tool = {
  name: 'cloudflare.token.verify',
  description: 'Verify Cloudflare API token status',
  tags: ['cloudflare', 'auth'],
  riskLevel: 'low',
  schema: { type: 'object', properties: {} },
  execute: async () => fetchCF('/user/tokens/verify')
};

export const cfAccountsTool: Tool = {
  name: 'cloudflare.accounts.list',
  description: 'List Cloudflare accounts',
  tags: ['cloudflare', 'accounts'],
  riskLevel: 'low',
  schema: { type: 'object', properties: {} },
  execute: async () => fetchCF('/accounts')
};

export const cfZonesTool: Tool = {
  name: 'cloudflare.zones.list',
  description: 'List Cloudflare zones',
  tags: ['cloudflare', 'zones'],
  riskLevel: 'low',
  schema: { type: 'object', properties: {} },
  execute: async () => fetchCF('/zones')
};

export const cfDnsListTool: Tool = {
  name: 'cloudflare.dns.list',
  description: 'List DNS records for a zone',
  tags: ['cloudflare', 'dns'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: { zone_id: { type: 'string' } },
    required: ['zone_id']
  },
  execute: async ({ zone_id }) => fetchCF(`/zones/${encodeURIComponent(zone_id)}/dns_records`)
};

export const cfDnsCreateTool: Tool = {
  name: 'cloudflare.dns.create',
  description: 'Create a DNS record',
  tags: ['cloudflare', 'dns'],
  riskLevel: 'medium',
  schema: {
    type: 'object',
    properties: {
      zone_id: { type: 'string' },
      type: { type: 'string', description: 'A, AAAA, CNAME, etc.' },
      name: { type: 'string' },
      content: { type: 'string' },
      proxied: { type: 'boolean' },
      ttl: { type: 'number' }
    },
    required: ['zone_id', 'type', 'name', 'content']
  },
  execute: async (args) => {
    const { zone_id, ...record } = args;
    return fetchCF(`/zones/${encodeURIComponent(zone_id)}/dns_records`, 'POST', record);
  }
};

export const cfDnsDeleteTool: Tool = {
  name: 'cloudflare.dns.delete',
  description: 'Delete a DNS record',
  tags: ['cloudflare', 'dns', 'danger'],
  riskLevel: 'high',
  schema: {
    type: 'object',
    properties: {
      zone_id: { type: 'string' },
      record_id: { type: 'string' }
    },
    required: ['zone_id', 'record_id']
  },
  execute: async ({ zone_id, record_id }) => {
    const token = await getSecret('cloudflare_token');
    if (!token) throw new Error('Missing cloudflare_token in secrets');

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone_id)}/dns_records/${encodeURIComponent(record_id)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data: any = await res.json();
    if (!data.success) throw new Error(`CF Error: ${JSON.stringify(data.errors)}`);
    return data.result;
  }
};

export const cfWorkersListTool: Tool = {
  name: 'cloudflare.workers.list',
  description: 'List Cloudflare Workers',
  tags: ['cloudflare', 'workers'],
  riskLevel: 'low',
  schema: {
    type: 'object',
    properties: { account_id: { type: 'string' } },
    required: ['account_id']
  },
  execute: async ({ account_id }) => fetchCF(`/accounts/${encodeURIComponent(account_id)}/workers/scripts`)
};

export const cloudflareTools = [
  cfVerifyTool, cfAccountsTool, cfZonesTool, cfDnsListTool, cfDnsCreateTool, cfDnsDeleteTool, cfWorkersListTool
];
