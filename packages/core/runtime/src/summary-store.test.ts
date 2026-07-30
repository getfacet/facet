import { describe, expect, it } from "vitest";

import { MemorySummaryStore } from "./summary-store.js";
import type { SummaryStore } from "./summary-store.js";

describe("MemorySummaryStore", () => {
  it("stores and reads one opaque summary payload per session key", async () => {
    const store = new MemorySummaryStore();
    const payload = { rolling: "The assistant gathered context.", turns: 3 };

    await expect(store.write("session-a", payload)).resolves.toEqual({ ok: true });

    await expect(store.read("session-a")).resolves.toBe(payload);
    await expect(store.read("session-b")).resolves.toBeNull();
  });

  it("treats payloads as opaque and never inspects their fields", async () => {
    const store = new MemorySummaryStore();
    const payload = Object.defineProperty({}, "summary", {
      get() {
        throw new Error("runtime must not inspect summaries");
      },
    });

    await expect(store.write("session-a", payload)).resolves.toEqual({ ok: true });
    await expect(store.read("session-a")).resolves.toBe(payload);
  });
});

describe("SummaryStore conformance", () => {
  it("allows a host-supplied store implementation with opaque payloads", async () => {
    class TestSummaryStore implements SummaryStore {
      readonly #payloads = new Map<string, unknown>();

      async write(
        key: string,
        payload: unknown,
      ): Promise<
        | { readonly ok: true }
        | { readonly ok: false; readonly code: string; readonly detail: string }
      > {
        this.#payloads.set(key, payload);
        return { ok: true };
      }

      async read(key: string): Promise<unknown | null> {
        return this.#payloads.has(key) ? (this.#payloads.get(key) ?? null) : null;
      }
    }

    const store = new TestSummaryStore();
    const payload = { owner: "agent", notes: ["one"] };

    await store.write("session-a", payload);

    await expect(store.read("session-a")).resolves.toBe(payload);
  });
});
