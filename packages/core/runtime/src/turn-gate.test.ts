import { describe, expect, it } from "vitest";

import { TurnGate } from "./turn-gate.js";
import type { TurnTerminal, TurnToken, WriteAuthority } from "./turn-gate.js";

function tokenFrom(result: ReturnType<TurnGate["admit"]>): TurnToken {
  if (result.outcome !== "admitted") {
    throw new Error(`expected admitted, got ${result.outcome}`);
  }
  return result.token;
}

describe("TurnGate admission", () => {
  it("admits one trigger and reports busy for a second distinct trigger of either kind", () => {
    const gate = new TurnGate();
    const visitor = tokenFrom(gate.admit("visitor-message:v1"));

    expect(gate.admit("agent-event:e1")).toEqual({ outcome: "busy" });
    gate.settle(visitor, "success");

    const agent = tokenFrom(gate.admit("agent-event:e2"));

    expect(gate.admit("visitor-message:v2")).toEqual({ outcome: "busy" });
    gate.settle(agent, "success");
  });

  it("dedupes a retransmitted trigger after the terminal receipt is retained", () => {
    const gate = new TurnGate();
    const token = tokenFrom(gate.admit("agent-event:e1"));
    const receipt = gate.settle(token, "success");

    expect(gate.admit("agent-event:e1")).toEqual({ outcome: "deduped", receipt });
  });

  it("does not queue a burst of distinct busy triggers", () => {
    const gate = new TurnGate();
    const token = tokenFrom(gate.admit("visitor-message:v1"));

    for (let index = 0; index < 300; index += 1) {
      expect(gate.admit(`agent-event:busy-${index}`)).toEqual({ outcome: "busy" });
    }
    gate.settle(token, "success");

    expect(gate.admit("agent-event:after-burst").outcome).toBe("admitted");
  });

  it("bounds retained receipts with a 256-entry LRU", () => {
    const gate = new TurnGate();
    for (let index = 0; index < 261; index += 1) {
      const token = tokenFrom(gate.admit(`event-${index}`));
      gate.settle(token, "success");
    }

    expect(gate.retainedReceiptCount()).toBe(256);
    expect(gate.admit("event-5").outcome).toBe("deduped");
    expect(gate.admit("event-0").outcome).toBe("admitted");
  });
});

describe("TurnGate lifecycle", () => {
  it("releases the slot on every terminal path", () => {
    const terminals: readonly TurnTerminal[] = [
      "success",
      "provider_error",
      "timeout",
      "disconnect",
      "conflict",
    ];

    for (const terminal of terminals) {
      const gate = new TurnGate();
      const token = tokenFrom(gate.admit(`event-${terminal}`));

      gate.settle(token, terminal);

      expect(gate.present({ kind: "turn", token })).toBe(false);
      expect(gate.admit(`event-after-${terminal}`).outcome).toBe("admitted");
    }
  });

  it("releases conflict turns without retaining a dedupe receipt", () => {
    const gate = new TurnGate();
    const token = tokenFrom(gate.admit("agent-event:stale"));

    gate.settle(token, "conflict");

    expect(gate.retainedReceiptCount()).toBe(0);
    expect(gate.admit("agent-event:stale").outcome).toBe("admitted");
  });

  it("forces the timeout path when the in-flight deadline expires", () => {
    let now = 0;
    const gate = new TurnGate({ now: () => now, timeoutMs: 5 });
    const token = tokenFrom(gate.admit("event-timeout"));
    now = 6;

    const receipt = gate.expire();

    expect(receipt).toMatchObject({ triggerId: "event-timeout", terminal: "timeout" });
    expect(gate.present({ kind: "turn", token })).toBe(false);
    expect(gate.admit("event-after-timeout").outcome).toBe("admitted");
  });

  it("settles an expired token when a delayed write presents it", () => {
    let now = 0;
    const gate = new TurnGate({ now: () => now, timeoutMs: 5 });
    const token = tokenFrom(gate.admit("event-timeout"));
    now = 6;

    expect(gate.present({ kind: "turn", token })).toBe(false);
    expect(gate.retainedReceiptCount()).toBe(1);
    expect(gate.admit("event-timeout")).toMatchObject({
      outcome: "deduped",
      receipt: { terminal: "timeout", triggerId: "event-timeout" },
    });
  });

  it("rejects writes that present a fenced turn token without mutating state", () => {
    const gate = new TurnGate();
    const token = tokenFrom(gate.admit("event-write"));
    const state = { document: "before", data: { value: 1 }, stageRevision: 0 };
    const write = (authority: WriteAuthority): boolean => {
      if (!gate.present(authority)) {
        return false;
      }
      state.document = "after";
      state.data = { value: 2 };
      state.stageRevision = 1;
      return true;
    };

    gate.fence({ kind: "turn", token });

    expect(write({ kind: "turn", token })).toBe(false);
    expect(state).toEqual({ document: "before", data: { value: 1 }, stageRevision: 0 });
  });

  it("mints host leases as the other closed write authority and fences them", () => {
    const gate = new TurnGate();
    const lease = gate.mintHostLease("publish-1");

    expect(gate.present({ kind: "host-lease", lease })).toBe(true);

    gate.fence({ kind: "host-lease", lease });

    expect(gate.present({ kind: "host-lease", lease })).toBe(false);
  });
});
