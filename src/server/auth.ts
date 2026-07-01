import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const AUTH_FILE = path.join(os.homedir(), '.config', 'agentos', 'auth.json');

interface AuthData {
  salt: string;
  hash: string; // scrypt(pin, salt)
  secret: string; // HMAC key for session tokens
}

/**
 * PIN authentication with:
 *  - scrypt-hashed PIN (salted) — never stored in plaintext or source.
 *  - HMAC-signed, expiring session tokens (stateless, survive restarts).
 *  - timing-safe comparisons + per-IP login rate limiting.
 * If no credential file exists, auth is disabled (open) — call writeCredential to enable.
 */
export class Auth {
  private data: AuthData | null = null;
  private fails = new Map<string, { n: number; until: number }>();

  constructor() {
    try {
      this.data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    } catch {
      this.data = null;
    }
  }

  get enabled() {
    return !!this.data;
  }

  /** Create/overwrite the credential file (mode 600) for a PIN. */
  static writeCredential(pin: string) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash, secret }));
    fs.chmodSync(AUTH_FILE, 0o600);
  }

  private isLocked(ip: string) {
    const f = this.fails.get(ip);
    return !!(f && f.until > Date.now());
  }
  private recordFail(ip: string) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) {
      f.until = Date.now() + 5 * 60_000; // 5-min lockout after 5 fails
      f.n = 0;
    }
    this.fails.set(ip, f);
  }

  verify(pin: string, ip: string): { ok: boolean; error?: string } {
    if (!this.data) return { ok: true };
    if (this.isLocked(ip)) return { ok: false, error: 'Too many attempts — locked for a few minutes.' };
    const candidate = crypto.scryptSync(String(pin || ''), this.data.salt, 64);
    const expected = Buffer.from(this.data.hash, 'hex');
    const ok = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    if (!ok) {
      this.recordFail(ip);
      return { ok: false, error: 'Invalid PIN' };
    }
    this.fails.delete(ip);
    return { ok: true };
  }

  issueToken(days = 30): string {
    if (!this.data) return '';
    const exp = Date.now() + days * 86_400_000;
    const payload = Buffer.from(String(exp)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.data.secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  validToken(token?: string): boolean {
    if (!this.data) return true; // auth disabled
    if (!token) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expect = crypto.createHmac('sha256', this.data.secret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const exp = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
    return Number.isFinite(exp) && exp > Date.now();
  }
}
