import { describe, expect, it } from "vitest";

import { createSemaphore } from "./semaphore.js";

/** A task whose settlement is controlled by the test. */
interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(err: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Drain the microtask queue. Slot hand-off between a settling task and the next
 * waiter spans a few `.then` hops, so tests await this rather than count hops.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe("createSemaphore", () => {
  it("runs at most limit tasks concurrently", async () => {
    const acquire = createSemaphore(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    let active = 0;
    let maxActive = 0;

    const runs = gates.map((gate) =>
      acquire(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    // Release one at a time; the cap must never let more than 2 run at once.
    for (const gate of gates) {
      await flush();
      expect(active).toBeLessThanOrEqual(2);
      gate.resolve();
    }

    await Promise.all(runs);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it("starts waiters in FIFO order", async () => {
    const acquire = createSemaphore(1);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const runs = gates.map((gate, i) =>
      acquire(async () => {
        started.push(i);
        await gate.promise;
      }),
    );

    // Serial cap of 1: release each in turn and confirm they start in order.
    for (let i = 0; i < gates.length; i += 1) {
      await flush();
      expect(started).toEqual(Array.from({ length: i + 1 }, (_, k) => k));
      gates[i]!.resolve();
    }

    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2]);
  });

  it("releases the slot when a task rejects so later tasks still run", async () => {
    const acquire = createSemaphore(1);
    const results: string[] = [];

    const failing = acquire(async () => {
      results.push("failing:start");
      throw new Error("boom");
    });
    const following = acquire(async () => {
      results.push("following:start");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(results).toEqual(["failing:start", "following:start"]);
  });

  it("degenerates to strict serial execution at limit 1", async () => {
    const acquire = createSemaphore(1);
    const gates = [deferred(), deferred()];
    let active = 0;
    let maxActive = 0;

    const runs = gates.map((gate) =>
      acquire(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await flush();
    expect(active).toBe(1);
    gates[0]!.resolve();
    await flush();
    expect(active).toBe(1);
    gates[1]!.resolve();

    await Promise.all(runs);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it("does not overshoot the cap or jump the queue for a task submitted in the release gap", async () => {
    // Regression: the old fast path checked only `active < limit`. A submission
    // landing in the release→wake gap (after a slot was freed but before the
    // queued waiter's run executed) saw a free slot, ran immediately, and pushed
    // concurrency to 2 while jumping ahead of the already-queued waiter.
    const acquire = createSemaphore(1);
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];

    const make = (name: string, gate: Deferred): Promise<void> =>
      acquire(async () => {
        order.push(name);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      });

    const a = make("A", gates[0]!); // takes the only slot
    const b = make("B", gates[1]!); // queued first
    const c = make("C", gates[2]!); // queued second

    // Inject D a few microtasks deep, then release A — this lands D precisely in
    // the release→wake gap (empirically the timing that overshot the old cap).
    const d = Promise.resolve()
      .then(() => undefined)
      .then(() => undefined)
      .then(() => make("D", gates[3]!));
    gates[0]!.resolve();

    await flush();
    // The cap must hold and D must not jump ahead of the queued B/C.
    expect(maxActive).toBe(1);
    expect(order).toEqual(["A", "B"]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    gates[3]!.resolve();
    await Promise.all([a, b, c, d]);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });

  it("rejects (not throws) a synchronously-throwing task and frees its slot", async () => {
    const acquire = createSemaphore(1);
    const results: string[] = [];

    // Throws before returning a promise — the caller must still receive a
    // rejected promise, and the slot must be freed for the next task.
    const bad = acquire<never>(() => {
      results.push("bad");
      throw new Error("sync boom");
    });
    const good = acquire(async () => {
      results.push("good");
      return "ok";
    });

    await expect(bad).rejects.toThrow("sync boom");
    await expect(good).resolves.toBe("ok");
    expect(results).toEqual(["bad", "good"]);
  });

  it("throws at construction for a zero or non-integer limit", () => {
    expect(() => createSemaphore(0)).toThrow();
    expect(() => createSemaphore(1.5)).toThrow();
    expect(() => createSemaphore(-1)).toThrow();
  });
});
