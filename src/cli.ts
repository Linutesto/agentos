#!/usr/bin/env node
import { Command } from 'commander';
import { ToolBus } from './bus/toolbus.js';
import { bashTool } from './tools/bash.js';
import { curlTool } from './tools/curl.js';
import { webTools } from './tools/websearch.js';
import { filesystemTools } from './tools/filesystem.js';
import { codeTools } from './tools/code.js';
import { createForgeTool } from './tools/forge.js';
import { createSkillTools } from './tools/skills.js';
import { SkillRegistry } from './skills/registry.js';
import { AgentLoop } from './agent/loop.js';
import { cloudflareTools } from './tools/cloudflare.js';
import { setSecret, getSecret } from './config/secrets.js';
import { EventBus } from './bus/eventbus.js';
import { MemoryDatabase } from './memory/sqlite.js';
import { createMemorySearchTool, createMemoryWriteTool } from './tools/memory.js';
import { createBusSearchTool, createBusDescribeTool } from './tools/bus.js';
import { credentialTools } from './tools/credentials.js';
import { browserTools } from './tools/browser.js';
import { createAliasTools } from './tools/aliases.js';
import { createSkillDependencyTool } from './tools/skilldeps.js';
import { githubTools } from './tools/github.js';
import { AgentTUI } from './ui/app.js';
import * as readline from 'readline';
import { OllamaProvider } from './providers/ollama.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import { CloudflareAIProvider } from './providers/cloudflare-ai.js';
import { startServer } from './server/server.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import prompts from 'prompts';

/** Resolve the NVIDIA NIM key from env, secrets store, or ~/.config/nvidia-nim/env. */
async function loadNvidiaKey(): Promise<string | undefined> {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY;
  const fromSecret = await getSecret('nvidia_api_key');
  if (fromSecret) return fromSecret;
  const envFile = path.join(os.homedir(), '.config', 'nvidia-nim', 'env');
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^NVIDIA_API_KEY=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no file */
  }
  return undefined;
}

const program = new Command();

const eventBus = new EventBus();
const db = new MemoryDatabase(eventBus);

const bus = new ToolBus(eventBus);
bus.register(bashTool);
bus.register(curlTool);
for (const t of webTools) bus.register(t);
for (const t of filesystemTools) bus.register(t);
for (const t of codeTools) bus.register(t);
bus.register(createForgeTool(bus));
for (const t of createSkillTools(new SkillRegistry())) bus.register(t);
bus.register(createBusSearchTool(bus));
bus.register(createBusDescribeTool(bus));
bus.register(createMemorySearchTool(db));
bus.register(createMemoryWriteTool(db));
for (const t of credentialTools) bus.register(t);
for (const t of browserTools) bus.register(t);
for (const t of githubTools) bus.register(t);
for (const tool of cloudflareTools) {
  bus.register(tool);
}
for (const t of createAliasTools(bus)) bus.register(t);
bus.register(createSkillDependencyTool(bus));

program
  .name('agentos')
  .description('AgentOS / Cognitive Kernel for Termux')
  .version('0.1.0');

program
  .command('tui')
  .description('Launch the AgentOS Terminal User Interface')
  .action(() => {
    const tui = new AgentTUI(eventBus, bus, db);
    tui.start();
  });

