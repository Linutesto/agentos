import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Conversation {
  id: string;
  title: string;
  mode: string;
  model: string;
  messages: { role: string; content: any }[];
  updated: number;
}

const DIR = path.join(os.homedir(), '.config', 'agentos');
const FILE = path.join(DIR, 'conversations.json');

/** Tiny JSON-file store for saved conversations. */
// Reject keys that could pollute the prototype chain.
const safeId = (id: string) => typeof id === 'string' && id.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(id);

export class ConversationStore {
  // null-prototype map so an id like "__proto__" becomes a plain own property.
  private convos: Record<string, Conversation> = Object.create(null);

  constructor() {
    try {
      if (fs.existsSync(FILE)) Object.assign(this.convos, JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch {
      this.convos = Object.create(null);
    }
  }

  private persist() {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(this.convos, null, 2));
  }

  list(): { id: string; title: string; model: string; mode: string; updated: number }[] {
    return Object.values(this.convos)
      .sort((a, b) => b.updated - a.updated)
      .map(({ id, title, model, mode, updated }) => ({ id, title, model, mode, updated }));
  }

  get(id: string): Conversation | undefined {
    return this.convos[id];
  }

  save(c: Omit<Conversation, 'updated'>): Conversation {
    if (!safeId(c.id)) throw new Error('Invalid conversation id');
    const full: Conversation = { ...c, updated: Date.now() };
    if (!full.title) {
      const first = c.messages.find((m) => m.role === 'user');
      const txt = typeof first?.content === 'string' ? first.content : 'Conversation';
      full.title = txt.slice(0, 48) || 'Conversation';
    }
    this.convos[full.id] = full;
    this.persist();
    return full;
  }

  delete(id: string) {
    delete this.convos[id];
    this.persist();
  }
}
