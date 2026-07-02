/**
 * Env vars safe to hand a brain the bridge runs — untrusted visitor text reaches
 * the prompt, so the operator's secrets (API keys, tokens, cloud creds) are
 * withheld. Both the spawn CLI and the persistent Agent SDK session use this.
 */
export const SAFE_ENV_KEYS = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
];

/** A minimal env: `extra` (e.g. an overridden PATH) plus only the safe allowlist keys. */
export function safeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...extra };
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && env[key] === undefined) env[key] = value;
  }
  return env;
}
