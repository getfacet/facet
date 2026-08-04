import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { BoundedMap } from "./lru-map.js";
import { createBoundedMap } from "./lru-map.js";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** `packages/core/core/src` → the workspace root, four levels up. */
const REPO_ROOT = join(SRC_DIR, "..", "..", "..", "..");

/**
 * The declaration `tsc` emits for this module.
 *
 * The emitted `.d.ts` — not the source, and not what vitest runs — is what a
 * consuming package actually compiles against, and esbuild erases `import type`
 * long before any assertion here runs. A module can therefore pass every test in
 * this file and `tsc --noEmit` while its published declaration still names a
 * private type no consumer can import.
 */
let declaration: string | undefined;

function emitDeclaration(): string {
  // Compiled once per file: several assertions below read the same declaration,
  // and spawning the compiler for each of them would buy nothing.
  if (declaration !== undefined) {
    return declaration;
  }
  const outDir = mkdtempSync(join(tmpdir(), "facet-lru-map-"));
  try {
    execFileSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsc"),
      [
        "--declaration",
        "--emitDeclarationOnly",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--outDir",
        outDir,
        join(SRC_DIR, "lru-map.ts"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );
    declaration = readFileSync(join(outDir, "lru-map.d.ts"), "utf8");
    return declaration;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * The consumer-shaped proof that the map's public type can be **named**. Both
 * consumers — the runtime's turn gate and the browser's conversation collapse —
 * hold one in a field and pass it to helpers, and an unexported type turns that
 * into `TS2459`. **vitest cannot catch that on its own**, because `import type`
 * is erased by esbuild, so this helper is called by the tests below.
 */
function describeMap(map: BoundedMap<string>): string {
  return `${map.size}/${map.capacity}:${map.keysOldestFirst().join(",")}`;
}

/** Fills a fresh map with `count` keys named `k1…kN`, oldest first. */
function filled(capacity: number, count: number): BoundedMap<string> {
  const map = createBoundedMap<string>(capacity);
  for (let index = 1; index <= count; index += 1) {
    map.set(`k${index}`, `v${index}`);
  }
  return map;
}

describe("the emitted public declaration", () => {
  it("exports exactly BoundedMap and createBoundedMap", () => {
    const declaration = emitDeclaration();
    const exported = [
      ...declaration.matchAll(/export\s+(?:declare\s+)?(?:interface|type|function)\s+(\w+)/g),
    ]
      .map((match) => match[1])
      .sort();
    expect(exported).toEqual(["BoundedMap", "createBoundedMap"]);
  }, 60_000);

  it("declares the factory's return type as the named, exported BoundedMap", () => {
    // Not an anonymous object type: a consumer that stores the map in a field
    // has to be able to write its type down.
    expect(emitDeclaration()).toMatch(
      /export declare function createBoundedMap<V>\(capacity: number\): BoundedMap<V>;/,
    );
  });

  it("names nothing private and imports nothing", () => {
    // `Slot` is this module's private wrapper. A public declaration that named
    // it would be unusable off the barrel — the exact leak an `import type` can
    // hide from both vitest and `tsc --noEmit`.
    const code = emitDeclaration()
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bSlot\b/);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\bfrom\b/);
    expect(code).not.toMatch(/\brequire\b/);
  });
});

describe("capacity", () => {
  it("reports the capacity it was built with", () => {
    expect(describeMap(createBoundedMap<string>(3))).toBe("0/3:");
  });

  // A bound that could be read as "unlimited" is not a bound. Every input that
  // is not a positive count normalises to 0 — a map that holds nothing — rather
  // than throwing or silently growing forever.
  it.each([
    { what: "a positive integer", given: 256, expected: 256 },
    { what: "one", given: 1, expected: 1 },
    { what: "zero", given: 0, expected: 0 },
    { what: "a fraction", given: 2.7, expected: 2 },
    { what: "a negative count", given: -5, expected: 0 },
    { what: "negative infinity", given: Number.NEGATIVE_INFINITY, expected: 0 },
    {
      what: "infinity, which would otherwise be unbounded",
      given: Number.POSITIVE_INFINITY,
      expected: 0,
    },
    { what: "NaN", given: Number.NaN, expected: 0 },
  ])("normalises $what to $expected", ({ given, expected }) => {
    expect(createBoundedMap<string>(given).capacity).toBe(expected);
  });

  it("holds nothing at capacity 0, and still answers every question", () => {
    const map = createBoundedMap<string>(0);
    map.set("a", "1");
    expect(map.size).toBe(0);
    expect(map.has("a")).toBe(false);
    expect(map.get("a")).toBeUndefined();
    expect(map.delete("a")).toBe(false);
    expect(map.keysOldestFirst()).toEqual([]);
  });

  it("holds exactly one entry at capacity 1", () => {
    const map = filled(1, 2);
    expect(describeMap(map)).toBe("1/1:k2");
  });
});

describe("the accept-at-capacity / evict-past-capacity pair", () => {
  // The two rows of each pair are literally one apart, so the boundary itself is
  // asserted rather than a comfortable distance either side of it.
  it.each([1, 2, 3, 8, 256])(
    "at capacity %i keeps every key, and one more evicts the oldest",
    (capacity) => {
      const atCapacity = filled(capacity, capacity);
      expect(atCapacity.size).toBe(capacity);
      expect(atCapacity.has("k1")).toBe(true);

      const pastCapacity = filled(capacity, capacity + 1);
      expect(pastCapacity.size).toBe(capacity);
      expect(pastCapacity.has("k1")).toBe(false);
      expect(pastCapacity.get(`k${capacity + 1}`)).toBe(`v${capacity + 1}`);
    },
  );
});

describe("eviction order", () => {
  it("evicts strictly oldest-first, and the surviving set is exact", () => {
    // A size-only assertion is satisfied by the wrong policy — most-recent-first
    // eviction keeps three entries too. The exact surviving key set is what
    // separates them.
    const map = filled(3, 6);
    expect(map.keysOldestFirst()).toEqual(["k4", "k5", "k6"]);
  });

  it("a get hit refreshes recency, so a different key is evicted next", () => {
    const map = filled(3, 3);
    expect(map.get("k1")).toBe("v1");
    map.set("k4", "v4");
    expect(map.keysOldestFirst()).toEqual(["k3", "k1", "k4"]);
  });

  it("a has hit is a use, and refreshes recency the same way", () => {
    // A dedupe cache asks `has`; a retried id that is never refreshed would age
    // out precisely when it is hottest.
    const map = filled(3, 3);
    expect(map.has("k1")).toBe(true);
    map.set("k4", "v4");
    expect(map.keysOldestFirst()).toEqual(["k3", "k1", "k4"]);
  });

  it("a miss refreshes nothing", () => {
    const map = filled(3, 3);
    expect(map.get("absent")).toBeUndefined();
    expect(map.has("absent")).toBe(false);
    expect(map.keysOldestFirst()).toEqual(["k1", "k2", "k3"]);
  });

  it("re-setting an existing key replaces it in place and refreshes recency", () => {
    const map = filled(3, 3);
    map.set("k1", "replaced");
    expect(map.size).toBe(3);
    expect(map.get("k1")).toBe("replaced");
    expect(map.keysOldestFirst()).toEqual(["k2", "k3", "k1"]);
  });

  it("deleting frees a slot without disturbing the order of the rest", () => {
    const map = filled(3, 3);
    expect(map.delete("k2")).toBe(true);
    expect(map.delete("k2")).toBe(false);
    map.set("k4", "v4");
    expect(map.keysOldestFirst()).toEqual(["k1", "k3", "k4"]);
  });

  it("is deterministic: the same script always yields the same surviving set", () => {
    const script = (map: BoundedMap<string>): string => {
      map.set("a", "1");
      map.set("b", "2");
      map.get("a");
      map.set("c", "3");
      map.has("b");
      map.set("d", "4");
      map.delete("a");
      map.set("e", "5");
      return describeMap(map);
    };
    const first = script(createBoundedMap<string>(3));
    const second = script(createBoundedMap<string>(3));
    expect(first).toBe(second);
    expect(first).toBe("3/3:b,d,e");
  });

  it("hands back a snapshot, not a live view", () => {
    const map = filled(2, 2);
    const keys = map.keysOldestFirst();
    map.set("k3", "v3");
    expect(keys).toEqual(["k1", "k2"]);
  });
});

describe("totality — no operation throws, for any input", () => {
  it("survives keys that name object machinery", () => {
    const map = createBoundedMap<string>(4);
    for (const key of ["__proto__", "constructor", "prototype", "toString", "", " "]) {
      expect(() => map.set(key, `v:${key}`)).not.toThrow();
    }
    // Nothing leaked onto Object.prototype, and the last four keys survive.
    expect(({} as Record<string, unknown>)["v:__proto__"]).toBeUndefined();
    expect(map.keysOldestFirst()).toEqual(["prototype", "toString", "", " "]);
    // A hostile key is an ordinary key, touch semantics and all.
    expect(map.get("toString")).toBe("v:toString");
    expect(map.keysOldestFirst()).toEqual(["prototype", "", " ", "toString"]);
  });

  it("never reads into a stored value, so a throwing getter is inert", () => {
    const hostile = {
      get value(): never {
        throw new Error("read");
      },
    };
    const map = createBoundedMap<typeof hostile>(2);
    expect(() => map.set("a", hostile)).not.toThrow();
    expect(() => map.has("a")).not.toThrow();
    expect(() => map.get("a")).not.toThrow();
    expect(map.get("a")).toBe(hostile);
    expect(() => map.set("b", hostile)).not.toThrow();
    expect(() => map.set("c", hostile)).not.toThrow();
    expect(map.size).toBe(2);
  });

  it("distinguishes a stored undefined from an absent key", () => {
    // `get` alone is ambiguous when the value type admits `undefined`; `has` is
    // the answer, so presence is never inferred from a sentinel.
    const map = createBoundedMap<string | undefined>(2);
    map.set("a", undefined);
    expect(map.get("a")).toBeUndefined();
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("survives a hostile capacity and a burst against it", () => {
    for (const capacity of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      const map = createBoundedMap<string>(capacity);
      expect(() => {
        for (let index = 0; index < 100; index += 1) {
          map.set(`k${index}`, `v${index}`);
        }
      }).not.toThrow();
      expect(map.size).toBe(0);
    }
  });

  it("stays bounded under a burst far past its capacity", () => {
    const map = createBoundedMap<string>(3);
    for (let index = 0; index < 1_000; index += 1) {
      map.set(`k${index}`, `v${index}`);
    }
    expect(describeMap(map)).toBe("3/3:k997,k998,k999");
  });
});
