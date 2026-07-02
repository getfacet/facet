import type { ClientEvent, ServerMessage } from "@facet/core";
import { sessionKey } from "./stage-store.js";

/** One recorded interaction: a visitor event and the messages the agent answered with. */
export interface StoredEvent {
  /** Epoch milliseconds when it was recorded. */
  readonly at: number;
  readonly event: ClientEvent;
  readonly messages: readonly ServerMessage[];
}

/**
 * A conversation sink — where a visitor's interactions (events + agent replies)
 * go. Facet always owns the STAGE (`StageStore`), but the conversation is a
 * separate concern that often already lives elsewhere (a chat platform, AMA2,
 * your own DB). So it's pluggable:
 *
 * - `MemorySink` / `FileSink` — Facet stores it (replayable on reconnect).
 * - `ForwardSink` — hand each interaction to your system; Facet keeps nothing.
 * - `NullSink` — drop it.
 *
 * Methods are async so a backend can be a database. This module is browser-safe;
 * the file backend (`FileSink`) lives in its own module.
 */
export interface Sink {
  /** Called once per handled interaction. */
  record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void>;
  /** Past interactions for replay, oldest first. `[]` if this sink can't replay. */
  history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]>;
}

/** Drops everything — for consumers whose conversation lives entirely elsewhere. */
export class NullSink implements Sink {
  async record(_agentId: string, _visitorId: string, _entry: StoredEvent): Promise<void> {}
  async history(_agentId: string, _visitorId: string): Promise<readonly StoredEvent[]> {
    return [];
  }
}

/** Keeps history in memory — replayable; the zero-config default. */
export class MemorySink implements Sink {
  private readonly log = new Map<string, StoredEvent[]>();

  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    const key = sessionKey(agentId, visitorId);
    const existing = this.log.get(key);
    if (existing !== undefined) existing.push(entry);
    else this.log.set(key, [entry]);
  }

  async history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    return this.log.get(sessionKey(agentId, visitorId)) ?? [];
  }
}

/**
 * Forwards each interaction to your system (e.g. AMA2, your own DB). Facet
 * retains nothing, so `history()` is empty — if you want chat replay on
 * reconnect, your system re-injects it. This is the pattern for consumers that
 * already store the conversation.
 */
export class ForwardSink implements Sink {
  constructor(
    private readonly forward: (
      agentId: string,
      visitorId: string,
      entry: StoredEvent,
    ) => void | Promise<void>,
  ) {}

  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    await this.forward(agentId, visitorId, entry);
  }

  async history(_agentId: string, _visitorId: string): Promise<readonly StoredEvent[]> {
    return [];
  }
}
