import { chromium, BrowserContext, Page } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Tool } from '../bus/toolbus.js';

let context: BrowserContext | null = null;
let page: Page | null = null;

const profileDir = path.join(os.homedir(), '.config', 'agentos', 'browser-profile');

async function ensurePage(headless = false): Promise<Page> {
  if (!context) {
    await fs.mkdir(profileDir, { recursive: true });
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: process.env.AGENTOS_CHROME_PATH || '/usr/bin/google-chrome',
      headless,
      viewport: { width: 1365, height: 900 },
      args: ['--no-first-run', '--disable-dev-shm-usage'],
    });
    context.on('close', () => {
      context = null;
      page = null;
    });
  }
  if (!page || page.isClosed()) {
    page = context.pages()[0] || (await context.newPage());
  }
  return page;
}

async function settle(p: Page) {
  try {
    await p.waitForLoadState('domcontentloaded', { timeout: 15000 });
  } catch {}
}

async function pageSummary(p: Page) {
  return { title: await p.title().catch(() => ''), url: p.url(), profileDir };
}

function byTextOrSelector(p: Page, selector?: string, text?: string) {
  if (selector) return p.locator(selector).first();
  if (text) return p.getByText(text, { exact: false }).first();
  throw new Error('Provide selector or text.');
}

export const browserNavigateTool: Tool = {
  name: 'browserNavigate',
  description:
    'Open a URL in AgentOS isolated Chrome. Uses ~/.config/agentos/browser-profile, not the user default Chrome profile.',
  tags: ['browser', 'navigate', 'automation'],
  riskLevel: 'medium',
  timeout: 30000,
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to open' },
      headless: { type: 'boolean', description: 'Run Chrome headless for this session' },
    },
    required: ['url'],
  },
  execute: async (args: { url: string; headless?: boolean }) => {
    const p = await ensurePage(args.headless ?? false);
    await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return pageSummary(p);
  },
};

export const browserClickTool: Tool = {
  name: 'browserClick',
  description: 'Click an element in the AgentOS browser by CSS selector or visible text.',
  tags: ['browser', 'click', 'automation'],
  riskLevel: 'medium',
  timeout: 20000,
  schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: 'Visible text to click' },
    },
  },
  execute: async (args: { selector?: string; text?: string }) => {
    const p = await ensurePage();
    await byTextOrSelector(p, args.selector, args.text).click({ timeout: 15000 });
    await settle(p);
    return pageSummary(p);
  },
};

export const browserFillTool: Tool = {
  name: 'browserFill',
  description: 'Fill an input/textarea/contenteditable in the AgentOS browser by CSS selector or label text.',
  tags: ['browser', 'form', 'automation'],
  riskLevel: 'medium',
  redactArgs: ['value'],
  timeout: 20000,
  schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      label: { type: 'string', description: 'Accessible label text' },
      value: { type: 'string', description: 'Value to type/fill' },
      pressEnter: { type: 'boolean', description: 'Press Enter after filling' },
    },
    required: ['value'],
  },
  execute: async (args: { selector?: string; label?: string; value: string; pressEnter?: boolean }) => {
    const p = await ensurePage();
    const target = args.selector ? p.locator(args.selector).first() : p.getByLabel(args.label || '').first();
    await target.fill(args.value, { timeout: 15000 });
    if (args.pressEnter) await target.press('Enter');
    await settle(p);
    return pageSummary(p);
  },
};

export const browserSnapshotTool: Tool = {
  name: 'browserSnapshot',
  description: 'Return visible page text, links, buttons, and inputs from the AgentOS browser.',
  tags: ['browser', 'snapshot', 'read'],
  riskLevel: 'low',
  timeout: 15000,
  schema: {
    type: 'object',
    properties: { maxChars: { type: 'number', description: 'Maximum text length, default 12000' } },
  },
  execute: async (args: { maxChars?: number }) => {
    const p = await ensurePage();
    const max = args.maxChars ?? 12000;
    const data = await p.evaluate(() => {
      const visible = (el: Element) => {
        const style = window.getComputedStyle(el);
        const rect = (el as HTMLElement).getBoundingClientRect();
        return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const text = document.body?.innerText || '';
      const links = [...document.querySelectorAll('a')].filter(visible).slice(0, 80).map((a) => ({
        text: (a.textContent || '').trim().slice(0, 120),
        href: (a as HTMLAnchorElement).href,
      }));
      const buttons = [...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
        .filter(visible)
        .slice(0, 80)
        .map((b) => (b.textContent || (b as HTMLInputElement).value || b.getAttribute('aria-label') || '').trim());
      const inputs = [...document.querySelectorAll('input,textarea,[contenteditable="true"]')]
        .filter(visible)
        .slice(0, 80)
        .map((i) => ({
          tag: i.tagName.toLowerCase(),
          type: (i as HTMLInputElement).type || '',
          name: (i as HTMLInputElement).name || '',
          placeholder: (i as HTMLInputElement).placeholder || '',
          label: i.getAttribute('aria-label') || '',
        }));
      return { text, links, buttons, inputs };
    });
    return { ...(await pageSummary(p)), ...data, text: data.text.slice(0, max), truncated: data.text.length > max };
  },
};

export const browserExtractTool: Tool = {
  name: 'browserExtract',
  description: 'Extract text, HTML, or an attribute from elements matching a CSS selector.',
  tags: ['browser', 'extract', 'read'],
  riskLevel: 'low',
  timeout: 15000,
  schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector' },
      attribute: { type: 'string', description: 'Attribute to extract; omit for textContent' },
      html: { type: 'boolean', description: 'Return innerHTML instead of text' },
      all: { type: 'boolean', description: 'Return all matches instead of first' },
    },
    required: ['selector'],
  },
  execute: async (args: { selector: string; attribute?: string; html?: boolean; all?: boolean }) => {
    const p = await ensurePage();
    const values = await p.locator(args.selector).evaluateAll((els, opts) => {
      return els.map((el) => {
        if (opts.attribute) return el.getAttribute(opts.attribute);
        if (opts.html) return (el as HTMLElement).innerHTML;
        return (el.textContent || '').trim();
      });
    }, { attribute: args.attribute, html: args.html });
    return { ...(await pageSummary(p)), selector: args.selector, values: args.all ? values : values.slice(0, 1) };
  },
};

