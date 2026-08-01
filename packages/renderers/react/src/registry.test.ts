/**
 * The component registry — half of Facet's one immutable trust boundary.
 *
 * The environment here is deliberately **node**, not jsdom (convention 8). A
 * registry is a frozen record of functions: nothing in this module or its test
 * mounts, renders, or touches a DOM node, so declaring jsdom would buy a slower
 * run and a browser global neither side is allowed to reach for. The React types
 * below are type-only imports, erased before the run starts.
 *
 * Three properties are proved, and each one exists because its absence is a
 * silent failure rather than a loud one:
 *
 * 1. **Ordered entries, not an object.** An object literal resolves duplicate
 *    keys by overwriting — `{...{Text: a}, ...{Text: b}}` is `{Text: b}` with no
 *    trace that `a` was ever there. Taking `readonly [tag, implementation]`
 *    pairs is what makes a duplicate *observable*, and rejecting it **before the
 *    record is materialized** is what keeps a later entry from silently
 *    replacing a trusted implementation the host already registered. The
 *    contrast test below renders that failure mode visible rather than
 *    describing it.
 * 2. **The result is a frozen structural record.** No brand, no class, no
 *    wrapper. `DEFAULT_REGISTRY` in `@facet/assets/react` is declared as exactly
 *    `Readonly<Record<string, MountedComponent<ReactNode, ReactNode>>>`, so it
 *    has to be a `ComponentRegistry` with no cast and no adaptation — pinned
 *    here by a locally declared value carrying that exact declared type.
 * 3. **Nothing is retained between calls.** There is no module-level registry,
 *    so two calls cannot see each other. The module-surface assertion is the
 *    structural half of that: every runtime export is a function, so there is
 *    nowhere a registry could be kept.
 *
 * `@facet/assets` is deliberately **not** imported. `@facet/react` dropped that
 * dependency at the cut (D-09) and the edge now runs one way, assets → core, so
 * a test reaching back across it would reintroduce exactly the cycle the
 * dependency removal exists to prevent. The drop-in obligation is therefore
 * proved against the *declared type* of `DEFAULT_REGISTRY`, restated here as a
 * type annotation, rather than against the value.
 */

import type { MountedComponent } from "@facet/core";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { ComponentRegistry } from "./registry.js";
import { createRegistry, snapshotRegistryForTags } from "./registry.js";
import * as registryModule from "./registry.js";

/**
 * A stand-in trusted implementation. It renders nothing and is never mounted:
 * every assertion here is about identity, freezing, and rejection, so a real
 * component would only add noise about what it rendered.
 */
function stub(label: string): MountedComponent<ReactNode, ReactNode> {
  const implementation = (): ReactNode => label;
  return implementation;
}

/** Writes through the readonly view, so a frozen record's refusal is observable. */
function writeTag(
  registry: ComponentRegistry,
  tag: string,
  implementation: MountedComponent<ReactNode, ReactNode>,
): void {
  (registry as Record<string, MountedComponent<ReactNode, ReactNode>>)[tag] = implementation;
}

/** Narrows to the accepted branch, failing the test rather than the type system. */
function accepted(
  result: ReturnType<typeof createRegistry> | ReturnType<typeof snapshotRegistryForTags>,
): ComponentRegistry {
  if (!result.ok) {
    throw new Error(`expected an accepted registry, got ${result.code} at ${result.at}`);
  }
  return result.registry;
}

describe("createRegistry builds one frozen structural record", () => {
  it("maps every ordered entry to its exact implementation", () => {
    const screen = stub("Screen");
    const modal = stub("Modal");

    const registry = accepted(
      createRegistry([
        ["Screen", screen],
        ["Modal", modal],
      ]),
    );

    expect(Object.keys(registry).sort()).toEqual(["Modal", "Screen"]);
    // Identity, not equivalence: what the host registered is what Facet holds,
    // so nothing was wrapped, bound, or re-created on the way in.
    expect(registry["Screen"]).toBe(screen);
    expect(registry["Modal"]).toBe(modal);
  });

  it("returns a record no consumer can extend or replace afterwards", () => {
    const registry = accepted(createRegistry([["Screen", stub("Screen")]]));

    expect(Object.isFrozen(registry)).toBe(true);
    expect(() => writeTag(registry, "Injected", stub("Injected"))).toThrow(TypeError);
    expect(() => Object.defineProperty(registry, "Injected", { value: stub("Injected") })).toThrow(
      TypeError,
    );
    expect(registry["Injected"]).toBeUndefined();
  });

  it("carries no prototype, so no tag can resolve to an inherited member", () => {
    const registry = accepted(createRegistry([["Screen", stub("Screen")]]));

    // A plain object would answer `registry["constructor"]` with `Object`'s own
    // constructor — a tag resolving to something no host ever registered.
    expect(Object.getPrototypeOf(registry)).toBeNull();
    expect(registry["constructor"]).toBeUndefined();
    expect(registry["toString"]).toBeUndefined();
  });

  it("stores a __proto__ tag as an ordinary own entry", () => {
    const planted = stub("planted");

    const registry = accepted(createRegistry([["__proto__", planted]]));

    // On a prototype-bearing object this assignment would be swallowed by the
    // setter and change the object's prototype instead of adding a key.
    expect(Object.hasOwn(registry, "__proto__")).toBe(true);
    expect(registry["__proto__"]).toBe(planted);
    expect(Object.getPrototypeOf(registry)).toBeNull();
  });

  it("snapshots the entries, so mutating the caller's array changes nothing", () => {
    const entries: [string, MountedComponent<ReactNode, ReactNode>][] = [
      ["Screen", stub("Screen")],
    ];

    const registry = accepted(createRegistry(entries));
    entries.push(["Injected", stub("Injected")]);

    expect(Object.keys(registry)).toEqual(["Screen"]);
  });
});

