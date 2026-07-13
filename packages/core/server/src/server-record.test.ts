import { afterEach, describe, expect, it } from "vitest";
import { MAX_FIELD_VALUE_CHARS, type FacetAgent } from "@facet/core";
import { MemorySink, type Sink, type StoredEvent } from "@facet/runtime";
import type { FacetServer } from "./server.js";
import {
  collectEvents,
  postEvent,
  postRecord,
  sayAgent,
  sayText,
  start,
  waitFor,
} from "./server.test-support.js";

let running: FacetServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("record channel (WU-5)", () => {
  it("POST /record persists a collected tap without invoking the agent and rejects malformed bodies", async () => {
    const sink = new MemorySink();
    let agentCalls = 0;
    const countingAgent: FacetAgent = () => {
      agentCalls += 1;
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: countingAgent, sink });
    running = server;

    // A valid collected local tap (a renderer-resolved navigate) persists to the Sink…
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
    const history = await sink.history("a", "v");
    expect(history).toHaveLength(1);
    expect(history[0]?.event.kind).toBe("tap");
    expect(history[0]?.event.kind === "tap" ? history[0]?.event.effect : undefined).toEqual({
      navigate: "about",
    });
    // …with NO agent turn and NO stage patch (a local tap never reaches the brain — DC-005).
    expect(history[0]?.messages).toEqual([]);
    expect(agentCalls).toBe(0);

    // A malformed /record body → 400 with no Sink write (DC-007).
    const bad = await postRecord(base, "v", { kind: "nope" });
    expect(bad.status).toBe(400);
    // Give any (erroneous) lane task a chance to run, then assert history is unchanged.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(1);
    expect(agentCalls).toBe(0);
  });

  it("400-rejects a /event tap whose action.kind is not agent (RISK-INV-4)", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // A spoofed local-effect tap must never reach the agent over the forward /event
    // channel — only an "agent" (or bare-name) action is legal there.
    const response = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "v" },
        event: { kind: "tap", action: { kind: "toggle", name: "x", node: "n" } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("appends interleaved /event, /record, /event in send order (DC-002)", async () => {
    const sink = new MemorySink();
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // The first message turn (A) parks on the gate so B(/record) and C(/event)
    // enqueue behind it on the SAME per-visitor lane.
    const slowAgent: FacetAgent = async (event) => {
      if (event.kind === "message" && event.text === "A") {
        await gate;
        return [{ kind: "say", text: "A-done" }];
      }
      return [];
    };
    const { server, base } = await start({ agentId: "a", agent: slowAgent, sink });
    running = server;

    // Await each 202 so its lane enqueue has committed (the handler enqueues
    // synchronously right after res.end()) before the next request is sent.
    expect((await postEvent(base, "v", { kind: "message", text: "A" })).status).toBe(202);
    expect(
      (await postRecord(base, "v", { kind: "tap", target: "t", effect: { toggle: "n" } })).status,
    ).toBe(202);
    expect((await postEvent(base, "v", { kind: "message", text: "C" })).status).toBe(202);

    release();
    await waitFor(async () => (await sink.history("a", "v")).length >= 3);
    const history = await sink.history("a", "v");
    // Append order == send order, independent of async sink latency or `at`.
    expect(history.map((e) => e.event.kind)).toEqual(["message", "tap", "message"]);
    expect(history[0]?.event.kind === "message" ? history[0]?.event.text : undefined).toBe("A");
    expect(history[2]?.event.kind === "message" ? history[2]?.event.text : undefined).toBe("C");
  });
});

