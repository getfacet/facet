import type { ConversationMessage } from "@facet/core";

export type ConversationRecord = ConversationMessage;

export interface Sink {
  record(
    key: string,
    record: ConversationRecord,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string }
  >;

  history(key: string, limit: number): Promise<readonly ConversationRecord[]>;
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

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    return 0;
  }
  return limit;
}

export class MemorySink implements Sink {
  readonly #records = new Map<string, Map<string, ConversationRecord>>();

  async record(
    key: string,
    record: ConversationRecord,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail: string }
  > {
    try {
      if (typeof key !== "string" || key.length === 0) {
        return failure("sink_invalid_key", "A sink key must be a non-empty string.");
      }
      const messageId = record.messageId;
      if (typeof messageId !== "string" || messageId.length === 0) {
        return failure("sink_invalid_message_id", "A conversation record needs a messageId.");
      }
      const records = this.#records.get(key) ?? new Map<string, ConversationRecord>();
      records.set(messageId, record);
      this.#records.set(key, records);
      return { ok: true };
    } catch {
      return failure("sink_write_failed", "The conversation record could not be stored.");
    }
  }

  async history(key: string, limit: number): Promise<readonly ConversationRecord[]> {
    try {
      const records = this.#records.get(key);
      if (records === undefined) {
        return [];
      }
      return [...records.values()].slice(-boundedLimit(limit));
    } catch {
      return [];
    }
  }
}
