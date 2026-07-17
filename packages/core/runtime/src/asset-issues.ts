const MAX_ASSET_ISSUES = 64;
const MAX_ASSET_ISSUE_CHARS = 200;
const SUPPRESSED_ISSUE = "...further asset issues suppressed";

function isControlChar(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function sanitize(raw: string): string {
  let output = "";
  const limit = Math.min(raw.length, MAX_ASSET_ISSUE_CHARS);
  for (let index = 0; index < limit; index += 1) {
    const character = raw[index]!;
    output += isControlChar(character.charCodeAt(0)) ? "?" : character;
  }
  return raw.length > MAX_ASSET_ISSUE_CHARS ? `${output}...` : output;
}

/** Bounded issue sink for the hostile operator-asset boundary. */
export class AssetIssues {
  readonly #issues: string[] = [];

  push(issue: string): void {
    if (this.#issues.length >= MAX_ASSET_ISSUES) {
      this.#issues[MAX_ASSET_ISSUES - 1] = SUPPRESSED_ISSUE;
      return;
    }
    this.#issues.push(sanitize(issue));
  }

  get list(): readonly string[] {
    return this.#issues;
  }
}

/** Extracts only bounded primitive error text; hostile objects are never echoed. */
export function describeAssetError(error: unknown): string {
  try {
    if (error instanceof Error)
      return error.message === "" ? "unknown error" : sanitize(error.message);
    if (
      error === null ||
      error === undefined ||
      typeof error === "string" ||
      typeof error === "number" ||
      typeof error === "boolean" ||
      typeof error === "bigint" ||
      typeof error === "symbol"
    ) {
      return sanitize(String(error));
    }
  } catch {
    return "unreadable error";
  }
  return "non-error rejection";
}
