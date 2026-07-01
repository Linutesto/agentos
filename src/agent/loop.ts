import { ToolBus } from '../bus/toolbus.js';
import { parseAgentResponse, AgentAction, AgentFinal, ParserError } from './parser.js';
import { formatObservation } from './observation.js';
import { EventBus } from '../bus/eventbus.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentContext {
  bus: ToolBus;
  eventBus?: EventBus;
  chat: (messages: ChatMessage[]) => Promise<string>;
  maxIterations?: number;
  errorBudget?: number;
  signal?: AbortSignal;
}

export interface AgentResult {
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  finalContent?: string;
  history: ChatMessage[];
  iterations: number;
  error: string | null;
}

export class AgentLoop {
  private ctx: AgentContext;
  private history: ChatMessage[] = [];
  
  constructor(ctx: AgentContext) {
    this.ctx = {
      maxIterations: 15,
      errorBudget: 3,
      ...ctx
    };
  }

  async run(prompt: string): Promise<AgentResult> {
    this.history.push({ role: 'user', content: prompt });
    let iterations = 0;
    let errors = 0;

    const recentActions: string[] = [];

    while (iterations < this.ctx.maxIterations!) {
      if (this.ctx.signal?.aborted) {
        return { status: 'cancelled', history: this.history, iterations, error: 'Stopped by user.' };
      }
      iterations++;

      let llmResponse: string;
      try {
        this.ctx.eventBus?.emit('model.called', { iterations });
        llmResponse = await this.ctx.chat(this.history);
      } catch (err: any) {
        this.ctx.eventBus?.emit('model.failed', { error: err.message });
        return { status: 'failed', history: this.history, iterations, error: `LLM Error: ${err.message}` };
      }

      this.history.push({ role: 'assistant', content: llmResponse });

      let action;
      try {
        action = parseAgentResponse(llmResponse, { strict: true });
      } catch (err: any) {
        errors++;
        if (errors > this.ctx.errorBudget!) {
          return { status: 'failed', history: this.history, iterations, error: `Error budget exceeded. Last error: ${err.message}` };
        }
        this.history.push({ role: 'user', content: `{"error": "ParserError", "message": ${JSON.stringify(err.message)}}` });
        continue;
      }

      if ('type' in action && action.type === 'final') {
        return { status: 'success', finalContent: action.content, history: this.history, iterations, error: null };
      }

      const act = action as AgentAction;

      const actionSig = JSON.stringify(act);
      recentActions.push(actionSig);
      if (recentActions.length > 3) recentActions.shift();
      if (recentActions.length === 3 && recentActions.every(a => a === actionSig)) {
        return { status: 'failed', history: this.history, iterations, error: 'No progress loop detected. Repeating same action.' };
      }

      let observationContent: string;
      const start = Date.now();
      try {
        const result = await this.ctx.bus.execute(act.tool, act.args);
        observationContent = formatObservation({
          status: 'success',
          result,
          metadata: { tool: act.tool, durationMs: Date.now() - start }
        });
      } catch (err: any) {
        observationContent = formatObservation({
          status: 'error',
          error: err.message,
          metadata: { tool: act.tool, durationMs: Date.now() - start }
        });
      }

      this.history.push({ role: 'user', content: observationContent });
    }

    return { status: 'timeout', history: this.history, iterations, error: 'Max iterations reached.' };
  }
}
