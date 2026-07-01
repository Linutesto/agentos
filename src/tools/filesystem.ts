import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool } from '../bus/toolbus.js';

const execFileAsync = promisify(execFile);
const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());

export const fsListTool: Tool = {
  name: 'fs_list',
  description: 'List the contents of a directory (name, type, size).',
  tags: ['filesystem', 'read', 'files'],
  riskLevel: 'low',
  timeout: 10000,
  schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory path' } },
    required: ['path'],
  },
  execute: async (args: { path: string }) => {
    const dir = expand(args.path);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return {
      path: dir,
      entries: entries.map((e) => {
        let size = 0;
        try {
          size = e.isFile() ? statSync(path.join(dir, e.name)).size : 0;
        } catch {}
        return { name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file', size };
      }),
    };
  },
};

export const fsReadTool: Tool = {
  name: 'fs_read',
  description: 'Read a text file and return its contents.',
  tags: ['filesystem', 'read', 'files'],
  riskLevel: 'low',
  timeout: 10000,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      maxChars: { type: 'number', description: 'Truncate (default 20000)' },
    },
    required: ['path'],
  },
  execute: async (args: { path: string; maxChars?: number }) => {
    const file = expand(args.path);
    const max = args.maxChars ?? 20000;
    const content = await fs.readFile(file, 'utf8');
    return { path: file, truncated: content.length > max, content: content.slice(0, max) };
  },
};

export const fsWriteTool: Tool = {
  name: 'fs_write',
  description: 'Write (or overwrite) a text file, creating parent dirs as needed.',
  tags: ['filesystem', 'write', 'files'],
  riskLevel: 'high',
  timeout: 10000,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'Content to write' },
      append: { type: 'boolean', description: 'Append instead of overwrite' },
    },
    required: ['path', 'content'],
  },
  execute: async (args: { path: string; content: string; append?: boolean }) => {
    const file = expand(args.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (args.append) await fs.appendFile(file, args.content);
    else await fs.writeFile(file, args.content);
    return { path: file, bytes: Buffer.byteLength(args.content), mode: args.append ? 'append' : 'write' };
  },
};

export const fsDeleteTool: Tool = {
  name: 'fs_delete',
  description: 'Delete a file or directory (recursive). Destructive.',
  tags: ['filesystem', 'write', 'delete'],
  riskLevel: 'high',
  timeout: 10000,
  schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Path to delete' } },
    required: ['path'],
  },
  execute: async (args: { path: string }) => {
    const target = expand(args.path);
    if (!existsSync(target)) return { path: target, deleted: false, note: 'does not exist' };
    await fs.rm(target, { recursive: true, force: true });
    return { path: target, deleted: true };
  },
};

export const fsSearchTool: Tool = {
  name: 'fs_search',
  description:
    'Search files under a directory for a text pattern (uses ripgrep/grep). Returns matching lines.',
  tags: ['filesystem', 'search', 'grep'],
  riskLevel: 'low',
  timeout: 20000,
  schema: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'Directory to search' },
      query: { type: 'string', description: 'Text or regex to find' },
      maxResults: { type: 'number', description: 'Max matches (default 50)' },
    },
    required: ['dir', 'query'],
  },
  execute: async (args: { dir: string; query: string; maxResults?: number }) => {
    const dir = expand(args.dir);
    const max = args.maxResults ?? 50;

    // execFile passes args as an array — no shell, so query/dir cannot inject.
    const run = async (bin: string, argv: string[]): Promise<string> => {
      try {
        const { stdout } = await execFileAsync(bin, argv, { maxBuffer: 4_000_000 });
        return stdout;
      } catch (e: any) {
        if (e.code === 1) return ''; // rg/grep exit 1 = no matches
        throw e;
      }
    };

    let stdout: string;
    try {
      stdout = await run('rg', ['--line-number', '--no-heading', '--max-count', String(max), '-e', args.query, '--', dir]);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        stdout = await run('grep', ['-rIn', '-m', String(max), '-e', args.query, '--', dir]);
      } else {
        throw e;
      }
    }
    const lines = stdout.split('\n').filter(Boolean).slice(0, max);
    return { dir, query: args.query, matches: lines };
  },
};

export const filesystemTools: Tool[] = [
  fsListTool,
  fsReadTool,
  fsWriteTool,
  fsDeleteTool,
  fsSearchTool,
];
