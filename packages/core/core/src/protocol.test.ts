import { describe, expect, it } from "vitest";
import type { FacetAction } from "./nodes.js";
import {
  asAgentServerMessage,
  isJsonPatchTestOperation,
  isTestOnlyServerMessageBatch,
  MAX_FIELD_OPTIONS,
} from "./protocol.js";
import type {
  AgentEventFrame,
  ClientEvent,
  CollectedEvent,
  FacetAgent,
  FacetTransport,
  TapEffect,
} from "./protocol.js";
import type { ViewSnapshot } from "./view.js";

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

  it("an optional view snapshot rides every ClientEvent variant", () => {
    const view: ViewSnapshot = {
      screen: "pricing",
      toggled: { faq: "shown" },
      viewport: "narrow",
      colorMode: "dark",
    };
    const action: FacetAction = { kind: "agent", name: "submit" };
    const visit = {
      kind: "visit",
      visitor: { visitorId: "v" },
      view,
    } as const satisfies ClientEvent;
    const message = { kind: "message", text: "hi", view } as const satisfies ClientEvent;
    const tap = { kind: "tap", action, view } as const satisfies ClientEvent;
    expect([visit.view, message.view, tap.view]).toEqual([view, view, view]);
  });

  it("an optional view snapshot rides every CollectedEvent variant", () => {
    const view: ViewSnapshot = { screen: "home" };
    const visit = {
      kind: "visit",
      visitor: { visitorId: "v" },
      view,
    } as const satisfies CollectedEvent;
    const message = { kind: "message", text: "hi", view } as const satisfies CollectedEvent;
    const localTap = {
      kind: "tap",
      target: "cta-box",
      effect: { navigate: "pricing" },
      view,
    } as const satisfies CollectedEvent;
    expect([visit.view, message.view, localTap.view]).toEqual([view, view, view]);
  });

  it("a ClientEvent carrying view stays assignable to CollectedEvent (forward ⊆ collected)", () => {
    const view: ViewSnapshot = { screen: "pricing", colorMode: "light" };
    const events: ClientEvent[] = [
      { kind: "visit", visitor: { visitorId: "v" }, view },
      { kind: "message", text: "hi", view },
      { kind: "tap", action: { kind: "agent", name: "go" }, view },
    ];
    for (const event of events) {
      expectAssignableTo<CollectedEvent>(event);
    }
    expect(events).toHaveLength(3);
  });
});

describe("agent server-message helpers", () => {
  it("narrows and JSON-normalizes the agent-emitted server-message subset", () => {
    expect(asAgentServerMessage({ kind: "say", text: "hi", extra: "drop" })).toEqual({
      kind: "say",
      text: "hi",
    });
    expect(
      asAgentServerMessage({
        kind: "patch",
        patches: [{ op: "test", path: "/root", value: "root" }],
        extra: "drop",
      }),
    ).toEqual({ kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] });
  });

  it("rejects reset as an agent-emitted server message", () => {
    expect(asAgentServerMessage({ kind: "reset" })).toBeUndefined();
  });

  it("single-sources RFC 6902 test-op detection and test-only batch detection", () => {
    expect(isJsonPatchTestOperation({ op: "test", path: "/root", value: "root" })).toBe(true);
    expect(isJsonPatchTestOperation({ op: "replace", path: "/root", value: "root" })).toBe(false);
    expect(isJsonPatchTestOperation(null)).toBe(false);
    expect(
      isTestOnlyServerMessageBatch([
        { kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] },
      ]),
    ).toBe(true);
    expect(
      isTestOnlyServerMessageBatch([
        { kind: "patch", patches: [{ op: "test", path: "/root", value: "root" }] },
        { kind: "say", text: "not a guard" },
      ]),
    ).toBe(false);
  });
});
