import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewSnapshot } from "@facet/core";
import { loadPersistedView, persistView } from "./view-storage.js";

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

function mockThrowingLocalStorage(overrides: Partial<Storage>): void {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    get length() {
      return 0;
    },
    ...overrides,
  } as Storage;
}

const SNAP: ViewSnapshot = {
  screen: "home",
  toggled: { menu: "shown" },
  viewport: "wide",
  scheme: "dark",
};

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error remove the stub so the "no storage" case can run
  delete globalThis.localStorage;
});

describe("persistView / loadPersistedView", () => {
  it("persist then load round-trips the snapshot", () => {
    mockLocalStorage();
    persistView("agent-1", SNAP);
    expect(loadPersistedView("agent-1")).toEqual(SNAP);
  });

  it("returns undefined when nothing is stored", () => {
    mockLocalStorage();
    expect(loadPersistedView("agent-1")).toBeUndefined();
  });

  it("returns undefined for corrupt JSON without throwing", () => {
    mockLocalStorage();
    localStorage.setItem("facet:view:agent-1", "{not valid json");
    expect(() => loadPersistedView("agent-1")).not.toThrow();
    expect(loadPersistedView("agent-1")).toBeUndefined();
  });

  it("returns undefined when stored payload fails sanitizeView", () => {
    mockLocalStorage();
    localStorage.setItem(
      "facet:view:agent-1",
      JSON.stringify({ screen: 123, viewport: "gigantic", junk: true }),
    );
    expect(loadPersistedView("agent-1")).toBeUndefined();
  });

  it("keys are per-agent so two agent ids never collide", () => {
    mockLocalStorage();
    const other: ViewSnapshot = { screen: "settings", scheme: "light" };
    persistView("agent-a", SNAP);
    persistView("agent-b", other);
    expect(loadPersistedView("agent-a")).toEqual(SNAP);
    expect(loadPersistedView("agent-b")).toEqual(other);
    expect(localStorage.getItem("facet:view:agent-a")).not.toBeNull();
    expect(localStorage.getItem("facet:view:agent-b")).not.toBeNull();
  });

  it("persist no-ops and load returns undefined when localStorage is undefined", () => {
    expect(() => persistView("agent-1", SNAP)).not.toThrow();
    expect(loadPersistedView("agent-1")).toBeUndefined();
  });

  it("degrades silently, with no console output, when storage access throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockThrowingLocalStorage({
      getItem: () => {
        throw new Error("read blocked");
      },
      setItem: () => {
        throw new Error("write blocked");
      },
    });

    expect(() => persistView("agent-1", SNAP)).not.toThrow();
    expect(loadPersistedView("agent-1")).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