export const browserScreenshotTool: Tool = {
  name: 'browserScreenshot',
  description: 'Save a screenshot of the AgentOS browser page.',
  tags: ['browser', 'screenshot', 'read'],
  riskLevel: 'low',
  timeout: 20000,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Output PNG path; defaults under ~/.config/agentos/screenshots' },
      fullPage: { type: 'boolean', description: 'Capture the full page' },
    },
  },
  execute: async (args: { path?: string; fullPage?: boolean }) => {
    const p = await ensurePage();
    const out = args.path || path.join(os.homedir(), '.config', 'agentos', 'screenshots', `${Date.now()}.png`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await p.screenshot({ path: out, fullPage: args.fullPage ?? false });
    return { ...(await pageSummary(p)), path: out };
  },
};

export const browserScrollTool: Tool = {
  name: 'browserScroll',
  description: 'Scroll the AgentOS browser page.',
  tags: ['browser', 'scroll', 'automation'],
  riskLevel: 'low',
  timeout: 10000,
  schema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Horizontal pixels' },
      y: { type: 'number', description: 'Vertical pixels' },
    },
  },
  execute: async (args: { x?: number; y?: number }) => {
    const p = await ensurePage();
    await p.mouse.wheel(args.x ?? 0, args.y ?? 800);
    return pageSummary(p);
  },
};

export const browserWaitTool: Tool = {
  name: 'browserWait',
  description: 'Wait for a selector or a fixed number of milliseconds in the AgentOS browser.',
  tags: ['browser', 'wait', 'automation'],
  riskLevel: 'low',
  timeout: 30000,
  schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to wait for' },
      ms: { type: 'number', description: 'Milliseconds to wait' },
    },
  },
  execute: async (args: { selector?: string; ms?: number }) => {
    const p = await ensurePage();
    if (args.selector) await p.locator(args.selector).first().waitFor({ timeout: args.ms ?? 15000 });
    else await p.waitForTimeout(Math.min(args.ms ?? 1000, 30000));
    return pageSummary(p);
  },
};

export const browserEvaluateTool: Tool = {
  name: 'browserEvaluate',
  description: 'Evaluate JavaScript in the AgentOS browser page. Use for DOM extraction, not privileged browser internals.',
  tags: ['browser', 'javascript', 'automation'],
  riskLevel: 'high',
  timeout: 15000,
  schema: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'JavaScript expression or function body to run in the page' },
    },
    required: ['script'],
  },
  execute: async (args: { script: string }) => {
    const p = await ensurePage();
    const result = await p.evaluate(args.script);
    return { ...(await pageSummary(p)), result };
  },
};

export const browserSessionTool: Tool = {
  name: 'browserSession',
  description:
    'Manage the AgentOS isolated browser session. action=status|close|reset. Reset deletes the isolated profile after closing Chrome.',
  tags: ['browser', 'session', 'automation'],
  riskLevel: 'high',
  timeout: 15000,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'status, close, or reset' },
    },
  },
  execute: async (args: { action?: string }) => {
    const action = args.action || 'status';
    if (action === 'status') {
      if (!context || !page || page.isClosed()) return { open: false, profileDir };
      return { open: true, ...(await pageSummary(page)) };
    }
    if (action === 'close' || action === 'reset') {
      await context?.close().catch(() => {});
      context = null;
      page = null;
      if (action === 'reset') await fs.rm(profileDir, { recursive: true, force: true });
      return { open: false, reset: action === 'reset', profileDir };
    }
    throw new Error(`Unknown browserSession action: ${action}`);
  },
};

export const browserTools: Tool[] = [
  browserNavigateTool,
  browserClickTool,
  browserFillTool,
  browserSnapshotTool,
  browserExtractTool,
  browserScreenshotTool,
  browserScrollTool,
  browserWaitTool,
  browserEvaluateTool,
  browserSessionTool,
];
