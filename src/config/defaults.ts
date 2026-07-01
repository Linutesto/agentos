// Non-secret default configuration.
//
// Real secrets must NOT live here. `getSecret()` reads them from
// ~/.config/agentos/secrets.json first (see config/secrets.ts), falling back to
// these values. Set yours with: `agentos config set-secret <key> <value>`.
//
// Only non-sensitive defaults belong in this file.

export const DEFAULT_SECRETS: Record<string, string> = {
  // Cloudflare Workers AI — leave blank; provide via secrets.json / env.
  // The token needs the "Workers AI" permission for /ai/* inference.
  cloudflare_ai_token: '',
  cloudflare_account_id: '',
  cloudflare_model: '@cf/moonshotai/kimi-k2.7-code',
};
