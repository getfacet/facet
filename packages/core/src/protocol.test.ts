import { describe, expect, it } from "vitest";
import type { FacetAction } from "./nodes.js";
import { MAX_FIELD_OPTIONS } from "./protocol.js";
import type {
  AgentEventFrame,
  ClientEvent,
  CollectedEvent,
  FacetAgent,
  FacetTransport,
  TapEffect,
} from "./protocol.js";

/**
 * Compile-time "value is assignable to B" assertion: the parameter is typed as
 * B, so passing an A-typed argument only compiles when A ⊆ B. These calls are
 * type-level gates — vitest strips the types, so the runtime body is a no-op and
 * `pnpm --filter @facet/core typecheck` is the real red_check for this file.
 */
const expectAssignableTo = <B>(_value: B): void => {};

describe("protocol event contract (type-level)", () => {
  it("a forwarded agent tap is assignable to both ClientEvent and CollectedEvent", () => {
    const action: FacetAction = { kind: "agent", name: "submit" };
    const forwardedTap = { kind: "tap", action } as const satisfies ClientEvent;
    // forward envelope is the FORWARD subset...
    expectAssignableTo<ClientEvent>(forwardedTap);
    // ...and is structurally assignable to the log currency (forward ⊆ collected).
    expectAssignableTo<CollectedEvent>(forwardedTap);
    expect(forwardedTap.kind).toBe("tap");
  });

  it("a local tap (target + effect) is a valid CollectedEvent", () => {
    const navEffect: TapEffect = { navigate: "pricing" };
    const toggleEffect: TapEffect = { toggle: "panel" };
    const localTap = {
      kind: "tap",
      target: "cta-box",
      effect: navEffect,
    } as const satisfies CollectedEvent;
    expectAssignableTo<CollectedEvent>(localTap);
    expectAssignableTo<CollectedEvent>({ kind: "tap", target: "x", effect: toggleEffect });
    expect(localTap.effect).toBe(navEffect);
  });

  it("an optional monotonic seq is accepted on every collected variant", () => {
    const visit = {
      kind: "visit",
      visitor: { visitorId: "v1" },
      seq: 1,
    } as const satisfies CollectedEvent;
    const message = { kind: "message", text: "hi", seq: 2 } as const satisfies CollectedEvent;
    const tap = { kind: "tap", target: "b", seq: 3 } as const satisfies CollectedEvent;
    // seq also rides the forward envelope (wire field, forward-compatible).
    const forwardWithSeq = {
      kind: "message",
      text: "yo",
      seq: 4,
    } as const satisfies ClientEvent;
    expect([visit.seq, message.seq, tap.seq, forwardWithSeq.seq]).toEqual([1, 2, 3, 4]);
  });

  it("every ClientEvent is assignable to CollectedEvent (forward ⊆ collected)", () => {
    const events: ClientEvent[] = [
      { kind: "visit", visitor: { visitorId: "v" } },
      { kind: "message", text: "hi" },
      { kind: "tap", action: { kind: "agent", name: "go" } },
    ];
    for (const event of events) {
      expectAssignableTo<CollectedEvent>(event);
    }
    expect(events).toHaveLength(3);
  });

  it("the agent surface stays on ClientEvent (not CollectedEvent)", () => {
    // FacetAgent's event parameter is ClientEvent: a ClientEvent value flows in.
    const agent: FacetAgent = (event) => {
      expectAssignableTo<ClientEvent>(event);
      return [];
    };
    const frame: AgentEventFrame = {
      type: "event",
      requestId: 1,
      visitorId: "v",
      event: { kind: "tap", action: { kind: "agent", name: "go" } },
    };
    expectAssignableTo<ClientEvent>(frame.event);
    expect(typeof agent).toBe("function");
  });

  it("FacetTransport.record accepts a CollectedEvent and is optional (additive)", () => {
    const collected: CollectedEvent = { kind: "tap", target: "b", effect: { navigate: "x" } };
    const transport: FacetTransport = {
      send: () => {},
      subscribe: () => () => {},
      record: (event) => {
        expectAssignableTo<CollectedEvent>(event);
      },
    };
    transport.record?.(collected);
    // omitting record still satisfies FacetTransport (optional method).
    const minimal: FacetTransport = { send: () => {}, subscribe: () => () => {} };
    expect([typeof transport.record, minimal.record]).toEqual(["function", undefined]);
  });

  it("exports the shared field options cap", () => {
    expect(MAX_FIELD_OPTIONS).toBe(64);
  });
});
