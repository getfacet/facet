import type { ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentControlFrame, AgentEventFrame, TurnOutcome } from "@facet/core";
import { createAgentChannel, REMOTE_TIMEOUT_TEXT } from "./agent-channel.js";
import { conversation, eventReader, postEvent, start, agentEvent } from "./server.test-support.js";
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

function controlFrame(eventId: string, text: string): AgentControlFrame {
  return {
    kind: "agent_control",
    eventId,
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

function agentReader(response: Response): {
  readonly next: () => Promise<AgentEventFrame>;
  readonly close: () => Promise<void>;
} {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no agent stream");
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (): Promise<AgentEventFrame> => {
    for (;;) {
      const split = buffer.indexOf("\n\n");
      if (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const line = block.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (line !== undefined) {
          const parsed = JSON.parse(line.slice(6)) as AgentEventFrame;
          if (parsed.kind === "agent_event") return parsed;
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

    const response = await postEvent(base, "s1", agentEvent());
    const delivered = await reader.next();
    await reader.close();

    expect(response.status).toBe(202);
    expect(delivered?.data).toMatchObject({
      ...conversation("event1", "assistant", OFFLINE_TEXT),
      at: expect.any(Number) as number,
    });
  });

  it("sends AgentEventFrame to a connected agent and accepts a correlated TurnOutcome", async () => {
    const { server, base } = await start({ agent: undefined });
    active = server;
    const agentStream = await fetch(`${base}/agent/stream`);
    const agent = agentReader(agentStream);
    const browser = eventReader(await fetch(`${base}/stream?sessionKey=s1`));
    await browser.next(); // root resync

    const pending = postEvent(base, "s1", agentEvent({ eventId: "event1", stageRevision: 0 }));
    const frame = await agent.next();
    const outcome: TurnOutcome = {
      stageRevision: 0,
      patches: [],
      conversation: conversation("event1", "assistant", "remote answer"),
    };
    const control = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "agent_control", eventId: "event1", outcome }),
    });
    const delivered = await browser.next();
    await browser.close();
    await agent.close();

    expect(frame).toEqual({ kind: "agent_event", event: agentEvent({ eventId: "event1" }) });
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

    const pending = postEvent(base, "s1", agentEvent({ eventId: "event1", stageRevision: 0 }));
    await agent.next();
    const invalidOutcome: TurnOutcome = {
      stageRevision: 0,
      patches: [{ op: "replace", path: "/data", value: { status: "not allowed" } }],
      conversation: conversation("event1", "assistant", "remote answer"),
    };
    const invalid = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "agent_control", eventId: "event1", outcome: invalidOutcome }),
    });
    const validOutcome: TurnOutcome = {
      stageRevision: 0,
      patches: [],
      conversation: conversation("event1", "assistant", "remote answer"),
    };
    const valid = await fetch(`${base}/agent/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "agent_control", eventId: "event1", outcome: validOutcome }),
    });
    await browser.next();
    await browser.close();
    await agent.close();

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(202);
    expect((await pending).status).toBe(202);
  });

  it("does not overwrite a pending turn when two sessions reuse the same eventId", async () => {
    const channel = createAgentChannel();
    const res = responseDouble();
    channel.attach(res.response);

    const first = channel.agent.run({ event: agentEvent({ eventId: "same-id" }) });
    const duplicate = channel.agent.run({
      event: agentEvent({ eventId: "same-id", screen: "other-screen" }),
    });

    expect(dataWrites(res.writes)).toHaveLength(1);
    await expect(duplicate).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(channel.resolve(controlFrame("same-id", "first answer"))).toBe(true);
    await expect(first).resolves.toEqual({ text: "first answer" });
    expect(channel.resolve(controlFrame("same-id", "late duplicate"))).toBe(false);
    channel.close();
  });

  it("settles a stale heartbeat reaper path once and leaves no pending control entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const channel = createAgentChannel();
    const res = responseDouble();
    channel.attach(res.response);

    const pending = channel.agent.run({ event: agentEvent({ eventId: "reaped" }) });
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
    const droppedTurn = dropped.agent.run({ event: agentEvent({ eventId: "drop" }) });
    dropped.dropIfCurrent(droppedResponse.response);
    await expect(droppedTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(dropped.resolve(controlFrame("drop", "late"))).toBe(false);
    dropped.close();

    vi.useFakeTimers();
    vi.setSystemTime(0);
    const timedOut = createAgentChannel({ agentTimeoutMs: 120_000 });
    const timedOutResponse = responseDouble();
    timedOut.attach(timedOutResponse.response);
    const timedOutTurn = timedOut.agent.run({ event: agentEvent({ eventId: "timeout" }) });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(timedOutTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
    expect(timedOut.resolve(controlFrame("timeout", "late"))).toBe(false);
    timedOut.close();
    expect(vi.getTimerCount()).toBe(0);

    const closed = createAgentChannel();
    const closedResponse = responseDouble();
    closed.attach(closedResponse.response);
    const closedTurn = closed.agent.run({ event: agentEvent({ eventId: "close" }) });
    closed.close();
    await expect(closedTurn).resolves.toEqual({ text: REMOTE_TIMEOUT_TEXT });
  });
});
