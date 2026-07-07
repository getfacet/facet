import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { sessionFilePath } from "./session-file.js";
import type { Sink, StoredEvent } from "./sink.js";

/** A replayed line is only a `StoredEvent` if it carries the fields the runtime
 * reads back. Wrong-shape lines are dropped like corrupt ones so a stray JSON
 * value can't derail the whole replay. */
function isStoredEvent(value: unknown): value is StoredEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  const messages = e["messages"];
  return (
    typeof e["at"] === "number" &&
    typeof e["event"] === "object" &&
    e["event"] !== null &&
    Array.isArray(messages) &&
    // Every element must be a non-null object — the replay reads `message.kind`,
    // which throws on a `null`/primitive element.
    messages.every((m) => typeof m === "object" && m !== null)
  );
}

/**
 * Durable, dependency-free `Sink`: appends the conversation to disk as JSONL
 * (replayable on reconnect). Node-only (`node:fs`) — kept in its own module so
 * browser bundles that import `MemorySink` don't pull in `node:fs`.
 */
export class FileSink implements Sink {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private fileFor(agentId: string, visitorId: string): string {
    return sessionFilePath(this.dir, agentId, visitorId, "jsonl");
  }

  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    mkdirSync(this.dir, { recursive: true }); // resilient if the dir was removed at runtime
    appendFileSync(this.fileFor(agentId, visitorId), `${JSON.stringify(entry)}\n`);
  }

  async history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return [];
    const entries: StoredEvent[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.length === 0) continue;
      // Skip a corrupt/partial or wrong-shape line rather than fail the whole replay.
      try {
        const parsed: unknown = JSON.parse(line);
        if (isStoredEvent(parsed)) entries.push(parsed);
      } catch {
        /* ignore corrupt line */
      }
    }
    return entries;
  }
}
