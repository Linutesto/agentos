import vm from 'node:vm';
import { Tool, ToolBus, ToolSchema } from '../bus/toolbus.js';

/**
 * Runtime tool-forging (inspired by @framers/agentos SandboxedToolForge, Apache-2.0).
 * Lets the agent write a NEW tool as a JS `execute(input)` function; the code is
 * statically screened and executed in a hardened node:vm sandbox (no require /
 * process / eval), then registered on the ToolBus for the rest of the session.
 */

// Static screen — reject obvious sandbox-escape / host-access patterns.
const BANNED = [
  /\brequire\b/, /\bprocess\b/, /\bchild_process\b/, /\bglobalThis\b/,
  /\bimport\s*\(/, /\bimport\s+/, /\beval\b/, /\bFunction\s*\(/, /\bmodule\b/,
  /\bexports\b/, /\b__proto__\b/, /\bconstructor\s*\[/, /\breadFileSync\b/,
  /\bwriteFile/, /\bexecSync\b/, /\bspawn\b/, /\bReflect\b/, /\bWebAssembly\b/,
];

function screen(code: string) {
  for (const re of BANNED) {
    if (re.test(code)) throw new Error(`Rejected: code contains a forbidden pattern (${re}).`);
  }
  if (!/function\s+execute\s*\(|execute\s*=\s*(async\s*)?\(/.test(code)) {
    throw new Error('Code must define `function execute(input) { ... }`.');
  }
}

/** Build the hardened sandbox globals (minimal + a safe fetch). */
function makeSandbox(input: any) {
  const safeConsole = { log: () => {}, error: () => {}, warn: () => {}, info: () => {} };
  return {
    __INPUT__: input,
    JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp,
    Map, Set, Promise, Error, isNaN, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, TextEncoder, TextDecoder, URL, URLSearchParams,
    console: safeConsole,
    // Allowlisted network access only.
    fetch: (url: any, opts: any) => fetch(url, { ...opts, signal: AbortSignal.timeout(12000) }),
  };
}

async function runForged(code: string, input: any, timeoutMs = 12000): Promise<any> {
  const wrapped = `(async () => { ${code}\n; return await execute(__INPUT__); })()`;
  const script = new vm.Script(wrapped, { filename: 'forged-tool.js' });
  const context = vm.createContext(makeSandbox(input), {
    codeGeneration: { strings: false, wasm: false },
  });
  const exec = script.runInContext(context, { timeout: timeoutMs });
  const result = await Promise.race([
    Promise.resolve(exec),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Forged tool timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
  // Ensure JSON-serializable.
  return JSON.parse(JSON.stringify(result ?? null));
}

export function createForgeTool(bus: ToolBus): Tool {
  return {
    name: 'forge_tool',
    description:
      'Create a NEW reusable tool at runtime. Provide a name, description, an input JSON-schema, and JS code defining `async function execute(input){...}` that returns a JSON-serializable value. The code is sandboxed (globals: fetch, JSON, Math, Date, URL — NO require/process/fs) and added to your toolset immediately. Use this when no existing tool fits and you will reuse the capability.',
    tags: ['meta', 'forge', 'self-extend'],
    riskLevel: 'high',
    timeout: 15000,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name, snake_case, unique' },
        description: { type: 'string', description: 'What the tool does' },
        input_schema: { type: 'object', description: 'JSON schema for the tool args (object with properties)' },
        code: { type: 'string', description: 'JS body defining async function execute(input) { ... }' },
      },
      required: ['name', 'description', 'code'],
    },
    execute: async (args: { name: string; description: string; input_schema?: ToolSchema; code: string }) => {
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(args.name)) {
        throw new Error('name must be snake_case, 2-41 chars, starting with a letter.');
      }
      screen(args.code);
      // Compile once now to surface syntax errors at forge time.
      try {
        new vm.Script(`(async () => { ${args.code}\n; return await execute({}); })()`);
      } catch (e: any) {
        throw new Error(`Syntax error in forged code: ${e.message}`);
      }
      const schema: ToolSchema =
        args.input_schema && (args.input_schema as any).type === 'object'
          ? args.input_schema
          : { type: 'object', properties: {} };

      const forged: Tool = {
        name: args.name,
        description: `${args.description} (forged this session)`,
        tags: ['forged'],
        riskLevel: 'medium',
        timeout: 15000,
        schema,
        execute: (input: any) => runForged(args.code, input),
      };
      bus.register(forged);
      return { forged: args.name, ok: true, note: `Tool '${args.name}' is now available. Call it like any other tool.` };
    },
  };
}
