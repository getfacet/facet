import { afterEach, describe, expect, it } from "vitest";
import { browserVisitorId } from "./visitor.js";

function mockLocalStorage(): void {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

afterEach(() => {
  // @ts-expect-error remove the stub so the "no storage" case can run
  delete globalThis.localStorage;
});

describe("browserVisitorId", () => {
  it("generates and persists a stable id across calls", () => {
    mockLocalStorage();
    const first = browserVisitorId();
    const second = browserVisitorId();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("returns the already-stored id", () => {
    mockLocalStorage();
    localStorage.setItem("facet:visitor", "known-id");
    expect(browserVisitorId()).toBe("known-id");
  });

  it("honors a custom storage key", () => {
    mockLocalStorage();
    const id = browserVisitorId("my:key");
    expect(localStorage.getItem("my:key")).toBe(id);
  });

  it("falls back to a fresh id when storage is unavailable", () => {
    expect(browserVisitorId().length).toBeGreaterThan(0);
  });
});
