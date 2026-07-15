/**
 * Shared, INTERNAL issue-hardening helpers for the two untrusted-document
 * boundaries — `validateTree`/`validateComposition` (`validate.ts`) and `validateTheme`
 * (`theme.ts`). NOT re-exported from the barrel: these are an implementation
 * detail both validators import directly, so the key-echo cap and the
 * bounded-issue-list posture are defined once and can never drift between the
 * tree path and the theme path.
 *
 * The threat both sinks share: an issue string interpolates a document-derived
 * name (a node id, a token key, a screen/child id) that came from untrusted LLM
 * or operator input. Left raw it can be megabytes long or carry ANSI/C1 control
 * sequences that inject into operator terminals (`console.error` in the runtime,
 * the quickstart CLI). And a degenerate document (tens of thousands of junk
 * entries) yields one issue each, ballooning the list. `printableKey` caps the
 * former; `BoundedIssues` caps the latter.
 */

/** Length cap shared by key echoing and CSS-value checks (see `theme.ts`). */
export const MAX_VALUE_LENGTH = 64;

/** Cap on issues collected per document — a junk-entry group cannot balloon the list. */
export const MAX_ISSUES = 64;

/** The single tail entry appended once the issue cap is reached. */
export const ISSUES_SUPPRESSED = "...further issues suppressed";

/**
 * True for a character a terminal must never receive verbatim: the C0 controls
 * (< 0x20), DEL (0x7f), and the whole C1 block (0x80–0x9f) — the latter includes
 * the single-byte CSI (0x9b) and OSC (0x9d) introducers xterm-class terminals
 * honor, so echoing one raw is an escape-injection into operator logs.
 */
