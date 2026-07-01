import { Provider, ModelInfo } from './base.js';
import { ChatMessage } from '../agent/loop.js';

export interface CloudflareAIConfig {
  accountId: string;
  apiToken: string;
  model: string;
}

export class CloudflareAIProvider implements Provider {
  id = 'cloudflare-ai';

  constructor(private config: CloudflareAIConfig) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    // We use the OpenAI-compatible endpoint for Cloudflare AI
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/ai/v1/chat/completions`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiToken}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });

    if (!res.ok) {
      throw new Error(`Cloudflare AI Error: ${res.statusText} - ${await res.text()}`);
    }

    const data: any = await res.json();
    return data.choices[0].message.content;
  }
}
