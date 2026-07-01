import { Tool } from '../bus/toolbus.js';

/** Decode HTML entities that appear in DuckDuckGo's HTML output. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** DuckDuckGo wraps result links in a /l/?uddg= redirect; unwrap it. */
function unwrapDuckLink(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith('//') ? 'https:' + href : href;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Web search with no API key, via DuckDuckGo's HTML endpoint. Returns the top
 * organic results (title, url, snippet) for the agent to reason over.
 */
export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web (DuckDuckGo) and return the top results as title/url/snippet. Use for current events, facts, docs, or to find pages to fetch_url.',
  tags: ['web', 'search', 'network', 'research'],
  riskLevel: 'low',
  timeout: 20000,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      count: { type: 'number', description: 'Max results to return (default 6)' },
    },
    required: ['query'],
  },
  execute: async (args: { query: string; count?: number }) => {
    const count = Math.min(Math.max(args.count ?? 6, 1), 12);
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL) AppleWebKit/537.36 Chrome/126 Mobile',
      },
      body: new URLSearchParams({ q: args.query }).toString(),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const html = await res.text();

    const results: { title: string; url: string; snippet: string }[] = [];
    // Each result block: an anchor with class result__a, then a result__snippet.
    const anchorRe =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe =
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]));

    let am: RegExpExecArray | null;
    let i = 0;
    while ((am = anchorRe.exec(html)) && results.length < count) {
      results.push({
        title: stripTags(am[2]),
        url: unwrapDuckLink(am[1]),
        snippet: snippets[i] ?? '',
      });
      i++;
    }

    if (results.length === 0) {
      return { query: args.query, results: [], note: 'No results parsed.' };
    }
    return { query: args.query, results };
  },
};

/**
 * Fetch a URL and return readable text (scripts/styles stripped, truncated).
 * Lets the agent read pages found via web_search.
 */
export const fetchUrlTool: Tool = {
  name: 'fetch_url',
  description:
    'Fetch a web page (or raw API) and return its readable text content. Use after web_search to read a result in depth.',
  tags: ['web', 'network', 'http', 'read'],
  riskLevel: 'low',
  timeout: 25000,
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      maxChars: { type: 'number', description: 'Truncate output (default 6000)' },
    },
    required: ['url'],
  },
  execute: async (args: { url: string; maxChars?: number }) => {
    const maxChars = args.maxChars ?? 6000;
    const res = await fetch(args.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro XL) AppleWebKit/537.36 Chrome/126 Mobile',
      },
    });
    const ctype = res.headers.get('content-type') || '';
    const body = await res.text();
    let content: string;
    if (ctype.includes('json') || ctype.includes('text/plain')) {
      content = body;
    } else {
      const noScript = body
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
      content = decodeEntities(noScript).replace(/\s+/g, ' ').trim();
    }
    const truncated = content.length > maxChars;
    return {
      url: args.url,
      status: res.status,
      contentType: ctype,
      truncated,
      content: content.slice(0, maxChars),
    };
  },
};

export const webTools: Tool[] = [webSearchTool, fetchUrlTool];
