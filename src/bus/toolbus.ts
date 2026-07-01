import { EventBus } from './eventbus.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ToolSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  tags: string[];
  schema: ToolSchema;
  riskLevel: RiskLevel;
  permissions?: string[];
  costEstimate?: number;
  timeout?: number;
  execute: (args: any) => Promise<any>;
}

export class ToolBus {
  private tools: Map<string, Tool> = new Map();
  private enabled: Map<string, boolean> = new Map();

  constructor(private eventBus?: EventBus) {}

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
    this.enabled.set(tool.name, true);
  }

  list(): { name: string; description: string; riskLevel: string }[] {
    return Array.from(this.tools.values())
      .filter(t => this.enabled.get(t.name))
      .map(t => ({
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel
      }));
  }

  search(query: string): { name: string; description: string }[] {
    const q = query.toLowerCase();
    return Array.from(this.tools.values())
      .filter(t => this.enabled.get(t.name) && (
        t.name.toLowerCase().includes(q) || 
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      ))
      .map(t => ({
        name: t.name,
        description: t.description
      }));
  }

  describe(name: string): any {
    const tool = this.tools.get(name);
    if (!tool || !this.enabled.get(name)) {
      throw new Error(`Tool not found or disabled: ${name}`);
    }
    return {
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      riskLevel: tool.riskLevel
    };
  }

  async execute(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    if (!this.enabled.get(name)) throw new Error(`Tool disabled: ${name}`);

    // Audit log
    console.error(`[AUDIT] Tool executed: ${name} with args:`, JSON.stringify(args));
    this.eventBus?.emit('tool.started', { name, args });

    const timeout = tool.timeout || 10000;
    
    return new Promise((resolve, reject) => {
      let settled = false;
      
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          const err = new Error(`Tool ${name} timeout after ${timeout}ms`);
          this.eventBus?.emit('tool.failed', { name, error: err.message });
          reject(err);
        }
      }, timeout);

      tool.execute(args).then(result => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          this.eventBus?.emit('tool.finished', { name, result });
          resolve(result);
        }
      }).catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          this.eventBus?.emit('tool.failed', { name, error: err.message });
          reject(err);
        }
      });
    });
  }

  enable(name: string) {
    if (this.tools.has(name)) this.enabled.set(name, true);
  }

  disable(name: string) {
    if (this.tools.has(name)) this.enabled.set(name, false);
  }
}