program
  .command('chat')
  .description('Start an interactive chat session')
  .action(async () => {
    let provider: any = new OllamaProvider();
    
    const cfAiToken = await getSecret('cloudflare_ai_token') || process.env.CLOUDFLARE_AI_TOKEN;
    const geminiKey = await getSecret('gemini_api_key') || process.env.GEMINI_API_KEY;
    const openaiKey = await getSecret('openai_api_key') || process.env.OPENAI_API_KEY;

    if (cfAiToken) {
      const accountId = await getSecret('cloudflare_account_id');
      if (!accountId) {
        console.error('Missing cloudflare_account_id. Set it with: agentos config set-secret cloudflare_account_id <your-32-char-id>');
        return;
      }
      const model = await getSecret('cloudflare_model') || '@cf/moonshotai/kimi-k2.7-code';
      provider = new CloudflareAIProvider({ accountId, apiToken: cfAiToken, model });
      console.log(`Using Cloudflare AI Provider (model: ${model}).`);
    } else if (geminiKey) {
      const model = await getSecret('gemini_model') || 'gemini-1.5-pro-latest';
      provider = new GeminiProvider(geminiKey, model);
      console.log(`Using Gemini Provider (model: ${model}).`);
    } else if (openaiKey) {
      const baseUrl = await getSecret('openai_base_url') || undefined;
      const model = await getSecret('openai_model') || 'gpt-4o';
      provider = new OpenAIProvider({ apiKey: openaiKey, baseUrl, model });
      console.log(`Using OpenAI Provider (model: ${model}).`);
    } else {
      const baseUrl = await getSecret('ollama_base_url') || undefined;
      const model = await getSecret('ollama_model') || undefined;
      provider = new OllamaProvider(baseUrl, model);
      console.log('Using Ollama Provider (default).');
    }

    const loop = new AgentLoop({
      bus,
      eventBus,
      chat: (messages) => provider.chat(messages)
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('AgentOS Chat Session Started. Type "exit" to quit.\n');

    let closed = false;
    rl.on('close', () => { closed = true; });

    const ask = () => {
      if (closed) return;
      rl.question('You: ', async (input) => {
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          rl.close();
          return;
        }

        if (!input.trim()) {
          ask();
          return;
        }

        console.log('AgentOS is thinking...');
        
        const onToolStarted = (e: any) => console.log(`> Syscall: ${e.payload.name}`);
        eventBus.on('tool.started', onToolStarted);
        
        try {
          const res = await loop.run(input);
          if (res.status === 'success') {
            console.log(`\nAgentOS: ${res.finalContent}\n`);
          } else {
            console.log(`\nAgentOS Error: ${res.error}\n`);
          }
        } catch (e: any) {
          console.error(`\nFatal Error: ${e.message}\n`);
        } finally {
          eventBus.off('tool.started', onToolStarted);
        }

        ask();
      });
    };

    ask();
  });

program
  .command('server')
  .description('Launch the AgentOS web platform (chat + agent workflows) for NVIDIA NIM')
  .option('-p, --port <port>', 'Port to listen on', '8787')
  .option('-h, --host <host>', 'Host to bind (0.0.0.0 to expose over LAN/Tailscale)', '0.0.0.0')
  .option('-m, --model <model>', 'Default model', 'qwen/qwen3.5-397b-a17b')
  .action(async (options) => {
    const apiKey = await loadNvidiaKey();
    if (!apiKey) {
      console.error(
        'No NVIDIA key found. Set NVIDIA_API_KEY, run `agentos config set-secret nvidia_api_key <key>`,\n' +
          'or create ~/.config/nvidia-nim/env with NVIDIA_API_KEY=nvapi-...'
      );
      process.exit(1);
    }
    startServer({
      apiKey,
      port: parseInt(options.port, 10),
      host: options.host,
      defaultModel: options.model,
    });
  });

program
  .command('loop-test')
  .description('Test the agent loop with a mock provider')
  .action(async () => {
    let callCount = 0;
    const mockChat = async (messages: any[]) => {
      callCount++;
      if (callCount === 1) {
        return '{"tool": "bash", "args": {"command": "echo looptest"}}';
      }
      return '{"type": "final", "content": "Finished successfully."}';
    };

    const loop = new AgentLoop({
      bus,
      eventBus,
      chat: mockChat
    });

    const res = await loop.run("System prompt here. User asks: test loop");
    console.log(JSON.stringify(res, null, 2));
  });

// Tool commands
const toolCmd = program.command('tool').description('Manage and explore tools');

toolCmd
  .command('list')
  .description('List all available tools')
  .action(() => {
    console.log(JSON.stringify(bus.list(), null, 2));
  });

toolCmd
  .command('search <query>')
  .description('Search for tools')
  .action((query) => {
    console.log(JSON.stringify(bus.search(query), null, 2));
  });

toolCmd
  .command('describe <name>')
  .description('Describe a specific tool')
  .action((name) => {
    try {
      console.log(JSON.stringify(bus.describe(name), null, 2));
    } catch (e: any) {
      console.error(e.message);
    }
  });

toolCmd
  .command('exec <name> <args>')
  .description('Execute a tool with JSON args')
  .action(async (name, args) => {
    try {
      const parsedArgs = JSON.parse(args);
      const result = await bus.execute(name, parsedArgs);
      console.log(JSON.stringify(result, null, 2));
      if (name.startsWith('browser') && name !== 'browserSession') {
        await bus.execute('browserSession', { action: 'close' }).catch(() => {});
      }
    } catch (e: any) {
      console.error('Error:', e.message);
    }
  });

// Cloudflare commands
const cfCmd = program.command('cf').description('Cloudflare plugin commands');

cfCmd
  .command('set-token <token>')
  .description('Set Cloudflare API token')
  .action(async (token) => {
    await setSecret('cloudflare_token', token);
    console.log('Cloudflare token saved successfully in secrets.');
  });

cfCmd
  .command('verify')
  .description('Verify Cloudflare token')
  .action(async () => {
    try {
      const res = await bus.execute('cloudflare.token.verify', {});
      console.log('Token is VALID.', JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error('Verify failed:', e.message);
    }
  });

cfCmd
  .command('accounts')
  .description('List Cloudflare accounts')
  .action(async () => {
    try {
      const res = await bus.execute('cloudflare.accounts.list', {});
      console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error('Failed to list accounts:', e.message);
    }
  });

cfCmd
  .command('zones')
  .description('List Cloudflare zones')
  .action(async () => {
    try {
      const res = await bus.execute('cloudflare.zones.list', {});
      console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error('Failed to list zones:', e.message);
    }
  });

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('init')
  .description('Initialize configuration')
  .action(() => {
    console.log('Config init not implemented yet.');
  });

configCmd
  .command('set-secret <key> <value>')
  .description('Set a secret key (e.g. gemini_api_key)')
  .action(async (key, value) => {
    await setSecret(key, value);
    console.log(`Secret ${key} saved successfully.`);
  });

program
  .command('provider')
  .description('Interactive menu to configure AI providers')
  .action(async () => {
    const { provider } = await prompts({
      type: 'select',
      name: 'provider',
      message: 'Select a provider to configure',
      choices: [
        { title: 'Cloudflare Workers AI', value: 'cloudflare' },
        { title: 'OpenAI (Compatible / OpenRouter / Groq / etc)', value: 'openai' },
        { title: 'Gemini', value: 'gemini' },
        { title: 'Ollama (Local)', value: 'ollama' }
      ]
    });

    if (!provider) return;

    if (provider === 'cloudflare') {
      const answers = await prompts([
        {
          type: 'text',
          name: 'accountId',
          message: 'Enter your Cloudflare Account ID (32 chars):'
        },
        {
          type: 'text',
          name: 'apiToken',
          message: 'Enter your Cloudflare API Token (Workers AI read):'
        },
        {
          type: 'text',
          name: 'model',
          message: 'Enter model (e.g. @cf/moonshotai/kimi-k2.7-code):',
          initial: '@cf/moonshotai/kimi-k2.7-code'
        }
      ]);
      
      if (answers.accountId) {
        const cleanId = answers.accountId.trim().replace(/^\.+|\.+$/g, '');
        await setSecret('cloudflare_account_id', cleanId);
      }
      if (answers.apiToken) await setSecret('cloudflare_ai_token', answers.apiToken.trim());
      if (answers.model) await setSecret('cloudflare_model', answers.model.trim());
      console.log('Cloudflare AI Provider configured successfully!');
    } else if (provider === 'openai') {
      const answers = await prompts([
        {
          type: 'text',
          name: 'apiKey',
          message: 'Enter your API Key:'
        },
        {
          type: 'text',
          name: 'baseUrl',
          message: 'Enter Base URL (leave empty for default OpenAI):'
        },
        {
          type: 'text',
          name: 'model',
          message: 'Enter default model (e.g. gpt-4o, llama3):',
          initial: 'gpt-4o'
        }
      ]);
      
      if (answers.apiKey) await setSecret('openai_api_key', answers.apiKey);
      if (answers.baseUrl) await setSecret('openai_base_url', answers.baseUrl);
      if (answers.model) await setSecret('openai_model', answers.model);
      console.log('OpenAI-compatible Provider configured successfully!');
    } else if (provider === 'gemini') {
      const answers = await prompts([
        {
          type: 'text',
          name: 'apiKey',
          message: 'Enter your Gemini API Key:'
        },
        {
          type: 'text',
          name: 'model',
          message: 'Enter default model (e.g. gemini-1.5-pro-latest):',
          initial: 'gemini-1.5-pro-latest'
        }
      ]);
      
      if (answers.apiKey) await setSecret('gemini_api_key', answers.apiKey);
      if (answers.model) await setSecret('gemini_model', answers.model);
      console.log('Gemini Provider configured successfully!');
    } else if (provider === 'ollama') {
      const answers = await prompts([
        {
          type: 'text',
          name: 'baseUrl',
          message: 'Enter Ollama Base URL:',
          initial: 'http://localhost:11434'
        },
        {
          type: 'text',
          name: 'model',
          message: 'Enter default model (e.g. llama3):',
          initial: 'llama3'
        }
      ]);
      
      if (answers.baseUrl) await setSecret('ollama_base_url', answers.baseUrl);
      if (answers.model) await setSecret('ollama_model', answers.model);
      console.log('Ollama Provider configured successfully!');
    }
  });

program.parse(process.argv);
