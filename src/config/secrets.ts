import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { DEFAULT_SECRETS } from './defaults.js';

export const SECRETS_DIR = path.join(os.homedir(), '.config', 'agentos');
export const SECRETS_FILE = path.join(SECRETS_DIR, 'secrets.json');

export async function getSecret(key: string): Promise<string | null> {
  try {
    const data = await fs.readFile(SECRETS_FILE, 'utf-8');
    const secrets = JSON.parse(data);
    return secrets[key] || DEFAULT_SECRETS[key] || null;
  } catch (e) {
    // No secrets.json yet — fall back to baked-in dev defaults.
    return DEFAULT_SECRETS[key] || null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  let secrets: any = {};
  try {
    const data = await fs.readFile(SECRETS_FILE, 'utf-8');
    secrets = JSON.parse(data);
  } catch (e) {}
  secrets[key] = value;
  await fs.writeFile(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}
