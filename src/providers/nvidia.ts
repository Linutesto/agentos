import { Provider, ModelInfo } from './base.js';
import { ChatMessage } from '../agent/loop.js';

export interface NvidiaConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  /** Hard timeout for a non-streaming call / idle timeout for a stream (ms). */
  timeoutMs?: number;
}

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';

/**
 * NVIDIA NIM (build.nvidia.com) provider. The endpoint is OpenAI-compatible,
 * so this reuses the chat/completions + models shapes and adds SSE streaming.
 */
export class NvidiaProvider implements Provider {
  id = 'nvidia-nim';
  private baseUrl: string;
  model: string;

  constructor(private config: NvidiaConfig) {
    this.baseUrl = config.baseUrl || DEFAULT_BASE;
    this.model = config.model || 'meta/llama-3.3-70b-instruct';
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  /** Non-streaming chat (used by the agent loop). */
  async chat(
    messages: ChatMessage[],
    model?: string,
    opts?: { temperature?: number; signal?: AbortSignal }
  ): Promise<string> {
    const timeout = this.config.timeoutMs ?? 120000;
    const maxAttempts = 3;
    const body = JSON.stringify({
      model: model || this.model,
      messages: messages.map((m) => ({ role: m.role, content: (m as any).content })),
      max_tokens: this.config.maxTokens ?? 8192,
      temperature: opts?.temperature ?? this.config.temperature ?? 0.6,
    });

    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (opts?.signal?.aborted) throw new Error('Cancelled by user.');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const signal = opts?.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          signal,
          body,
        });
        // Transient server error (NVIDIA 5xx) — back off and retry.
        if (res.status >= 500 && attempt < maxAttempts) {
          lastErr = new Error(`NVIDIA API ${res.status}`);
          await res.text().catch(() => {});
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        if (!res.ok) {
          // 4xx (or a final 5xx): client/permanent error — do not retry.
          const err: any = new Error(`NVIDIA API ${res.status}: ${await res.text()}`);
          err.noRetry = true;
          throw err;
        }
        const data: any = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
      } catch (e: any) {
        lastErr = e;
        if (e.name === 'AbortError') {
          if (opts?.signal?.aborted) throw new Error('Cancelled by user.');
          throw new Error(
            `Model '${model || this.model}' did not respond within ${timeout / 1000}s (NVIDIA capacity/queue). Try another model.`
          );
        }
        if (e.noRetry) throw e; // HTTP error response — fail fast
        // Network/transport error — retry unless this was the last attempt.
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new Error('NVIDIA request failed');
  }

  /**
   * Streaming chat. Calls onToken for each content delta and returns the full
   * text plus the finish_reason (so callers can detect truncation).
   */
  async chatStream(
    messages: ChatMessage[],
    opts: { model?: string; signal?: AbortSignal; temperature?: number; onToken: (t: string) => void }
  ): Promise<{ text: string; finish: string | null }> {
    const idle = this.config.timeoutMs ?? 120000;
    const ac = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    let idleTimer = setTimeout(() => ac.abort(), idle);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => ac.abort(), idle);
    };

    const body = JSON.stringify({
      model: opts.model || this.model,
      messages: messages.map((m) => ({ role: m.role, content: (m as any).content })),
      max_tokens: this.config.maxTokens ?? 8192,
      temperature: opts.temperature ?? this.config.temperature ?? 0.6,
      stream: true,
    });
    // Retry the initial connect on transient 5xx (safe: no tokens emitted yet).
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(), signal, body });
      resetIdle();
      if (res.status >= 500 && attempt < 3) {
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      break;
    }
    if (!res.ok || !res.body) {
      clearTimeout(idleTimer);
      throw new Error(`NVIDIA API ${res.status}: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let finish: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const choice = json.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finish = choice.finish_reason;
            const delta = choice.delta?.content;
            if (delta) {
              text += delta;
              opts.onToken(delta);
            }
          } catch {
            /* ignore partial/keepalive frames */
          }
        }
      }
    } catch (e: any) {
      if (e.name === 'AbortError' && !opts.signal?.aborted) {
        throw new Error(
          `Model '${opts.model || this.model}' stalled (no output for ${idle / 1000}s). Try another model.`
        );
      }
      throw e;
    } finally {
      clearTimeout(idleTimer);
    }
    return { text, finish };
  }

  /** List every model exposed to this key. */
  async models(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`NVIDIA models ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    return (data.data ?? [])
      .map((m: any) => ({ id: m.id, name: m.id }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
  }
}
