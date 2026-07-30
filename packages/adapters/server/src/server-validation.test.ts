import { afterEach, describe, expect, it } from "vitest";
import { BOUNDS, deriveMessageId } from "@facet/core";
import type { ConversationMessage } from "@facet/core";
import type { ConversationRecord, Sink } from "@facet/runtime";
import { agentEvent, postEvent, postMessage, start } from "./server.test-support.js";
import { isControlBody, normalizeEventBody, normalizeMessageBody } from "./server-validation.js";

class RecordingSink implements Sink {
  readonly records: ConversationMessage[] = [];

  async record(_key: string, record: ConversationRecord): Promise<{ readonly ok: true }> {
    this.records.push(record);
    return { ok: true };
  }

  async history(): Promise<readonly ConversationRecord[]> {
    return this.records;
  }
}

let active: { readonly close: () => Promise<void> } | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
});

describe("server AgentEvent validation", () => {
  it("accepts an event without arg and preserves exact absence", () => {
    const result = normalizeEventBody({ sessionKey: "s1", event: agentEvent() });

    expect(result?.event.eventId).toBe("event1");
    expect("arg" in (result?.event ?? {})).toBe(false);
  });

  it("rejects retired visitorId aliases for event and message bodies", () => {
    expect(normalizeEventBody({ visitorId: "s1", event: agentEvent() })).toBeUndefined();
    expect(
      normalizeEventBody({ visitor: { visitorId: "s1" }, event: agentEvent() }),
    ).toBeUndefined();
    expect(
      normalizeMessageBody({
        visitorId: "s1",
        messageId: "msg1",
        text: "hello",
        screen: "home",
        stageRevision: 0,
      }),
    ).toBeUndefined();
    expect(
      normalizeMessageBody({
        visitor: { visitorId: "s1" },
        messageId: "msg1",
        text: "hello",
        screen: "home",
        stageRevision: 0,
      }),
    ).toBeUndefined();
  });

  it("mirrors B-22 collect field bounds through @facet/core", () => {
    const collect = Object.fromEntries(
      Array.from({ length: BOUNDS.collectFieldsPerEvent }, (_value, index) => [
        `field${index}`,
        { kind: "value" as const, value: "ok" },
      ]),
    );

    expect(normalizeEventBody({ sessionKey: "s1", event: agentEvent({ collect }) })).toBeDefined();
    expect(
      normalizeEventBody({
        sessionKey: "s1",
        event: agentEvent({
          collect: { ...collect, overflow: { kind: "value", value: "no" } },
        }),
      }),
    ).toBeUndefined();
  });

  it("mirrors B-23 collected value and arg bounds through @facet/core", () => {
    const atLimit = "x".repeat(BOUNDS.collectedValueChars);
    const pastLimit = `${atLimit}x`;

    expect(
      normalizeEventBody({
        sessionKey: "s1",
        event: agentEvent({ arg: atLimit, collect: { name: { kind: "value", value: atLimit } } }),
      }),
    ).toBeDefined();
    expect(
      normalizeEventBody({ sessionKey: "s1", event: agentEvent({ arg: pastLimit }) }),
    ).toBeUndefined();
    expect(
      normalizeEventBody({
        sessionKey: "s1",
        event: agentEvent({ collect: { name: { kind: "value", value: pastLimit } } }),
      }),
    ).toBeUndefined();
    expect(
      normalizeEventBody({ sessionKey: "s1", event: { ...agentEvent(), arg: 1 } }),
    ).toBeUndefined();
  });
});

describe("server external agent control validation", () => {
  it("rejects non-empty patch batches because the external channel is conversation-only", () => {
    expect(
      isControlBody({
        kind: "agent_control",
        eventId: "event1",
        outcome: {
          stageRevision: 0,
          patches: [{ op: "replace", path: "/data", value: { status: "not allowed" } }],
          conversation: {
            kind: "conversation",
            messageId: deriveMessageId("event1", "assistant"),
            turnId: "event1",
            role: "assistant",
            text: "done",
            at: 1,
          },
        },
      }),
    ).toBe(false);
  });

  it("rejects control frames whose conversation belongs to a different event", () => {
    expect(
      isControlBody({
        kind: "agent_control",
        eventId: "event2",
        outcome: {
          stageRevision: 0,
          patches: [],
          conversation: {
            kind: "conversation",
            messageId: deriveMessageId("event1", "assistant"),
            turnId: "event1",
            role: "assistant",
            text: "wrong turn",
            at: 1,
          },
        },
      }),
    ).toBe(false);
  });
});

describe("server visitor-message validation", () => {
  it("mirrors B-25 by accepting the limit and rejecting one past it before event synthesis", () => {
    const atLimit = "x".repeat(BOUNDS.conversationMessageChars);
    const pastLimit = `${atLimit}x`;

    expect(
      normalizeMessageBody({
        sessionKey: "s1",
        messageId: "msg1",
        text: atLimit,
        screen: "home",
        stageRevision: 0,
      })?.visitorMessage.text,
    ).toHaveLength(BOUNDS.conversationMessageChars);
    expect(
      normalizeMessageBody({
        sessionKey: "s1",
        messageId: "msg1",
        text: pastLimit,
        screen: "home",
        stageRevision: 0,
      }),
    ).toBeUndefined();
  });

  it("rejects an over-bound visitor message before agent invocation, Sink writes, or turn admission", async () => {
    const sink = new RecordingSink();
    let calls = 0;
    const { server, base } = await start({
      sink,
      agent: {
        run: async () => {
          calls += 1;
          return { text: "should not run" };
        },
      },
    });
    active = server;

    const response = await postMessage(
      base,
      "s1",
      "msg1",
      "x".repeat(BOUNDS.conversationMessageChars + 1),
    );

    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    expect(sink.records).toEqual([]);
  });

  it("returns busy for a distinct concurrent trigger instead of queueing it", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { server, base } = await start({
      agent: {
        run: async () => {
          await hold;
          return { text: "done" };
        },
      },
    });
    active = server;

    const first = postEvent(base, "s1", agentEvent({ eventId: "event1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await postEvent(base, "s1", agentEvent({ eventId: "event2" }));
    release();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(202);
  });
});
