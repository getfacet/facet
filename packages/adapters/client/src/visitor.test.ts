import { afterEach, describe, expect, it } from "vitest";
import { browserSessionKey } from "./visitor.js";

const ORIGINAL_CRYPTO = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function mockCrypto(source: Partial<Crypto> | undefined): void {
  if (source === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    return;
  }
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: source,
  });
}

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
  // @ts-expect-error remove the stub so the "no storage" case can run
  delete globalThis.localStorage;
  if (ORIGINAL_CRYPTO === undefined) {
    // @ts-expect-error restore the pre-test absence of crypto
    delete globalThis.crypto;
  } else {
    Object.defineProperty(globalThis, "crypto", ORIGINAL_CRYPTO);
  }
});

describe("browserSessionKey", () => {
  it("generates and persists a stable session key across reloads", () => {
    mockLocalStorage();
    const first = browserSessionKey();
    const second = browserSessionKey();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(localStorage.getItem("facet:session")).toBe(first);
  });

  it("returns the already-stored id", () => {
    mockLocalStorage();
    localStorage.setItem("facet:session", "known-id");
    expect(browserSessionKey()).toBe("known-id");
  });

  it("honors a custom storage key", () => {
    mockLocalStorage();
    const id = browserSessionKey("my:key");
    expect(localStorage.getItem("my:key")).toBe(id);
  });

  it("falls back to a fresh id when storage is unavailable", () => {
    expect(browserSessionKey().length).toBeGreaterThan(0);
  });

  it("falls back to a fresh id when storage access throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("storage blocked");
      },
    });

    expect(browserSessionKey().length).toBeGreaterThan(0);
  });

  it("falls back to a fresh id when storage reads or writes throw", () => {
    mockThrowingLocalStorage({
      getItem: () => {
        throw new Error("read blocked");
      },
    });
    expect(browserSessionKey().length).toBeGreaterThan(0);

    mockThrowingLocalStorage({
      setItem: () => {
        throw new Error("write blocked");
      },
    });
    expect(browserSessionKey().length).toBeGreaterThan(0);
  });

  it("fails closed when no secure browser crypto source is available", () => {
    mockLocalStorage();
    mockCrypto(undefined);

    expect(() => browserSessionKey()).toThrow("crypto.randomUUID or crypto.getRandomValues");
    expect(localStorage.getItem("facet:session")).toBeNull();
  });

  it("uses getRandomValues when randomUUID is unavailable", () => {
    mockLocalStorage();
    mockCrypto({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) {
          array.fill(7);
        }
        return array;
      },
    } as Crypto);

    expect(browserSessionKey()).toBe("v-07070707070707070707070707070707");
  });

  it("keeps storage failures on the secure fresh-id path", () => {
    let next = 0;
    mockCrypto({
      randomUUID: () => {
        next += 1;
        return `session-${next}` as `${string}-${string}-${string}-${string}-${string}`;
      },
    } as Crypto);
    mockThrowingLocalStorage({
      setItem: () => {
        throw new Error("write blocked");
      },
    });

    expect(browserSessionKey()).toBe("session-1");
    expect(browserSessionKey()).toBe("session-2");
  });
});
