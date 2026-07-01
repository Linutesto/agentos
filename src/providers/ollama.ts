import { Provider, ModelInfo } from './base.js';
import { ChatMessage } from '../agent/loop.js';

export class OllamaProvider implements Provider {
  id = 'ollama';

  constructor(private baseUrl: string = 'http://localhost:11434', private model: string = 'llama3') {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false
      })
    });

    if (!res.ok) {
      throw new Error(`Ollama API Error: ${res.statusText}`);
    }

    const data: any = await res.json();
    return data.message.content;
  }

  async models(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama API Error: ${res.statusText}`);
    const data: any = await res.json();
    return data.models.map((m: any) => ({ id: m.name, name: m.name }));
  }
}
