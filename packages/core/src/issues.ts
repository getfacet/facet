/**
 * Shared, INTERNAL issue-hardening helpers for the two untrusted-document
 * boundaries — `validateTree`/`validateStamp` (`validate.ts`) and `validateTheme`
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

/** The minimal surface `validate.ts`'s helpers need — push a diagnostic string. */
export interface IssueSink {
  push(issue: string): void;
}

/**
 * A bounded string-issue collector for the tree/stamp path. Once `MAX_ISSUES`
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