describe("record validation hardening", () => {
  it("POST /record rejects a non-number seq and an over-long effect/target string", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A non-number `seq` must be rejected: the guard narrows the body to a
    // CollectedEvent whose `seq?: number`, so a `"x"` (or `{}`) would be
    // persisted as a non-number while TS believes it's `number | undefined`.
    const badSeq = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      seq: "x",
    });
    expect(badSeq.status).toBe(400);

    // An over-long navigate string (past the shared field cap) must be rejected
    // so a ~5 MiB effect can't be persisted into the unbounded Sink.
    const longNav = await postRecord(base, "v", {
      kind: "tap",
      effect: { navigate: "x".repeat(MAX_FIELD_VALUE_CHARS + 1) },
    });
    expect(longNav.status).toBe(400);

    // An over-long `target` string must be rejected too (same cap as fields).
    const longTarget = await postRecord(base, "v", {
      kind: "tap",
      target: "t".repeat(MAX_FIELD_VALUE_CHARS + 1),
      effect: { toggle: "n" },
    });
    expect(longTarget.status).toBe(400);

    // No Sink write for any rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);

    // A valid small effect (with a numeric seq) still 202s and persists.
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "cta",
      effect: { navigate: "about" },
      seq: 3,
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
  });

  it("isTapEffect rejects malformed /record effects", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // effect present but not an object → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: "nope" })).status).toBe(400);
    // navigate present but not a string → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: { navigate: 7 } })).status).toBe(
      400,
    );
    // toggle present but not a string → rejected.
    expect((await postRecord(base, "v", { kind: "tap", effect: { toggle: {} } })).status).toBe(400);
    // both effect branches present → rejected because a TapEffect is either/or.
    expect(
      (
        await postRecord(base, "v", {
          kind: "tap",
          effect: { navigate: "screen", toggle: "panel" },
        })
      ).status,
    ).toBe(400);
    // neither key present → isTapEffect defines this invalid.
    expect((await postRecord(base, "v", { kind: "tap", effect: {} })).status).toBe(400);

    // None of these wrote to the Sink.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });

  it("POST /record rejects a semantically-empty tap (no effect or target)", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A bare `{kind:"tap"}` carries no actionable local-tap payload: no effect and
    // no target. The renderer ALWAYS attaches a navigate/toggle effect (+ target) to
    // a local tap, so an effect/target-less tap can only be a hand-crafted body. It
    // must 400 so no inert no-content StoredEvent is persisted (which would later
    // replay as an `(unknown event)` prompt line).
    const empty = await postRecord(base, "v", { kind: "tap" });
    expect(empty.status).toBe(400);

    // Fields-only (still no effect and no target) is just as inert → rejected.
    const fieldsOnly = await postRecord(base, "v", { kind: "tap", fields: { a: "b" } });
    expect(fieldsOnly.status).toBe(400);

    // Neither wrote to the Sink.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);

    // A valid tap that carries a target + effect still 202s and persists.
    const ok = await postRecord(base, "v", {
      kind: "tap",
      target: "box1",
      effect: { navigate: "pricing" },
    });
    expect(ok.status).toBe(202);
    await waitFor(async () => (await sink.history("a", "v")).length >= 1);
    expect(await sink.history("a", "v")).toHaveLength(1);
  });

  it("POST /record rejects a target-only tap with no renderable effect", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A hand-crafted `{kind:"tap", target:"x"}` carries a `target` but NO renderable
    // payload: `describeEvent` renders a tap from its `effect` (or `action`), never
    // from `target`, so this would replay as the very `(unknown event)` prompt line
    // the drop guard exists to prevent. `action` is already rejected on /record, so a
    // local tap can only render via `effect` — a target-only tap must 400.
    const targetOnly = await postRecord(base, "v", { kind: "tap", target: "x" });
    expect(targetOnly.status).toBe(400);

    // No Sink write for the rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });
});

/** A Sink whose `record` for a collected LOCAL tap (kind "tap", no messages) hangs
 * until `release()` — modelling a slow/hung durable Sink under load. Message/agent
 * turns record through untouched. Used to prove /record's write is fire-and-forget
 * on the shared per-visitor lane and can't wedge a later /event turn. */
class GatedSink implements Sink {
  private readonly inner = new MemorySink();
  gateTapRecord = false;
  private releaseHeld: () => void = () => {};
  private readonly held = new Promise<void>((r) => {
    this.releaseHeld = r;
  });
  release(): void {
    this.releaseHeld();
  }
  async record(agentId: string, visitorId: string, entry: StoredEvent): Promise<void> {
    if (this.gateTapRecord && entry.event.kind === "tap" && entry.messages.length === 0) {
      await this.held;
    }
    return this.inner.record(agentId, visitorId, entry);
  }
  history(agentId: string, visitorId: string): Promise<readonly StoredEvent[]> {
    return this.inner.history(agentId, visitorId);
  }
}

