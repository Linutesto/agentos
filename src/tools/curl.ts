import { Tool } from '../bus/toolbus.js';

/**
 * HTTP request tool implemented with fetch() — NO shell, so URL/headers/body
 * can never be injected into a command line. Returns status, headers, body.
 */
export const curlTool: Tool = {
  name: 'curl',
  description: 'Make an HTTP request and return status, headers, and body.',
  tags: ['network', 'http', 'web'],
  riskLevel: 'medium',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to request' },
      method: { type: 'string', description: 'HTTP method (GET, POST, ...)' },
      headers: { type: 'object', description: 'Header key-value pairs', additionalProperties: { type: 'string' } },
      body: { type: 'string', description: 'Request body' },
    },
    required: ['url'],
  },
  timeout: 20000,
  execute: async (args: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = (args.method || 'GET').toUpperCase();
    try {
      const res = await fetch(args.url, {
        method,
        headers: args.headers || {},
        body: method === 'GET' || method === 'HEAD' ? undefined : args.body,
        signal: AbortSignal.timeout(18000),
      });
      const text = await res.text();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        truncated: text.length > 20000,
        body: text.slice(0, 20000),
      };
    } catch (error: any) {
      return { error: error?.message || String(error) };
    }
  },
};
