import { describe, expect, it } from "vitest";
import type { ClientEvent, VisitorContext } from "@facet/core";
import { createLateWindow, isStaleLateResult, LATE_WINDOW_LIMIT, type ParkedTurn } from "./late.js";

const visitor: VisitorContext = { visitorId: "v" };
const event: ClientEvent = { kind: "message", text: "hi" };
const turn = (index: number): ParkedTurn => ({ visitor, event, index, era: "e0" });

describe("createLateWindow", () => {
  it("parks and takes a turn, then reports it gone", () => {
    const window = createLateWindow(4);
    window.park(1, turn(0));
    expect(window.size).toBe(1);
    expect(window.take(1)).toEqual(turn(0));
    expect(window.size).toBe(0);
    // A second take is a miss (consumed).
    expect(window.take(1)).toBeUndefined();
  });

  it("takes an unknown requestId as a miss", () => {
    const window = createLateWindow(4);
    expect(window.take(99)).toBeUndefined();
  });

  it("drops the OLDEST parked turn (FIFO) past the limit", () => {
    const window = createLateWindow(3);
    window.park(1, turn(1));
    window.park(2, turn(2));
    window.park(3, turn(3));
    window.park(4, turn(4)); // over the cap → evicts the oldest (id 1)
    expect(window.size).toBe(3);
    expect(window.take(1)).toBeUndefined(); // evicted
    expect(window.take(2)).toEqual(turn(2));
    expect(window.take(3)).toEqual(turn(3));
    expect(window.take(4)).toEqual(turn(4));
  });

  it("exposes a sensible default limit", () => {
    expect(LATE_WINDOW_LIMIT).toBe(100);
  });
});

describe("isStaleLateResult", () => {
  it("is fresh when the era matches and no newer turn has applied", () => {
    expect(isStaleLateResult({ era: "e0", index: 2 }, { era: "e0", lastApplied: 2 })).toBe(false);
    expect(isStaleLateResult({ era: "e0", index: 2 }, { era: "e0", lastApplied: 1 })).toBe(false);
  });

  it("is stale on an era re-mint", () => {
    expect(isStaleLateResult({ era: "e0", index: 2 }, { era: "e1", lastApplied: 0 })).toBe(true);
  });

  it("is stale when a newer turn already applied", () => {
    expect(isStaleLateResult({ era: "e0", index: 2 }, { era: "e0", lastApplied: 3 })).toBe(true);
  });
});