describe("createRegistry rejects a registry that could not be trusted", () => {
  it("rejects a duplicate tag before the record exists, keeping the first entry", () => {
    const first = stub("first");
    const second = stub("second");

    const result = createRegistry([
      ["Screen", first],
      ["Screen", second],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("duplicate_tag");
    expect(result.at).toBe("entries[1].tag");
    // The rejection branch carries no registry at all: half a trust boundary is
    // not a trust boundary, so there is nothing here a caller could salvage.
    expect("registry" in result).toBe(false);
  });

  it("catches the overwrite an object literal would have swallowed", () => {
    const trusted = stub("trusted");
    const shadowing = stub("shadowing");

    // What a host would get from composing the two halves by hand. The second
    // `Text` wins and the first is gone — and the point is that this is
    // undetectable *to `createRegistry`*, not merely true of JavaScript: fed
    // the spread's entries, the constructor accepts, because by then there is
    // one registration and no collision left to find.
    const spread = { ...{ Text: trusted }, ...{ Text: shadowing } };
    const fromSpread = accepted(createRegistry(Object.entries(spread)));
    expect(fromSpread["Text"]).toBe(shadowing);
    expect(Object.keys(fromSpread)).toEqual(["Text"]);

    // The same two registrations, handed to Facet in order, are a rejection.
    const result = createRegistry([
      ["Text", trusted],
      ["Text", shadowing],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("duplicate_tag");
  });

  it("rejects the one reserved grammar position", () => {
    const result = createRegistry([["Facet", stub("Facet")]]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("reserved_structural_tag");
    expect(result.at).toBe("entries[0].tag");
  });

  it("accepts the tags that merely look reserved", () => {
    // Both comparisons are exact and case-sensitive. `facet` and `FacetThing`
    // are ordinary tags a host may register; `Screen` is a member, never a
    // reservation.
    const registry = accepted(
      createRegistry([
        ["facet", stub("facet")],
        ["FacetThing", stub("FacetThing")],
        ["Screen", stub("Screen")],
      ]),
    );

    expect(Object.keys(registry).sort()).toEqual(["FacetThing", "Screen", "facet"]);
  });

  it("rejects an implementation that is not callable", () => {
    const entries = [["Screen", { render: "not a component" }]] as unknown as readonly (readonly [
      string,
      MountedComponent<ReactNode, ReactNode>,
    ])[];

    const result = createRegistry(entries);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("implementation_not_callable");
    expect(result.at).toBe("entries[0].implementation");
  });

  it("rejects a malformed entry rather than trusting the declared type", () => {
    const notAnArray = createRegistry(
      "Screen" as unknown as readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[],
    );
    expect(notAnArray.ok).toBe(false);
    if (!notAnArray.ok) {
      expect(notAnArray.code).toBe("invalid_registry_entries");
    }

    const notAPair = createRegistry([["Screen"]] as unknown as readonly (readonly [
      string,
      MountedComponent<ReactNode, ReactNode>,
    ])[]);
    expect(notAPair.ok).toBe(false);
    if (!notAPair.ok) {
      expect(notAPair.code).toBe("invalid_registry_entry");
      expect(notAPair.at).toBe("entries[0]");
    }

    const emptyTag = createRegistry([["", stub("nameless")]]);
    expect(emptyTag.ok).toBe(false);
    if (!emptyTag.ok) {
      expect(emptyTag.code).toBe("invalid_registry_entry");
      expect(emptyTag.at).toBe("entries[0].tag");
    }
  });

  it("stays total when reading an entry throws", () => {
    const hostile: readonly unknown[] = [
      new Proxy([] as unknown[], {
        get(): never {
          throw new Error("hostile entry");
        },
      }),
    ];

    const result = createRegistry(
      hostile as readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("registry_read_failed");
  });

  it("reports the first fault in entry order", () => {
    // A duplicate at index 1 and a reserved tag at index 2: the earlier one
    // decides, so the same input always yields the same rejection.
    const result = createRegistry([
      ["Screen", stub("a")],
      ["Screen", stub("b")],
      ["Facet", stub("c")],
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.at).toBe("entries[1].tag");
  });
});

describe("createRegistry retains nothing between calls", () => {
  it("returns a fresh record each time", () => {
    const entries: readonly (readonly [string, MountedComponent<ReactNode, ReactNode>])[] = [
      ["Screen", stub("Screen")],
    ];

    const first = accepted(createRegistry(entries));
    const second = accepted(createRegistry(entries));

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("does not let a later call reach an earlier registry", () => {
    const first = accepted(createRegistry([["Screen", stub("Screen")]]));
    accepted(
      createRegistry([
        ["Screen", stub("Screen")],
        ["Modal", stub("Modal")],
      ]),
    );

    expect(Object.keys(first)).toEqual(["Screen"]);
    expect(first["Modal"]).toBeUndefined();
  });

  it("exports only functions, so there is nothing that could hold a registry", () => {
    // The structural half of "no global": every runtime export is a function, so
    // the module has nowhere to keep session state. The key list is pinned as
    // well, because widening a module's surface should be a deliberate act —
    // `freezeRegistry` and `snapshotRegistryForTags` are the internal helpers
    // `bootstrap.ts` shares so the two cannot drift into two ideas of what a
    // frozen registry or exact tag-list snapshot is, and both are **off-barrel**:
    // the Barrel Export Contract publishes `createRegistry` and the
    // `ComponentRegistry` type from this module and nothing else.
    // `ComponentRegistry` is a type and is erased, so it is absent by
    // construction.
    expect(Object.keys(registryModule).sort()).toEqual([
      "createRegistry",
      "freezeRegistry",
      "snapshotRegistryForTags",
    ]);
    for (const value of Object.values(registryModule)) {
      expect(typeof value).toBe("function");
    }
  });
});

describe("snapshotRegistryForTags shares bootstrap's registry snapshot", () => {
  it("copies exactly the catalog tag list into a frozen null-prototype record", () => {
    const screen = stub("Screen");
    const modal = stub("Modal");
    const host: Record<string, MountedComponent<ReactNode, ReactNode>> = {
      Screen: screen,
      Modal: modal,
    };

    const registry = accepted(snapshotRegistryForTags(host, ["Screen", "Modal"]));
    host["Screen"] = stub("replacement");

    expect(Object.keys(registry)).toEqual(["Screen", "Modal"]);
    expect(Object.getPrototypeOf(registry)).toBeNull();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry["Screen"]).toBe(screen);
    expect(registry["Modal"]).toBe(modal);
  });

  it("reports exact tag-list mismatches at registry tag locations", () => {
    const missing = snapshotRegistryForTags({ Screen: stub("Screen") }, ["Screen", "Modal"]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("missing_implementation");
      expect(missing.at).toBe("registry.Modal");
    }

    const surplus = snapshotRegistryForTags(
      { Screen: stub("Screen"), Modal: stub("Modal"), Text: stub("Text") },
      ["Screen", "Modal"],
    );
    expect(surplus.ok).toBe(false);
    if (!surplus.ok) {
      expect(surplus.code).toBe("uncatalogued_implementation");
      expect(surplus.at).toBe("registry.Text");
    }
  });
});

describe("ComponentRegistry is the structural type the default registry already has", () => {
  it("accepts a value declared exactly as @facet/assets/react declares DEFAULT_REGISTRY", () => {
    // The declared type of `DEFAULT_REGISTRY`, restated rather than imported —
    // `@facet/react` depends on `@facet/core` and nothing else after the cut
    // (D-09). If `ComponentRegistry` ever grew a brand, a class, or a required
    // extra field, this annotation would stop compiling.
    const defaultShaped: Readonly<Record<string, MountedComponent<ReactNode, ReactNode>>> =
      Object.freeze({
        Screen: stub("Screen"),
        Modal: stub("Modal"),
      });

    // The load-bearing half of this test is the annotation itself: adding a
    // brand, a class or a required field to `ComponentRegistry` stops it
    // compiling. The value is then threaded through the runtime path below, so
    // the assertions are about `createRegistry` rather than about a local
    // literal.
    const asRegistry: ComponentRegistry = defaultShaped;

    // And the documented composition path — defaults plus custom, in order —
    // goes through `createRegistry`, never through a spread that would resolve
    // a collision silently.
    const composed = accepted(
      createRegistry([...Object.entries(asRegistry), ["Gauge", stub("Gauge")]]),
    );
    expect(Object.keys(composed).sort()).toEqual(["Gauge", "Modal", "Screen"]);
    expect(composed["Screen"]).toBe(asRegistry["Screen"]);

    const collided = createRegistry([...Object.entries(asRegistry), ["Modal", stub("mine")]]);
    expect(collided.ok).toBe(false);
    if (collided.ok) return;
    expect(collided.code).toBe("duplicate_tag");
    expect(collided.at).toBe("entries[2].tag");
  });
});