describe("record + event validation hardening (round 2)", () => {
  const postRawEvent = (base: string, event: unknown): Promise<Response> =>
    fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitor: { visitorId: "v" }, event }),
    });
  const postRawEventBody = (base: string, body: string): Promise<Response> =>
    fetch(`${base}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

  it("POST /record rejects a tap carrying an action (null or object)", async () => {
    const sink = new MemorySink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;

    // A local navigate/toggle tap only ever carries `effect` — never `action`. An
    // `action` (even null) must 400 at the boundary so it can't be persisted verbatim
    // to the Sink (poisoning the durable log / bypassing the field cap).
    expect((await postRecord(base, "v", { kind: "tap", action: null })).status).toBe(400);
    expect(
      (await postRecord(base, "v", { kind: "tap", action: { kind: "agent", name: "x" } })).status,
    ).toBe(400);

    // No Sink write for either rejected body.
    await new Promise((r) => setTimeout(r, 50));
    expect(await sink.history("a", "v")).toHaveLength(0);
  });

  it("POST /record does not block a later /event on a slow sink", async () => {
    const sink = new GatedSink();
    const { server, base } = await start({ agentId: "a", agent: sayAgent, sink });
    running = server;
    const stream = await fetch(`${base}/stream?visitorId=v`);

    // The /record's Sink write hangs. On the shared per-visitor lane an `await`ed
    // record would wedge the visitor's later /event (head-of-line blocking). With
    // fire-and-forget, the lane frees after the synchronous slot reservation.
    sink.gateTapRecord = true;
    expect(
      (await postRecord(base, "v", { kind: "tap", target: "t", effect: { toggle: "n" } })).status,
    ).toBe(202);
    expect((await postEvent(base, "v", { kind: "message", text: "hi" })).status).toBe(202);

    // The /event turn's say must arrive WITHOUT the hung sink write ever settling.
    const frames = await collectEvents(stream, 800);
    expect(sayText(frames)).toContain("hello from agent");
    sink.release(); // let the parked writes drain so close() doesn't hang
  });

  it("POST /event rejects a tap carrying effect or target", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // effect/target are LOCAL-tap fields; an /event agent tap carries `action` only.
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, effect: { navigate: "a" } }))
        .status,
    ).toBe(400);
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, target: "cta" })).status,
    ).toBe(400);
  });

  it("POST /event rejects a non-number seq", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;
    // `seq` narrows to `number | undefined`; a non-number must 400 (not persist unsoundly).
    expect((await postRawEvent(base, { kind: "message", text: "hi", seq: "x" })).status).toBe(400);
    expect(
      (await postRawEvent(base, { kind: "tap", action: { name: "x" }, seq: "x" })).status,
    ).toBe(400);
    expect(
      (
        await postRawEventBody(
          base,
          '{"visitor":{"visitorId":"v"},"event":{"kind":"message","text":"hi","seq":1e309}}',
        )
      ).status,
    ).toBe(400);
  });

  it("POST /event rejects malformed visitor context and non-finite payload numbers", async () => {
    const { server, base } = await start({ agentId: "a", agent: sayAgent });
    running = server;

    expect(
      (
        await postRawEventBody(
          base,
          '{"visitor":{"visitorId":"v","locale":1},"event":{"kind":"message","text":"hi"}}',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postRawEventBody(
          base,
          '{"visitor":{"visitorId":"v"},"event":{"kind":"visit","visitor":{"visitorId":"v","relationship":false}}}',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postRawEventBody(
          base,
          '{"visitor":{"visitorId":"v"},"event":{"kind":"tap","action":{"name":"x","payload":{"n":1e309}}}}',
        )
      ).status,
    ).toBe(400);
  });
});
