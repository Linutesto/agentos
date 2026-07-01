import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventBus } from '../bus/eventbus.js';

export class MemoryDatabase {
  public db: DatabaseSync;

  constructor(private eventBus?: EventBus, dbPath?: string) {
    if (!dbPath) {
      const dir = path.join(os.homedir(), '.config', 'agentos');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      dbPath = path.join(dir, 'memory.db');
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.initSchema();

    if (this.eventBus) {
      this.eventBus.on('*', (event) => this.logEvent(event));
    }
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER,
        ended_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        tool TEXT,
        status TEXT,
        payload TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        tool TEXT,
        args TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        summary TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        payload TEXT,
        timestamp INTEGER
      );
    `);
  }

  private logEvent(event: any) {
    try {
      const stmt = this.db.prepare('INSERT INTO events (name, payload, timestamp) VALUES (?, ?, ?)');
      stmt.run(event.name, JSON.stringify(event.payload), event.timestamp);
    } catch (e) {
      console.error('Failed to log event', e);
    }
  }

  startSession(id: string) {
    const stmt = this.db.prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)');
    stmt.run(id, Date.now());
    if (this.eventBus) this.eventBus.emit('session.started', { id });
  }

  endSession(id: string) {
    const stmt = this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?');
    stmt.run(Date.now(), id);
    if (this.eventBus) this.eventBus.emit('session.ended', { id });
  }

  saveMessage(sessionId: string, role: string, content: string) {
    const stmt = this.db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)');
    stmt.run(sessionId, role, content, Date.now());
  }

  writeMemory(key: string, value: string) {
    const stmt = this.db.prepare(`
      INSERT INTO memories (key, value, timestamp) 
      VALUES (?, ?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, timestamp = excluded.timestamp
    `);
    stmt.run(key, value, Date.now());
    if (this.eventBus) this.eventBus.emit('memory.written', { key });
  }

  readMemory(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM memories WHERE key = ?');
    const row = stmt.get(key) as any;
    return row ? row.value : null;
  }
}
