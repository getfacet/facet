/** Canonical replacement used when Facet removes a sensitive value. */
export const REDACTED_SENSITIVE_VALUE = "[redacted]";

const SENSITIVE_FIELD_NAME =
  /(?:password|passcode|secret|token|api[_-]?key|authorization|bearer|provider[_-]?key)/i;
const SENSITIVE_FIELD_VALUE = /\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/i;
const SENSITIVE_FIELD_VALUE_GLOBAL = new RegExp(SENSITIVE_FIELD_VALUE.source, "gi");

// Keep the key-name quantifiers bounded. Unbounded scans on both sides of the
// alternation backtrack quadratically on an unclosed quote followed by repeated
// sensitive words.
const SENSITIVE_FIELD_PAIR_GLOBAL = new RegExp(
  `("[^"]{0,256}(?:${SENSITIVE_FIELD_NAME.source})[^"]{0,256}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  "gi",
);

/** Bound synchronous regex work on hostile free-text input. */
const MAX_REDACTION_INPUT_CHARS = 100_000;

/** Whether a field name or its string value must be replaced before logging or prompting. */
export function shouldRedactSensitiveField(name: string, value: unknown): boolean {
  return (
    SENSITIVE_FIELD_NAME.test(name) ||
    (typeof value === "string" && SENSITIVE_FIELD_VALUE.test(value))
  );
}

/**
 * Redact key-looking substrings and quoted values assigned to sensitive field
 * names. Pathological input is truncated before regex processing. Pure and
 * browser-safe.
 */
export function redactSensitiveText(text: string): string {
  const bounded =
    text.length > MAX_REDACTION_INPUT_CHARS ? text.slice(0, MAX_REDACTION_INPUT_CHARS) : text;
  return bounded
    .replace(
      SENSITIVE_FIELD_PAIR_GLOBAL,
      (_match, prefix: string) => `${prefix}"${REDACTED_SENSITIVE_VALUE}"`,
    )
    .replace(SENSITIVE_FIELD_VALUE_GLOBAL, REDACTED_SENSITIVE_VALUE);
}
