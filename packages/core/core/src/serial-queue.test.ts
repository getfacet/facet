import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial-queue.js";

const after = (ms: number, label: string, log: string[]): (() => Promise<void>) => {
  return () =>
    new Promise((resolve) =>
      setTimeout(() => {
        log.push(label);
        resolve();
      }, ms),
    );
};

describe("createSerialQueue", () => {
  it("serializes same key, runs different keys in parallel", async () => {
    const log: string[] = [];
    const q = createSerialQueue<void>();
    const a1 = q("A", after(40, "a1", log));
    const a2 = q("A", after(5, "a2", log)); // must wait for a1 despite being faster
    const b1 = q("B", after(5, "b1", log)); // different key → parallel with A
    await Promise.all([a1, a2, b1]);
    expect(log.indexOf("a1")).toBeLessThan(log.indexOf("a2")); // same key: order preserved
    expect(log.indexOf("b1")).toBeLessThan(log.indexOf("a1")); // other key didn't wait
  });

  it("keeps the chain alive when a task rejects", async () => {
    const q = createSerialQueue<string>();
    const first = q("A", () => Promise.reject(new Error("boom"))).catch(() => "caught");
    const second = q("A", () => Promise.resolve("ok"));
    expect(await first).toBe("caught");
    expect(await second).toBe("ok");
  });
});
