import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool } from '../bus/toolbus.js';

const execAsync = promisify(exec);

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a bash command in Termux',
  tags: ['system', 'shell', 'termux'],
  riskLevel: 'high',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' }
    },
    required: ['command']
  },
  timeout: 30000,
  execute: async (args: { command: string }) => {
    try {
      const { stdout, stderr } = await execAsync(args.command);
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (error: any) {
      return { 
        stdout: error.stdout?.trim() || '', 
        stderr: error.stderr?.trim() || error.message, 
        exitCode: error.code || 1 
      };
    }
  }
};
