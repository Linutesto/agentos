import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Tool } from '../bus/toolbus.js';

const execFileAsync = promisify(execFile);

async function runCode(lang: 'python' | 'node', code: string, cwd?: string, timeout = 60000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-'));
  const ext = lang === 'python' ? 'py' : 'mjs';
  const file = path.join(dir, `snippet.${ext}`);
  await fs.writeFile(file, code);
  const bin = lang === 'python' ? 'python3' : 'node';
  try {
    const { stdout, stderr } = await execFileAsync(bin, [file], {
      cwd: cwd || os.homedir(),
      timeout,
      maxBuffer: 8_000_000,
    });
    return { ok: true, stdout, stderr };
  } catch (e: any) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || e.message, code: e.code ?? 1 };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const pythonTool: Tool = {
  name: 'python',
  description: 'Run a Python 3 snippet and capture stdout/stderr. For calculation, data, scripting.',
  tags: ['code', 'python', 'exec'],
  riskLevel: 'high',
  timeout: 65000,
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['code'],
  },
  execute: (args: { code: string; cwd?: string }) => runCode('python', args.code, args.cwd),
};

export const nodeTool: Tool = {
  name: 'node',
  description: 'Run a Node.js (ESM) snippet and capture stdout/stderr.',
  tags: ['code', 'javascript', 'exec'],
  riskLevel: 'high',
  timeout: 65000,
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript (ESM) source to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['code'],
  },
  execute: (args: { code: string; cwd?: string }) => runCode('node', args.code, args.cwd),
};

export const codeTools: Tool[] = [pythonTool, nodeTool];
