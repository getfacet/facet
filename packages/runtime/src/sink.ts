import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * A conversation sink — where a viewer's interactions (events + agent replies)
 * go. Facet always owns the STAGE (`StageStore`), but the conversation is a
 * separate concern that often already lives elsewhere (a chat platform, AMA2,
 * your own DB). So it's pluggable:
 *
 * - `MemorySink` / `FileSink` — Facet stores it (replayable on reconnect).
 * - `ForwardSink` — hand each interaction to your system; Facet keeps nothing.
 * - `NullSink` — drop it.
 */
export interface Sink {
  /** Called once per handled interaction. May be async (e.g. an HTTP forward). */
  record(agentId: string, visitorId: string, entry: StoredEvent): void | Promise<void>;
  /** Past interactions for replay, oldest first. `[]` if this sink can't replay. */
  history(agentId: string, visitorId: string): readonly StoredEvent[];
}

/** Drops everything — for consumers whose conversation lives entirely elsewhere. */
export class NullSink implements Sink {
  record(_agentId: string, _visitorId: string, _entry: StoredEvent): void {}
  history(_agentId: string, _visitorId: string): readonly StoredEvent[] {
    return [];
  }
}

/** Keeps history in memory — replayable; the zero-config default. */
export class MemorySink implements Sink {
  private readonly log = new Map<string, StoredEvent[]>();

  record(agentId: string, visitorId: string, entry: StoredEvent): void {
    const key = sessionKey(agentId, visitorId);
    const existing = this.log.get(key);
    if (existing !== undefined) existing.push(entry);
    else this.log.set(key, [entry]);
  }

  history(agentId: string, visitorId: string): readonly StoredEvent[] {
    return this.log.get(sessionKey(agentId, visitorId)) ?? [];
  }
}

/** Durable, dependency-free: appends the conversation to disk as JSONL (replayable). */
export class FileSink implements Sink {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(agentId: string, visitorId: string): string {
    const name = Buffer.from(sessionKey(agentId, visitorId)).toString("base64url");
    return join(this.dir, `${name}.jsonl`);
  }

  record(agentId: string, visitorId: string, entry: StoredEvent): void {
    appendFileSync(this.fileFor(agentId, visitorId), `${JSON.stringify(entry)}\n`);
  }

  history(agentId: string, visitorId: string): readonly StoredEvent[] {
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StoredEvent);
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

  record(agentId: string, visitorId: string, entry: StoredEvent): void | Promise<void> {
    return this.forward(agentId, visitorId, entry);
  }

  history(_agentId: string, _visitorId: string): readonly StoredEvent[] {
    return [];
  }
}
