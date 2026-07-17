import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@facet/core";
import { createFrameLogStore, FRAME_LOG_LIMIT, MAX_FRAME_SESSIONS } from "./frame-log.js";

const say = (text: string): ServerMessage => ({ kind: "say", text });

describe("createFrameLogStore", () => {
  it("mints a fresh log on first touch and reuses it on the next", () => {
    const store = createFrameLogStore();
    const first = store.logFor("v");
    expect(first).toEqual({
      era: expect.any(String),
      nextSeq: 0,
      frames: [],
      eventCounter: 0,
      lastApplied: -1,
    });
    // Same visitor → same live object (mutations persist).
    first.eventCounter = 3;
    expect(store.logFor("v").eventCounter).toBe(3);
  });

  it("assigns ascending seqs and stamps <era>:<seq> on append", () => {
    const store = createFrameLogStore();
    const era = store.logFor("v").era;
    const stamped = store.append("v", [say("a"), say("b")]);
    expect(stamped).toEqual([
      { id: `${era}:0`, json: JSON.stringify(say("a")) },
      { id: `${era}:1`, json: JSON.stringify(say("b")) },
    ]);
    expect(store.logFor("v").nextSeq).toBe(2);
  });

  it("bounds the ring at FRAME_LOG_LIMIT, dropping the oldest frames", () => {
    const store = createFrameLogStore();
    const total = FRAME_LOG_LIMIT + 5;
    for (let i = 0; i < total; i += 1) store.append("v", [say(`m${i}`)]);
    const log = store.logFor("v");
    expect(log.frames.length).toBe(FRAME_LOG_LIMIT);
    // Seqs keep climbing (nextSeq is not reset by the ring trim)…
    expect(log.nextSeq).toBe(total);
    // …and the ring retains the newest window, oldest shifted off.
    expect(log.frames[0]?.seq).toBe(total - FRAME_LOG_LIMIT);
    expect(log.frames.at(-1)?.seq).toBe(total - 1);
  });

  it("evicts the LRU session and re-mints a fresh era when it returns", () => {
    const store = createFrameLogStore();
    const firstEra = store.logFor("s0").era;
    // Fill past the cap so s0 (untouched, oldest) is evicted.
    for (let i = 1; i <= MAX_FRAME_SESSIONS; i += 1) store.logFor(`s${i}`);
    // s0 no longer present → peek misses.
    expect(store.peek("s0")).toBeUndefined();
    // Re-creating it mints a new era (a stale token can't replay across the re-mint).
    const secondEra = store.logFor("s0").era;
    expect(secondEra).not.toBe(firstEra);
  });

  it("touch keeps a hot session from being the eviction victim", () => {
    const store = createFrameLogStore();
    store.logFor("hot");
    // Insert cap-1 others, then touch "hot", then push one more over the cap.
    for (let i = 1; i < MAX_FRAME_SESSIONS; i += 1) store.logFor(`s${i}`);
    store.logFor("hot"); // touch → newest
    store.logFor("overflow"); // evicts the now-oldest (s1), not "hot"
    expect(store.peek("hot")).toBeDefined();
    expect(store.peek("s1")).toBeUndefined();
  });

  describe("resume", () => {
    it("returns the frames past seq for a valid in-range token", () => {
      const store = createFrameLogStore();
      const era = store.logFor("v").era;
      store.append("v", [say("a"), say("b"), say("c")]); // seq 0,1,2
      const replay = store.resume("v", era, 0);
      expect(replay).toEqual([
        { id: `${era}:1`, json: JSON.stringify(say("b")) },
        { id: `${era}:2`, json: JSON.stringify(say("c")) },
      ]);
    });

    it("resumes from -1 (the virgin snapshot base) by replaying the whole ring", () => {
      const store = createFrameLogStore();
      const era = store.logFor("v").era;
      store.append("v", [say("a"), say("b")]);
      const replay = store.resume("v", era, -1);
      expect(replay?.map((f) => f.id)).toEqual([`${era}:0`, `${era}:1`]);
    });

    it("rejects an era mismatch and an unknown session", () => {
      const store = createFrameLogStore();
      const era = store.logFor("v").era;
      store.append("v", [say("a")]);
      expect(store.resume("v", "wrong-era", 0)).toBeUndefined();
      expect(store.resume("unknown", era, 0)).toBeUndefined();
    });

    it("rejects a token whose gap has fallen out of the ring", () => {
      const store = createFrameLogStore();
      const era = store.logFor("v").era;
      for (let i = 0; i < FRAME_LOG_LIMIT + 10; i += 1) store.append("v", [say(`m${i}`)]);
      // seq 0 fell off the ring long ago → the head of the gap is gone.
      expect(store.resume("v", era, 0)).toBeUndefined();
      // A seq beyond the newest is also out of range.
      expect(store.resume("v", era, FRAME_LOG_LIMIT + 100)).toBeUndefined();
    });
  });

  describe("recordApplied", () => {
    it("advances lastApplied as a running max, never backward", () => {
      const store = createFrameLogStore();
      const era = store.logFor("v").era;
      store.recordApplied("v", 2, era);
      expect(store.logFor("v").lastApplied).toBe(2);
      store.recordApplied("v", 5, era);
      expect(store.logFor("v").lastApplied).toBe(5);
      store.recordApplied("v", 3, era); // older index → no regression
      expect(store.logFor("v").lastApplied).toBe(5);
    });

    it("ignores a record whose era predates a re-mint (cross-era index is meaningless)", () => {
      const store = createFrameLogStore();
      const stale = store.nextArrival("v"); // {index: 0, era: old}
      // Simulate the LRU re-mint that happens under session churn: force a new
      // entry by evicting via the public surface (fill past the cap).
      for (let i = 0; i < MAX_FRAME_SESSIONS; i += 1) store.logFor(`churn-${i}`);
      const reminted = store.logFor("v");
      expect(reminted.era).not.toBe(stale.era);
      store.recordApplied("v", stale.index, stale.era); // old-era record → skipped
      expect(store.logFor("v").lastApplied).toBe(-1);
    });

    it("nextArrival returns an atomic, monotonically increasing {index, era} pair", () => {
      const store = createFrameLogStore();
      const a1 = store.nextArrival("v");
      const a2 = store.nextArrival("v");
      expect(a1.index).toBe(0);
      expect(a2.index).toBe(1);
      expect(a1.era).toBe(a2.era);
      expect(a1.era).toBe(store.logFor("v").era);
    });
  });
});
