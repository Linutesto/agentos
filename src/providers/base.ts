import { ChatMessage } from '../agent/loop.js';

export interface ModelInfo {
  id: string;
  name: string;
}

export interface Provider {
  id: string;
  chat(messages: ChatMessage[]): Promise<string>;
  models?(): Promise<ModelInfo[]>;
}
