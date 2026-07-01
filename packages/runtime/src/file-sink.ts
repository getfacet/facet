import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionKey } from "./stage-store.js";
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
    const name = Buffer.from(sessionKey(agentId, visitorId)).toString("base64url");
    return join(this.dir, `${name}.jsonl`);
  }

  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    appendFileSync(this.fileFor(agentId, visitorId), `${JSON.stringify(entry)}\n`);
  }

  async history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    const file = this.fileFor(agentId, visitorId);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StoredEvent);
  }
}
