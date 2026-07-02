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

/**
 * Parse a bridge port from an env var. `undefined` passes through (use the
 * default); otherwise it must be an integer in 1–65535 or we throw a clear error
 * naming the offending value — so a typo fails fast instead of `Number("abc")`
 * silently handing `NaN` to `server.listen`.
 */
export function parseBridgePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid FACET_BRIDGE_PORT ${JSON.stringify(value)}: expected an integer 1–65535.`,
    );
  }
  return port;
}

/**
 * Parse the spawn-mode concurrency cap from an env var. `undefined` passes
 * through (use the default); otherwise it must be an integer >= 1 or we throw a
 * clear error naming the offending value — so a typo fails fast instead of
 * silently handing `NaN`/0 to the semaphore.
 */
export function parseMaxConcurrent(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `Invalid FACET_MAX_CONCURRENT ${JSON.stringify(value)}: expected an integer >= 1.`,
    );
  }
  return limit;
}