export function isControlChar(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * A document/group KEY (or id) safe to interpolate into an issue string. Keys
 * are echoed pre-cap, so an untrusted document's key can be megabytes long or
 * carry control sequences: cap length and reject control chars (C0/DEL/C1)
 * before echoing, replacing an unsafe key with a fixed placeholder.
 */
export function printableKey(key: string): string {
  if (key.length > MAX_VALUE_LENGTH) return "<key too long>";
  for (let i = 0; i < key.length; i++) {
    if (isControlChar(key.charCodeAt(i))) return "<unprintable key>";
  }
  return key;
}

/**
 * A bounded, NEVER-THROWING echo of an untrusted VALUE (not just a key) for an
 * issue string. A string goes through the same length/control-char cap as
 * `printableKey` (quoted); a number/boolean/null echoes verbatim (inherently
 * bounded); everything else — object, array, bigint, function, symbol,
 * undefined — becomes a constant `<type>` placeholder. Crucially it NEVER calls
 * `JSON.stringify`, so a cyclic object or a BigInt can't throw (which would
 * breach the validators' never-throws boundary) and a multi-MB value can't
 * flood the operator log via the runtime's save-time `console.error`.
 */
export function printableValue(v: unknown): string {
  if (typeof v === "string") return `"${printableKey(v)}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  return Array.isArray(v) ? "<array>" : `<${typeof v}>`;
}

/**
 * Safely extracts a bounded diagnostic from a caught value. This function must
 * itself never throw: hostile objects may throw from their `message` getter,
 * and arbitrary objects are never coerced with `String(...)` or JSON methods.
 * Only a primitive string or a string-valued `message` is accepted. C0, DEL,
 * and C1 controls are removed before the retained detail is capped.
 */
export function caughtErrorDetail(error: unknown): string {
  try {
    let raw: string;
    if (typeof error === "string") {
      raw = error;
    } else if (typeof error === "object" && error !== null) {
      let message: unknown;
      try {
        message = Reflect.get(error, "message");
      } catch {
        return "unknown error";
      }
      if (typeof message !== "string") return "unknown error";
      raw = message;
    } else {
      return "unknown error";
    }

    const detail: string[] = [];
    const scanLimit = Math.min(raw.length, 4096);
    for (let index = 0; index < scanLimit && detail.length < 256; index += 1) {
      const code = raw.charCodeAt(index);
      if (!isControlChar(code)) detail.push(raw[index] ?? "");
    }
    return detail.length > 0 ? detail.join("") : "unknown error";
  } catch {
    return "unknown error";
  }
}

/**
 * Pointer/key tokens that would walk into or poison the prototype chain instead
 * of own data. Shared by both untrusted-document boundaries (the tree/theme node
 * & token maps) AND the JSON-Pointer patch parser — a single spelling so the
 * SECURITY-CRITICAL set can never drift between the sites that reject it.
 */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

/** True for a key/token that must be dropped or rejected (see `FORBIDDEN_KEYS`). */
export function isForbiddenKey(k: string): boolean {
  return FORBIDDEN_KEYS.has(k);
}

/**
 * True for a plain (non-array) object — the shape both validators treat as a
 * traversable map. Rejects arrays and null so callers can safely index string
 * keys. (patch.ts deliberately uses a WEAKER container check that admits arrays;
 * that one is NOT this predicate.)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A fresh null-prototype map. Output maps for untrusted documents are built on
 * `Object.create(null)` so a key that slips a forbidden-key guard still resolves
 * to `undefined` (no inherited setter, no prototype-chain lookup).
 */
export function nullMap<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}

/**
 * The shared validate/truncate policy for a document's one-line `description`
 * (a theme's and a composition's). Returns the value to keep (if any) and a single
 * warning MESSAGE (if any) — each caller pushes it in its own issue shape. The
 * `label` ("theme"/"composition") and `cap` (`MAX_DESCRIPTION_LENGTH`, single-sourced
 * in `theme.ts`) parameterize the ONLY differences between the two call sites;
 * the message wording is otherwise byte-identical. Callers gate on
 * `input.description !== undefined` before calling, so a non-string reaching
 * here is a supplied-but-wrong value.
 */
export function boundedDescription(
  raw: unknown,
  label: string,
  cap: number,
): { description?: string; warning?: string } {
  if (typeof raw !== "string") {
    return { warning: `${label} description is not a string; ignored` };
  }
  if (raw.length > cap) {
    return {
      description: raw.slice(0, cap),
      warning: `${label} description truncated to ${cap} characters`,
    };
  }
  return { description: raw };
}

/** The minimal surface `validate.ts`'s helpers need — push a diagnostic string. */
export interface IssueSink {
  push(issue: string): void;
}

/**
 * A bounded string-issue collector for the tree/composition path. Once `MAX_ISSUES`
 * real entries are recorded, further pushes are dropped after a single
 * `ISSUES_SUPPRESSED` tail entry — so a 100k-junk-node root replace produces at
 * most 65 issue strings instead of one per node. Mirrors the theme path's
 * `IssueList` posture; `.list` is the plain array to return.
 */
export class BoundedIssues implements IssueSink {
  private readonly items: string[] = [];
  private truncated = false;
  push(issue: string): void {
    if (this.items.length >= MAX_ISSUES) {
      if (!this.truncated) {
        this.items.push(ISSUES_SUPPRESSED);
        this.truncated = true;
      }
      return;
    }
    this.items.push(issue);
  }
  get list(): readonly string[] {
    return this.items;
  }
}

/**
 * Fetch-like field/column keys rejected on both data bricks and `data`
 * warehouse rows — a single source so the brick-validation and data-binding
 * paths can never drift on this security denylist (invariant #1: no
 * URL/fetch/resolver surface may ride in as a field or column name).
 */
export const FORBIDDEN_DATA_KEYS: ReadonlySet<string> = new Set([
  "html",
  "rawHtml",
  "innerHTML",
  "script",
  "javascript",
  "js",
  "css",
  "fetch",
  "fetchUrl",
  "endpoint",
  "url",
  "dataSource",
  "query",
  "queryExpr",
  "expression",
  "resolver",
]);
