import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { sessionFilePath } from "./session-file.js";
import type { Sink, StoredEvent } from "./sink.js";

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
      // Skip a corrupt/partial line rather than fail the whole replay.
      try {
        entries.push(JSON.parse(line) as StoredEvent);
      } catch {
        /* ignore corrupt line */
      }
    }
    return entries;
  }
}
