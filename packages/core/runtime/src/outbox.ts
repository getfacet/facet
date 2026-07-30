import type { ServerFrame } from "@facet/core";

import type { WriteAuthority } from "./turn-gate.js";
import { TurnGate } from "./turn-gate.js";

export interface OutboxEntry {
  readonly seq: number;
  readonly frame: ServerFrame;
}

type AppendResult =
  | { readonly ok: true; readonly emitted: boolean; readonly entry: OutboxEntry }
  | { readonly ok: false; readonly code: string; readonly detail: string };

const DEFAULT_RETENTION_LIMIT = 512;

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function reject(code: string, detail: string): Extract<AppendResult, { readonly ok: false }> {
  return { ok: false, code, detail };
}

export class ConversationOutbox {
  readonly #gate: TurnGate;
  readonly #retentionLimit: number;
  readonly #entries: OutboxEntry[] = [];
  readonly #messageSeq = new Map<string, number>();
  #nextSeq = 1;

  constructor(
    gate: TurnGate,
    options: {
      readonly retentionLimit?: number;
    } = {},
  ) {
    this.#gate = gate;
    this.#retentionLimit = positiveInteger(options.retentionLimit, DEFAULT_RETENTION_LIMIT);
  }

  append(frame: ServerFrame, authority: WriteAuthority): AppendResult {
    if (!this.#gate.present(authority)) {
      return reject("outbox_authority_rejected", "The write authority is not active.");
    }
    return this.#append(frame);
  }

  appendCommitted(frame: ServerFrame): AppendResult {
    return this.#append(frame);
  }

  #append(frame: ServerFrame): AppendResult {
    if (frame.kind === "conversation") {
      const existing = this.#messageSeq.get(frame.messageId);
      if (existing !== undefined) {
        const entry = Object.freeze({ seq: existing, frame });
        this.#replace(existing, entry);
        return { ok: true, emitted: false, entry };
      }
      this.#messageSeq.set(frame.messageId, this.#nextSeq);
    }

    const entry = Object.freeze({ seq: this.#nextSeq, frame });
    this.#nextSeq += 1;
    this.#entries.push(entry);
    this.#trim();
    return { ok: true, emitted: true, entry };
  }

  replay(sinceSeq: number): readonly OutboxEntry[] {
    const floor = typeof sinceSeq === "number" && Number.isSafeInteger(sinceSeq) ? sinceSeq : 0;
    return Object.freeze(this.#entries.filter((entry) => entry.seq > floor));
  }

  #replace(seq: number, entry: OutboxEntry): void {
    const index = this.#entries.findIndex((candidate) => candidate.seq === seq);
    if (index >= 0) {
      this.#entries[index] = entry;
    }
  }

  #trim(): void {
    while (this.#entries.length > this.#retentionLimit) {
      const removed = this.#entries.shift();
      if (removed?.frame.kind === "conversation") {
        this.#messageSeq.delete(removed.frame.messageId);
      }
    }
  }
}
