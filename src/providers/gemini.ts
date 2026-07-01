import { Provider } from './base.js';
import { ChatMessage } from '../agent/loop.js';

export class GeminiProvider implements Provider {
  id = 'gemini';

  constructor(private apiKey: string, private model: string = 'gemini-1.5-pro-latest') {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    
    // Map system to user since Gemini requires alternating or specific roles
    // We treat system as user prompt to simplify
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    if (!res.ok) {
      throw new Error(`Gemini API Error: ${res.statusText} - ${await res.text()}`);
    }

    const data: any = await res.json();
    return data.candidates[0].content.parts[0].text;
  }
}
