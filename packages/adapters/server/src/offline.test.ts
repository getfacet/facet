import type { ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentControlFrame, VisitorEventFrame, TurnOutcome } from "@facet/core";
import { createAgentChannel, REMOTE_TIMEOUT_TEXT } from "./agent-channel.js";
import {
  conversation,
  eventReader,
  postEvent,
  start,
  visitorEvent,
} from "./server.test-support.js";
import { OFFLINE_TEXT } from "./offline.js";

let active: { readonly close: () => Promise<void> } | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
  vi.useRealTimers();
});

function responseDouble(): {
  readonly response: ServerResponse;
  readonly writes: readonly string[];
  readonly endCount: () => number;
} {
  const writes: string[] = [];
  let ended = 0;
  const response = {
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      ended += 1;
      return response;
    },
  } as unknown as ServerResponse;
  return { response, writes, endCount: () => ended };
}

function controlFrame(eventId: string, text: string, correlationId?: string): AgentControlFrame {
  return {
    kind: "agent_control",
    eventId,
    ...(correlationId === undefined ? {} : { correlationId }),
    outcome: {
      stageRevision: 0,
      patches: [],
      conversation: conversation(eventId, "assistant", text),
    },
  };
}

function dataWrites(writes: readonly string[]): readonly string[] {
  return writes.filter((write) => write.startsWith("data: "));
}

function visitorFrames(writes: readonly string[]): readonly VisitorEventFrame[] {
  return dataWrites(writes).map((write) => JSON.parse(write.slice("data: ".length)));
}

