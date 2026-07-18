import { afterEach, describe, expect, it } from "vitest";
import type { AgentEventFrame, FacetTree, ServerMessage } from "@facet/core";
import { MemorySink, MemoryStageStore } from "@facet/runtime";
import {
  type FacetServer,
  type FacetServerObservation,
  type FacetServerObserver,
} from "./server.js";
import { eventReader, postEvent, postRecord, start, waitFor } from "./server.test-support.js";

interface AgentLink {
  nextEvent(): Promise<AgentEventFrame>;
  close(): Promise<void>;
}

async function dialAgent(base: string): Promise<AgentLink> {
  const response = await fetch(`${base}/agent/stream`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no agent body");
  const decoder = new TextDecoder();
  let buffer = "";

  const nextEvent = async (): Promise<AgentEventFrame> => {
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6)) as { type?: string };
          if (data.type === "event") return data as AgentEventFrame;
        }
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("agent stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };

  return { nextEvent, close: () => reader.cancel() };
}

function control(
  base: string,
  requestId: number,
  messages: readonly ServerMessage[],
): Promise<Response> {
  return fetch(`${base}/agent/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, messages }),
  });
}

const tree = (label: string): FacetTree => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", style: { direction: "column" }, children: ["label"] },
    label: { id: "label", type: "text", value: label },
  },
});

let running: FacetServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("Facet server observer", () => {
  it("observes detached live and late frames without becoming a writer", async () => {
    const stageStore = new MemoryStageStore();
    const sink = new MemorySink();
    const observations: FacetServerObservation[] = [];
    let hostileThenReads = 0;
    const unhandledRejections: unknown[] = [];
    const captureUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    const observer: FacetServerObserver = (observation) => {
      observations.push(observation);

      try {
        (observation.visitor as { visitorId: string }).visitorId = "observer-corrupted";
      } catch {
        // Frozen observations reject mutation; detachment is asserted below too.
      }
      try {
        (observation.event as { kind: string }).kind = "observer-corrupted";
      } catch {
        // Frozen observations reject mutation.
      }
      if (observation.kind === "accepted-frame") {
        try {
          (observation.messages as unknown as ServerMessage[])[0] = {
            kind: "say",
            text: "observer-corrupted",
          };
        } catch {
          // Frozen observations reject mutation.
        }
        try {
          if (observation.stage !== undefined) {
            (observation.stage as { root: string }).root = "observer-corrupted";
          }
        } catch {
          // Frozen observations reject mutation.
        }
      }

      if (observations.length === 1) {
        return Promise.reject(new Error("async observer failure must be swallowed"));
      }
      if (observations.length === 2) {
        return Object.defineProperty({}, "then", {
          get() {
            hostileThenReads += 1;
            throw new Error("hostile then getter must be swallowed");
          },
        });
      }
      if (observations.length === 3) throw new Error("observer failure must be swallowed");
    };

    const started = await start({
      agentId: "a",
      agentTimeoutMs: 200,
      stageStore,
      sink,
      observer,
    });
    running = started.server;
    const { base } = started;
    const link = await dialAgent(base);
    const response = await fetch(`${base}/stream?visitorId=v`);
    const stream = eventReader(response);
    process.on("unhandledRejection", captureUnhandledRejection);

    try {
      expect((await stream.next(500))?.data).toEqual({ kind: "reset" });

      expect(
        (
          await postRecord(base, "v", {
            kind: "tap",
            target: "tab",
            effect: { navigate: "details" },
          })
        ).status,
      ).toBe(202);

      expect((await postEvent(base, "v", { kind: "message", text: "live" })).status).toBe(202);
      const live = await link.nextEvent();
      expect(
        (
          await control(base, live.requestId, [
            { kind: "patch", patches: [{ op: "replace", path: "", value: tree("live") }] },
            { kind: "say", text: "live answer" },
          ])
        ).status,
      ).toBe(202);
      expect((await stream.next(500))?.data).toMatchObject({ kind: "patch" });
      expect((await stream.next(500))?.data).toEqual({ kind: "say", text: "live answer" });

      expect((await postEvent(base, "v", { kind: "message", text: "slow" })).status).toBe(202);
      const slow = await link.nextEvent();
      await waitFor(async () =>
        observations.some(
          (item) =>
            item.kind === "accepted-frame" &&
            item.source === "live" &&
            item.event.kind === "message" &&
            item.event.text === "slow",
        ),
      );

      expect((await postEvent(base, "v", { kind: "message", text: "newer" })).status).toBe(202);
      const newer = await link.nextEvent();
      expect(
        (
          await control(base, newer.requestId, [
            { kind: "patch", patches: [{ op: "replace", path: "", value: tree("newer") }] },
            { kind: "say", text: "newer answer" },
          ])
        ).status,
      ).toBe(202);
      await waitFor(async () =>
        observations.some(
          (item) =>
            item.kind === "accepted-frame" &&
            item.source === "live" &&
            item.stage?.nodes["label"]?.type === "text" &&
            item.stage.nodes["label"].value === "newer",
        ),
      );

      expect(
        (
          await control(base, slow.requestId, [
            { kind: "patch", patches: [{ op: "replace", path: "", value: tree("stale") }] },
            { kind: "say", text: "late answer" },
          ])
        ).status,
      ).toBe(202);
      await waitFor(async () =>
        observations.some(
          (item) =>
            item.kind === "accepted-frame" &&
            item.source === "late" &&
            item.disposition === "say-only-stale",
        ),
      );

      const late = observations.find(
        (item) => item.kind === "accepted-frame" && item.source === "late",
      );
      expect(late).toMatchObject({
        kind: "accepted-frame",
        source: "late",
        disposition: "say-only-stale",
        agentMutated: false,
        visitor: { visitorId: "v" },
        event: { kind: "message", text: "slow" },
        messages: [{ kind: "say", text: "late answer" }],
      });
      if (late?.kind !== "accepted-frame") throw new Error("missing late observation");
      const slowInput = observations.find(
        (item) =>
          item.kind === "ui-in" &&
          item.source === "forwarded" &&
          item.event.kind === "message" &&
          item.event.text === "slow",
      );
      expect(slowInput?.turnId).not.toBeNull();
      expect(late.turnId).toBe(slowInput?.turnId);
      expect(late.stage?.nodes["label"]).toMatchObject({ type: "text", value: "newer" });
      expect(Object.isFrozen(late)).toBe(true);
      expect(Object.isFrozen(late.messages)).toBe(true);
      expect(Object.isFrozen(late.stage)).toBe(true);

      expect((await stream.next(500))?.data).toEqual({ kind: "say", text: expect.any(String) });
      expect((await stream.next(500))?.data).toMatchObject({ kind: "patch" });
      expect((await stream.next(500))?.data).toEqual({ kind: "say", text: "newer answer" });
      expect((await stream.next(500))?.data).toEqual({ kind: "say", text: "late answer" });

      const persisted = await stageStore.get("a", "v");
      expect(persisted?.stage.nodes["label"]).toMatchObject({ type: "text", value: "newer" });
      const history = await sink.history("a", "v");
      expect(history.map((entry) => entry.event.kind)).toEqual([
        "tap",
        "message",
        "message",
        "message",
        "message",
      ]);
      expect(history[0]?.event).toMatchObject({
        kind: "tap",
        target: "tab",
        effect: { navigate: "details" },
      });

      expect(
        observations.filter((item) => item.kind === "ui-in").map((item) => item.source),
      ).toEqual(["record", "forwarded", "forwarded", "forwarded"]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(hostileThenReads).toBe(1);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", captureUnhandledRejection);
      await stream.close();
      await link.close();
    }
  });

  it("reports mutation truth per streamed frame without buffering the turn", async () => {
    const observations: FacetServerObservation[] = [];
    const started = await start({
      agentId: "streaming-observer",
      observer: (item) => observations.push(item),
      agent: async function* () {
        yield [{ kind: "patch", patches: [{ op: "replace", path: "", value: tree("first") }] }];
        yield [{ kind: "say", text: "after patch" }];
      },
    });
    running = started.server;
    const response = await fetch(`${started.base}/stream?visitorId=streaming-visitor`);
    const stream = eventReader(response);
    expect((await stream.next(500))?.data).toEqual({ kind: "reset" });
    expect(
      (
        await postEvent(started.base, "streaming-visitor", {
          kind: "message",
          text: "stream",
        })
      ).status,
    ).toBe(202);
    expect((await stream.next(500))?.data).toMatchObject({ kind: "patch" });
    expect((await stream.next(500))?.data).toEqual({ kind: "say", text: "after patch" });
    await waitFor(
      async () => observations.filter((item) => item.kind === "accepted-frame").length === 2,
    );
    const frames = observations.filter((item) => item.kind === "accepted-frame");
    expect(frames.map(({ agentMutated }) => agentMutated)).toEqual([true, false]);
    expect(new Set(frames.map(({ turnId }) => turnId)).size).toBe(1);
    await stream.close();
  });
});
