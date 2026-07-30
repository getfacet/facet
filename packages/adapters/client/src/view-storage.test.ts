import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPersistedScreen, persistScreen } from "./view-storage.js";

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

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error remove the stub so the "no storage" case can run
  delete globalThis.localStorage;
});

describe("persistScreen / loadPersistedScreen", () => {
  it("round-trips only the screen field", () => {
    mockLocalStorage();

    persistScreen("agent-1", {
      screen: "pricing",
      toggled: { faq: "shown" },
      sort: { table: "asc" },
      viewport: "wide",
      colorMode: "dark",
    });

    expect(localStorage.getItem("facet:screen:agent-1")).toBe(
      JSON.stringify({ screen: "pricing" }),
    );
    expect(loadPersistedScreen("agent-1")).toEqual({ screen: "pricing" });
  });

  it("loads legacy or hostile payloads by projecting screen only", () => {
    mockLocalStorage();
    localStorage.setItem(
      "facet:screen:agent-1",
      JSON.stringify({
        screen: "home",
        toggled: { drawer: "open" },
        viewport: "narrow",
        colorMode: "dark",
      }),
    );

    expect(loadPersistedScreen("agent-1")).toEqual({ screen: "home" });
  });

  it("returns undefined for absent, corrupt, or invalid screen payloads", () => {
    mockLocalStorage();
    expect(loadPersistedScreen("agent-1")).toBeUndefined();
    localStorage.setItem("facet:screen:agent-1", "{not valid json");
    expect(loadPersistedScreen("agent-1")).toBeUndefined();
    localStorage.setItem("facet:screen:agent-1", JSON.stringify({ screen: "not valid" }));
    expect(loadPersistedScreen("agent-1")).toBeUndefined();
  });

  it("keys are per-agent and storage failure is silent", () => {
    mockLocalStorage();
    persistScreen("agent-a", { screen: "home" });
    persistScreen("agent-b", { screen: "settings" });
    expect(loadPersistedScreen("agent-a")).toEqual({ screen: "home" });
    expect(loadPersistedScreen("agent-b")).toEqual({ screen: "settings" });

    // @ts-expect-error remove localStorage to exercise the no-storage branch
    delete globalThis.localStorage;
    expect(() => persistScreen("agent-1", { screen: "home" })).not.toThrow();
    expect(loadPersistedScreen("agent-1")).toBeUndefined();

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
    expect(() => persistScreen("agent-1", { screen: "home" })).not.toThrow();
    expect(loadPersistedScreen("agent-1")).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