function agentReader(response: Response): {
  readonly next: () => Promise<VisitorEventFrame>;
  readonly close: () => Promise<void>;
} {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no agent stream");
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (): Promise<VisitorEventFrame> => {
    for (;;) {
      const split = buffer.indexOf("\n\n");
      if (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const line = block.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (line !== undefined) {
          const parsed = JSON.parse(line.slice(6)) as VisitorEventFrame;
          if (parsed.kind === "visitor_event") return parsed;
        }
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("agent stream closed");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { next, close: () => reader.cancel() };
}

describe("offline and agent channel", () => {
  it("delivers one offline ConversationMessage and no patch for an event when no agent is connected", async () => {
    const { server, base } = await start({ agent: undefined });
    active = server;
    const stream = await fetch(`${base}/stream?sessionKey=s1`);
    const reader = eventReader(stream);
    await reader.next(); // root resync

    const response = await postEvent(base, "s1", visitorEvent());
    const delivered = await reader.next();
    await reader.close();

    expect(response.status).toBe(202);
    expect(delivered?.data).toMatchObject({
      ...conversation("event1", "assistant", OFFLINE_TEXT),
      at: expect.any(Number) as number,
    });
  });

  it("sends VisitorEventFrame to a connected agent and accepts a correlated TurnOutcome", async () => {
    const { server, base } = await start({ agent: undefined });
    active = server;
    const agentStream = await fetch(`${base}/agent/stream`);
    const agent = agentReader(agentStream);
    const browser = eventReader(await fetch(`${base}/stream?sessionKey=s1`));
    await browser.next(); // root resync

    const pending = postEvent(base, "s1", visitorEvent({ eventId: "event1", stageRevision: 0 }));
    const frame = await agent.next();
    const outcome: TurnOutcome = {
      stageRevision: 0,
      patches: [],
      conversation: conversation(frame.event.eventId, "assistant", "remote answer"),
    };
    const control = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "agent_control",
        eventId: frame.event.eventId,
        correlationId: frame.correlationId,
        outcome,
      }),
    });
    const delivered = await browser.next();
    await browser.close();
    await agent.close();

    expect(frame).toEqual({
      kind: "visitor_event",
      correlationId: expect.any(String) as string,
      timeoutMs: 28_000,
      event: visitorEvent({ eventId: "event1" }),
    });
    expect(control.status).toBe(202);
    expect((await pending).status).toBe(202);
    expect(delivered?.data).toMatchObject({
      ...conversation("event1", "assistant", "remote answer"),
      at: expect.any(Number) as number,
    });
  });

  it("rejects non-empty external control patches instead of dropping them", async () => {
    const { server, base } = await start({ agent: undefined });
    active = server;
    const agentStream = await fetch(`${base}/agent/stream`);
    const agent = agentReader(agentStream);
    const browser = eventReader(await fetch(`${base}/stream?sessionKey=s1`));
    await browser.next(); // root resync

    const pending = postEvent(base, "s1", visitorEvent({ eventId: "event1", stageRevision: 0 }));
    const frame = await agent.next();
    const invalidOutcome: TurnOutcome = {
      stageRevision: 0,
      patches: [{ op: "replace", path: "/data", value: { status: "not allowed" } }],
      conversation: conversation(frame.event.eventId, "assistant", "remote answer"),
    };
    const invalid = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "agent_control",
        eventId: frame.event.eventId,
        correlationId: frame.correlationId,
        outcome: invalidOutcome,
      }),
    });
    const validOutcome: TurnOutcome = {
      stageRevision: 0,
      patches: [],
      conversation: conversation(frame.event.eventId, "assistant", "remote answer"),
    };
    const valid = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "agent_control",
        eventId: frame.event.eventId,
        correlationId: frame.correlationId,
        outcome: validOutcome,
      }),
    });
    await browser.next();
    await browser.close();
    await agent.close();

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(202);
    expect((await pending).status).toBe(202);
  });

  it("rejects stale external control frames that do not settle a pending turn", async () => {
    const { server, base } = await start({ agent: undefined });
    active = server;

    const stale = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(controlFrame("missing", "late answer")),
    });

    await expect(stale.json()).resolves.toMatchObject({
      ok: false,
      code: "unknown_control_event",
    });
    expect(stale.status).toBe(409);
  });

  it("keeps concurrent remote turns separate when browsers reuse the same eventId", async () => {
    const channel = createAgentChannel();
    const res = responseDouble();
    channel.attach(res.response);

    const first = channel.agent.run({ event: visitorEvent({ eventId: "same-id" }) });
    const second = channel.agent.run({
      event: visitorEvent({ eventId: "same-id", screen: "other-screen" }),
    });

    const frames = visitorFrames(res.writes);
    expect(frames.map((frame) => frame.event.eventId)).toEqual(["same-id", "same-id"]);
    expect(frames.map((frame) => typeof frame.correlationId)).toEqual(["string", "string"]);
    expect(frames.map((frame) => frame.timeoutMs)).toEqual([28_000, 28_000]);
    expect(frames[0]?.correlationId).not.toBe(frames[1]?.correlationId);
    expect(frames.map((frame) => frame.event.screen)).toEqual(["home", "other-screen"]);
    expect(
      channel.resolve(controlFrame("same-id", "second answer", frames[1]?.correlationId)),
    ).toBe(true);
    expect(channel.resolve(controlFrame("same-id", "first answer", frames[0]?.correlationId))).toBe(
      true,
    );
    await expect(first).resolves.toEqual({ text: "first answer" });
    await expect(second).resolves.toEqual({ text: "second answer" });
    expect(channel.resolve(controlFrame("same-id", "late duplicate"))).toBe(false);
    channel.close();
  });

  it("normalizes non-finite remote timeout options before writing visitor frames", async () => {
    const channel = createAgentChannel({ agentTimeoutMs: Number.NaN });
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: visitorEvent({ eventId: "nan-timeout" }) });
    const frame = visitorFrames(res.writes)[0];

    expect(frame?.timeoutMs).toBe(28_000);
    expect(Number.isFinite(frame?.timeoutMs)).toBe(true);
    expect(channel.resolve(controlFrame("nan-timeout", "accepted", frame?.correlationId))).toBe(
      true,
    );
    await expect(pending).resolves.toEqual({ text: "accepted" });
    channel.close();
  });

  it("streams a usable remote timeout when the configured agent timeout is below the safety margin", async () => {
    const channel = createAgentChannel({ agentTimeoutMs: 500 });
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: visitorEvent({ eventId: "small-timeout" }) });
    const frame = visitorFrames(res.writes)[0];

    expect(frame?.timeoutMs).toBe(500);
    expect(channel.resolve(controlFrame("small-timeout", "accepted", frame?.correlationId))).toBe(
      true,
    );
    await expect(pending).resolves.toEqual({ text: "accepted" });
    channel.close();
  });

  it("bounds remote-agent pending turns and does not emit frames past the bound", async () => {
    const channel = createAgentChannel({ maxPendingTurns: 2 });
    const res = responseDouble();
    channel.attach(res.response);

    const first = channel.agent.run({ event: visitorEvent({ eventId: "event1" }) });
    const second = channel.agent.run({ event: visitorEvent({ eventId: "event2" }) });
    const third = channel.agent.run({ event: visitorEvent({ eventId: "event3" }) });
    const frames = visitorFrames(res.writes);

    expect(frames.map((frame) => frame.event.eventId)).toEqual(["event1", "event2"]);
    await expect(third).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(channel.resolve(controlFrame("event1", "first", frames[0]?.correlationId))).toBe(true);
    expect(channel.resolve(controlFrame("event2", "second", frames[1]?.correlationId))).toBe(true);
    await expect(first).resolves.toEqual({ text: "first" });
    await expect(second).resolves.toEqual({ text: "second" });
    channel.close();
  });

  it("requires the original event id and the opaque correlation id to match", async () => {
    const channel = createAgentChannel();
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: visitorEvent({ eventId: "event1" }) });
    const frame = visitorFrames(res.writes)[0];

    expect(frame?.correlationId).toEqual(expect.any(String));
    expect(channel.resolve(controlFrame("wrong-event", "forged", frame?.correlationId))).toBe(
      false,
    );
    expect(channel.resolve(controlFrame("event1", "accepted", frame?.correlationId))).toBe(true);
    await expect(pending).resolves.toEqual({ text: "accepted" });
    channel.close();
  });

  it("times out remote agent turns before the runtime turn authority expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const channel = createAgentChannel({ agentTimeoutMs: 120_000 });
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: visitorEvent({ eventId: "slow" }) });
    await vi.advanceTimersByTimeAsync(29_000);

    await expect(pending).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    channel.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a stale heartbeat reaper path once and leaves no pending control entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const channel = createAgentChannel();
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: visitorEvent({ eventId: "reaped" }) });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(res.endCount()).toBe(1);
    expect(channel.isConnected()).toBe(false);
    expect(channel.resolve(controlFrame("reaped", "late"))).toBe(false);
    channel.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles drop, close, and capped timeout paths without unresolved promises", async () => {
    const dropped = createAgentChannel();
    const droppedResponse = responseDouble();
    dropped.attach(droppedResponse.response);
    const droppedTurn = dropped.agent.run({ event: visitorEvent({ eventId: "drop" }) });
    dropped.dropIfCurrent(droppedResponse.response);
    await expect(droppedTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(dropped.resolve(controlFrame("drop", "late"))).toBe(false);
    dropped.close();

    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timedOut = createAgentChannel({ agentTimeoutMs: 120_000 });
    const timedOutResponse = responseDouble();
    timedOut.attach(timedOutResponse.response);
    const timedOutTurn = timedOut.agent.run({ event: visitorEvent({ eventId: "timeout" }) });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(timedOutTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(timedOut.resolve(controlFrame("timeout", "late"))).toBe(false);
    timedOut.close();
    expect(vi.getTimerCount()).toBe(0);

    const closed = createAgentChannel();
    const closedResponse = responseDouble();
    closed.attach(closedResponse.response);
    const closedTurn = closed.agent.run({ event: visitorEvent({ eventId: "close" }) });
    closed.close();
    await expect(closedTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
  });
});
