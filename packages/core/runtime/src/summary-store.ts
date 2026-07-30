export interface SummaryStore {
  write(
    key: string,
    payload: unknown,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string }
  >;

  read(key: string): Promise<unknown | null>;
}

function failure(
  code: string,
  detail: string,
): {
  readonly ok: false;
  readonly code: string;
  readonly detail: string;
} {
  return { ok: false, code, detail };
}

export class MemorySummaryStore implements SummaryStore {
  readonly #payloads = new Map<string, unknown>();

  async write(
    key: string,
    payload: unknown,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string }
  > {
    try {
      if (typeof key !== "string" || key.length === 0) {
        return failure("summary_invalid_key", "A summary key must be a non-empty string.");
      }
      this.#payloads.set(key, payload);
      return { ok: true };
    } catch {
      return failure("summary_write_failed", "The summary payload could not be stored.");
    }
  }

  async read(key: string): Promise<unknown | null> {
    try {
      return this.#payloads.has(key) ? this.#payloads.get(key) : null;
    } catch {
      return null;
    }
  }
}
