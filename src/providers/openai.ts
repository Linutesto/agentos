import { Provider, ModelInfo } from './base.js';
import { ChatMessage } from '../agent/loop.js';

export interface OpenAIConfig {
  baseUrl?: string;
  apiKey: string;
  model: string;
}

export class OpenAIProvider implements Provider {
  id = 'openai-compatible';
  
  constructor(private config: OpenAIConfig) {
    this.config.baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API Error: ${res.statusText} - ${await res.text()}`);
    }

    const data: any = await res.json();
    return data.choices[0].message.content;
  }
}
