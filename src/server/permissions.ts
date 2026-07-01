import path from 'node:path';
import os from 'node:os';

export type PermMode = 'full' | 'ask';

/**
 * Central authority for what the agent may touch.
 *  - mode 'full'  : run everything without prompting.
 *  - mode 'ask'   : prompt the user to approve medium/high-risk actions.
 *  - scope        : filesystem root the agent is confined to ('/' = whole PC).
 */
export class PermissionManager {
  mode: PermMode = 'ask';
  scope: string;

  constructor(defaultScope?: string) {
    this.scope = path.resolve(defaultScope || os.homedir());
  }

  setMode(m: PermMode) {
    if (m === 'full' || m === 'ask') this.mode = m;
  }

  setScope(p: string) {
    this.scope = p === '/' ? '/' : path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));
  }

  state() {
    return { mode: this.mode, scope: this.scope };
  }

  /** Is an absolute/relative path inside the allowed scope? */
  inScope(p: string): boolean {
    if (this.scope === '/') return true;
    const resolved = path.resolve(this.scope, p.replace(/^~(?=\/|$)/, os.homedir()));
    return resolved === this.scope || resolved.startsWith(this.scope + path.sep);
  }
}

/** Which arg (if any) is a filesystem path we should scope-check. */
export function pathArg(args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  return args.path ?? args.file ?? args.dir ?? args.cwd ?? undefined;
}
