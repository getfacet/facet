import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bootstrapSession, MemoryStageStore } from "@facet/runtime";
import type { ConversationRecord, Sink } from "@facet/runtime";
import { createFrameLogStore } from "./frame-log.js";
import { parseResumeToken } from "./late.js";
import { rehydrate } from "./server-rehydrate.js";
import {
  conversation,
  MARKUP,
  readFrames,
  stageFromResync,
  start,
  testCatalog,
  testTheme,
} from "./server.test-support.js";

class DuplicateHistorySink implements Sink {
  readonly #messages: readonly ConversationRecord[];

  constructor(messages: readonly ConversationRecord[]) {
    this.#messages = messages;
  }

  async record(): Promise<{ readonly ok: true }> {
    return { ok: true };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return this.#messages;
  }
}

class OrderedHistorySink implements Sink {
  readonly #readJoined: () => boolean;
  readonly order: string[] = [];

  constructor(readJoined: () => boolean) {
    this.#readJoined = readJoined;
  }

  async record(): Promise<{ readonly ok: true }> {
    return { ok: true };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    this.order.push(`history:${this.#readJoined()}`);
    return [];
  }
}

class WritableResponse {
  readonly chunks: string[] = [];

  write(chunk: string): void {
    this.chunks.push(chunk);
  }

  end(): void {}
}

describe("resume token parsing", () => {
  it("accepts only <era>:<seq> tokens", () => {
    expect(parseResumeToken("abc:12")).toEqual({ era: "abc", seq: 12 });
    expect(parseResumeToken(":12")).toBeUndefined();
    expect(parseResumeToken("abc:-1")).toBeUndefined();
    expect(parseResumeToken("abc:1.2")).toBeUndefined();
  });
});

describe("server rehydrate", () => {
  it("uses a root-replace PatchFrame for an unresumable reconnect, with both stage halves", async () => {
    const { server, base } = await start();
    try {
      const frames = await readFrames(
        await fetch(`${base}/stream?sessionKey=s1`, { headers: { "Last-Event-ID": "old:1" } }),
        1,
      );

      expect(frames[0]?.data.kind).toBe("patch");
      if (frames[0]?.data.kind !== "patch") throw new Error("expected patch");
      expect(frames[0].data.ops).toHaveLength(1);
      expect(frames[0].data.ops[0]).toMatchObject({ op: "replace", path: "" });
      const stage = stageFromResync(frames[0].data);
      expect(stage.document).not.toBeNull();
      expect(stage.data).toEqual({});
      expect(frames[0].data.stageRevision).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("collapses duplicate conversation history by messageId during rehydrate", async () => {
    const first = conversation("event1", "assistant", "first");
    const replacement = { ...first, text: "replacement" };
    const { server, base } = await start({ sink: new DuplicateHistorySink([first, replacement]) });
    try {
      const frames = await readFrames(await fetch(`${base}/stream?sessionKey=s1`), 3);
      const conversations = frames
        .map((frame) => frame.data)
        .filter((frame) => frame.kind === "conversation");

      expect(conversations).toEqual([replacement]);
    } finally {
      await server.close();
    }
  });

  it("joins the live stream before reading the persisted snapshot", async () => {
    let joined = false;
    const sink = new OrderedHistorySink(() => joined);
    const store = new MemoryStageStore();
    const boot = bootstrapSession({
      catalog: testCatalog(),
      theme: testTheme(),
      initialMarkup: MARKUP,
    });
    if (!boot.ok) throw new Error(boot.code);
    await store.save("s1", boot.session, 0);
    const res = new WritableResponse();
    const response = res as unknown as Parameters<typeof rehydrate>[0];

    await rehydrate(
      response,
      "s1",
      createFrameLogStore(),
      store,
      sink,
      async () => {
        sink.order.push("ensure");
      },
      () => false,
      () => {
        joined = true;
        sink.order.push("join");
      },
    );

    expect(sink.order).toEqual(["ensure", "join", "history:true"]);
    expect(res.chunks.some((chunk) => chunk.includes('"kind":"patch"'))).toBe(true);
  });

  it("contains no reset frame branch and leaves messageId dedupe to runtime/sink", () => {
    const serverSources = ["server-rehydrate.ts", "frame-log.ts", "late.ts", "server.ts"].map(
      (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
    );
    const runtimeOutbox = readFileSync(
      new URL("../../../core/runtime/src/outbox.ts", import.meta.url),
      "utf8",
    );

    expect(serverSources.join("\n")).not.toContain('kind: "reset"'); // style-hard-cut: allowed-negative
    expect(serverSources.join("\n")).not.toContain("messageSeq");
    expect(runtimeOutbox).toContain("messageSeq");
  });
});
