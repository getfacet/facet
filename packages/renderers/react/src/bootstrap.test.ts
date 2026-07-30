/**
 * The renderer bootstrap — the one place Facet's trust boundary is closed.
 *
 * The environment is **node** (convention 8). Bootstrap validates data and
 * returns data: it mounts nothing, so a DOM would be dead weight and a browser
 * global is something this module must never reach for. The React types below
 * are type-only and erased before the run.
 *
 * What the assertions here are for, stated once so each block can be read
 * against it:
 *
 * - **Three host paths (DC-002).** Framework defaults, a host's own components
 *   only, and a duplicate-free combination of the two all bootstrap. The
 *   framework path is modelled on a *defaults-shaped* fixture rather than on
 *   `DEFAULT_CATALOG`/`DEFAULT_REGISTRY`, because `@facet/react` imports nothing
 *   from `@facet/assets` after the cut (D-09) — DC-002's other half lives in
 *   `packages/core/assets/src/react.test.tsx`, and `registry.test.ts` pins the
 *   drop-in against `DEFAULT_REGISTRY`'s declared type.
 * - **Rejection is atomic (DC-003).** Every rejection branch carries a code, a
 *   location and a line of detail — and no catalog, registry, theme or copy. A
 *   host cannot render a partially matched document because a rejected
 *   bootstrap hands back nothing to render with.
 * - **`Screen` is mirrored, not re-invented.** `validateCatalog` already
 *   reserves `Facet`, demands exactly one `Screen`, and refines it. Bootstrap
 *   relays those codes and locations verbatim and adds exactly one rule of its
 *   own: `Facet` may not be *registered*. `Screen` is a registered member, so
 *   exact tag equality — not a second reservation — is what makes a registry
 *   without a trusted `Screen` fail here rather than at first render.
 * - **Neutral copy has no author input path (DC-015).** The proof is structural
 *   and reference-based: with no host override the resolved copy **is**
 *   `NEUTRAL_COPY_DEFAULTS`, the same frozen object, so nothing was merged into
 *   it. A catalog and registry stuffed with lookalike prop names, tags, domains
 *   and guidance change it by not one byte.
 * - **No process global.** Two bootstraps in one process are independent, and
 *   the module's entire runtime surface is one function, so there is nowhere for
 *   a registry to be kept.
 */

import type {
  ComponentSpec,
  FacetCatalog,
  FacetTheme,
  MountedComponent,
  NeutralCopy,
} from "@facet/core";
import { BOUNDS, NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { RendererBootstrap } from "./bootstrap.js";
import { bootstrapRenderer } from "./bootstrap.js";
import * as bootstrapModule from "./bootstrap.js";
import type { ComponentRegistry } from "./registry.js";
import { createRegistry } from "./registry.js";

type Implementation = MountedComponent<ReactNode, ReactNode>;

function stub(label: string): Implementation {
  const implementation = (): ReactNode => label;
  return implementation;
}

/** A conforming `Screen`: takes children, collects nothing, names itself literally. */
function screenSpec(): ComponentSpec {
  return {
    tag: "Screen",
    whenToUse: "The root of one named screen; it frames the screen's content.",
    props: {
      name: {
        type: "string",
        guidance: "This screen's name, and how a nav: action reaches it.",
        required: true,
      },
    },
    acceptsChildren: true,
  };
}

/** A conforming `Modal`: exactly the two props the framework frame projects. */
function modalSpec(): ComponentSpec {
  return {
    tag: "Modal",
    whenToUse: "Interrupt the screen for one focused decision or a short form.",
    props: {
      triggerLabel: {
        type: "string",
        guidance: "Label of the control that opens it.",
        required: true,
      },
      title: {
        type: "string",
        guidance: "The modal's heading, naming the decision.",
        required: true,
      },
    },
    acceptsChildren: true,
  };
}

/** An ordinary member. Nothing about it is special, which is the point. */
function plainSpec(tag: string): ComponentSpec {
  return {
    tag,
    whenToUse: `Use ${tag} when the page needs what ${tag} shows.`,
    props: { label: { type: "string", guidance: "What this component says." } },
    acceptsChildren: false,
  };
}

function catalogOf(...components: readonly ComponentSpec[]): FacetCatalog {
  return { components };
}

/** Builds a registry for a tag list through the public constructor. */
function registryFor(...tags: readonly string[]): ComponentRegistry {
  const result = createRegistry(tags.map((tag) => [tag, stub(tag)] as const));
  if (!result.ok) {
    throw new Error(`fixture registry rejected: ${result.code} at ${result.at}`);
  }
  return result.registry;
}

/** A complete theme. Every token name the closed contract declares, and no other. */
const THEME: FacetTheme = {
  color: {
    background: "#ffffff",
    surface: "#f7f7f8",
    border: "#e3e3e6",
    text: "#16161a",
    textMuted: "#6b6b73",
    accent: "#2563eb",
    onAccent: "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
  },
  space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  radius: { sm: "2px", md: "6px", lg: "12px", full: "9999px" },
  borderWidth: { thin: "1px", thick: "2px" },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.06)",
    md: "0 2px 8px rgba(0,0,0,0.08)",
    lg: "0 8px 24px rgba(0,0,0,0.12)",
  },
  fontFamily: { sans: "system-ui, sans-serif", mono: "ui-monospace, monospace" },
  fontSize: { xs: "12px", sm: "14px", md: "16px", lg: "20px", xl: "28px" },
  fontWeight: { regular: "400", medium: "500", bold: "700" },
  lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.7" },
};

/** An options object whose named option throws the moment anything reads it. */
function throwingOption(name: string, enumerable: boolean): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  Object.defineProperty(options, name, {
    get(): never {
      throw new Error(`hostile ${name}`);
    },
    enumerable,
    configurable: true,
  });
  return options;
}

/** Narrows to the accepted branch, failing the test rather than the type system. */
function accepted(result: RendererBootstrap): Extract<RendererBootstrap, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected an accepted bootstrap, got ${result.code} at ${result.at}`);
  }
  return result;
}

/**
 * Narrows to the rejection branch **and** proves the branch is empty of session
 * material. Every rejection test routes through here, so "a rejected bootstrap
 * hands back nothing to render with" is asserted once per rejection rather than
 * once in the suite.
 */
function rejected(result: RendererBootstrap): Extract<RendererBootstrap, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a rejected bootstrap");
  }
  expect(typeof result.code).toBe("string");
  expect(result.code.length).toBeGreaterThan(0);
  expect(typeof result.at).toBe("string");
  expect(result.detail.length).toBeGreaterThan(0);
  for (const key of ["catalog", "registry", "theme", "copy", "index"]) {
    expect(key in result).toBe(false);
  }
  return result;
}

describe("bootstrapRenderer closes the trust boundary on all three host paths", () => {
  it("bootstraps the framework path: a defaults-shaped catalog and its registry", () => {
    const catalog = catalogOf(screenSpec(), modalSpec(), plainSpec("Text"), plainSpec("Badge"));
    const registry = registryFor("Screen", "Modal", "Text", "Badge");

    const session = accepted(bootstrapRenderer({ catalog, registry, theme: THEME }));

    expect(session.catalog.components.map((spec) => spec.tag)).toEqual([
      "Screen",
      "Modal",
      "Text",
      "Badge",
    ]);
    expect([...session.index.keys()].sort()).toEqual(["Badge", "Modal", "Screen", "Text"]);
    expect(session.index.get("Screen")?.acceptsChildren).toBe(true);
    expect(session.theme.color.accent).toBe("#2563eb");
    expect(Object.keys(session.registry).sort()).toEqual(["Badge", "Modal", "Screen", "Text"]);
  });

  it("bootstraps a host that registers only its own components", () => {
    // None of these tags is a framework default. A host's trusted React is as
    // legitimate as the shipped implementations, provided the two halves match.
    const catalog = catalogOf(screenSpec(), modalSpec(), plainSpec("Gauge"), plainSpec("Panel"));
    const registry = registryFor("Screen", "Modal", "Gauge", "Panel");

    const session = accepted(bootstrapRenderer({ catalog, registry, theme: THEME }));

    expect([...session.index.keys()].sort()).toEqual(["Gauge", "Modal", "Panel", "Screen"]);
  });

  it("bootstraps a duplicate-free combination of defaults and custom components", () => {
    const defaultsShaped: Readonly<Record<string, Implementation>> = Object.freeze({
      Screen: stub("Screen"),
      Modal: stub("Modal"),
      Text: stub("Text"),
    });
    const composed = createRegistry([...Object.entries(defaultsShaped), ["Gauge", stub("Gauge")]]);
    if (!composed.ok) {
      throw new Error(`fixture composition rejected: ${composed.code}`);
    }
    const catalog = catalogOf(screenSpec(), modalSpec(), plainSpec("Text"), plainSpec("Gauge"));

    const session = accepted(
      bootstrapRenderer({ catalog, registry: composed.registry, theme: THEME }),
    );

    expect([...session.index.keys()].sort()).toEqual(["Gauge", "Modal", "Screen", "Text"]);
    // The composed registry holds the *same* trusted implementations the host
    // supplied — combination adds tags, it does not re-create components.
    expect(session.registry["Text"]).toBe(defaultsShaped["Text"]);
  });
});

describe("bootstrapRenderer owns the registry for the life of the session", () => {
  it("snapshots the registry, so a caller's later mutation cannot reach the session", () => {
    // Deliberately mutable and prototype-bearing: the shape a host gets from an
    // object literal it built by hand, rather than from `createRegistry`.
    const hostRegistry: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
    };
    const catalog = catalogOf(screenSpec(), modalSpec());

    const session = accepted(bootstrapRenderer({ catalog, registry: hostRegistry, theme: THEME }));

    hostRegistry["Injected"] = stub("Injected");
    delete hostRegistry["Modal"];
    hostRegistry["Screen"] = stub("swapped");

    expect(session.registry).not.toBe(hostRegistry);
    expect(Object.isFrozen(session.registry)).toBe(true);
    expect(Object.keys(session.registry).sort()).toEqual(["Modal", "Screen"]);
    expect(session.registry["Injected"]).toBeUndefined();
    expect(session.registry["Screen"]).not.toBe(hostRegistry["Screen"]);
  });

  it("hands back a registry no consumer can extend afterwards", () => {
    // A **mutable, prototype-bearing** object literal, deliberately not built
    // through `createRegistry`. A fixture that arrived frozen and
    // null-prototyped would make both assertions below statements about the
    // fixture's construction rather than about what bootstrap did.
    const hostRegistry: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
    };
    expect(Object.isFrozen(hostRegistry)).toBe(false);
    expect(Object.getPrototypeOf(hostRegistry)).toBe(Object.prototype);

    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: hostRegistry,
        theme: THEME,
      }),
    );
    const target = session.registry as Record<string, Implementation>;

    expect(() => {
      target["Injected"] = stub("Injected");
    }).toThrow(TypeError);
    expect(Object.getPrototypeOf(session.registry)).toBeNull();
  });

  it("keeps two sessions in one process independent", () => {
    const first = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
      }),
    );
    const second = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec(), plainSpec("Gauge")),
        registry: registryFor("Screen", "Modal", "Gauge"),
        theme: THEME,
      }),
    );

    expect(Object.keys(first.registry).sort()).toEqual(["Modal", "Screen"]);
    expect(first.registry["Gauge"]).toBeUndefined();
    expect(first.index.has("Gauge")).toBe(false);
    expect(second.index.has("Gauge")).toBe(true);
    expect(first.catalog).not.toBe(second.catalog);
  });

  it("exports one function and nothing that could hold a session", () => {
    expect(Object.keys(bootstrapModule)).toEqual(["bootstrapRenderer"]);
  });
});

describe("bootstrapRenderer demands exact catalog and registry tag equality", () => {
  it("rejects a catalogued component with no trusted implementation", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec(), plainSpec("Text")),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("missing_implementation");
    expect(rejection.at).toBe("registry.Text");
  });

  it("rejects a registered implementation with no catalog spec", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal", "Text"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("uncatalogued_implementation");
    expect(rejection.at).toBe("registry.Text");
  });

  it("rejects a registry lacking a trusted Screen, at bootstrap rather than at first render", () => {
    // `Screen` is a registered member like any other, so this is exactly the
    // tag-equality rule — not a second, registry-only reservation.
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("missing_implementation");
    expect(rejection.at).toBe("registry.Screen");
  });

  it("rejects a registered Facet, the one reserved grammar position", () => {
    const hostRegistry: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
      Facet: stub("Facet"),
    };

    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: hostRegistry,
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("reserved_structural_tag");
    expect(rejection.at).toBe("registry.Facet");
  });

  it("accepts registered tags that merely look reserved", () => {
    const catalog = catalogOf(
      screenSpec(),
      modalSpec(),
      plainSpec("facet"),
      plainSpec("FacetThing"),
    );

    const session = accepted(
      bootstrapRenderer({
        catalog,
        registry: registryFor("Screen", "Modal", "facet", "FacetThing"),
        theme: THEME,
      }),
    );

    expect(session.index.has("facet")).toBe(true);
    expect(session.index.has("FacetThing")).toBe(true);
  });

  it("sees a surplus implementation hidden behind a non-enumerable key", () => {
    // `Object.keys` answers only *enumerable* own keys, so a host — or anything
    // that got hold of the object before Facet did — can register a component
    // the tag-equality check never looks at. The residual would be fail-safe
    // (the snapshot is built from catalog tags, so the extra implementation
    // never mounts), but bootstrap would be reporting success on a registry
    // that does not match the catalog, and silently discarding an
    // implementation the host believes it registered.
    const hostRegistry: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
    };
    Object.defineProperty(hostRegistry, "Evil", { value: stub("Evil"), enumerable: false });
    expect(Object.keys(hostRegistry)).not.toContain("Evil");
    expect(Object.getOwnPropertyNames(hostRegistry)).toContain("Evil");

    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: hostRegistry,
        theme: THEME,
      }),
    );

    expect(rejection.code).toBe("uncatalogued_implementation");
    expect(rejection.at).toBe("registry.Evil");
  });

  it("sees a reserved Facet hidden behind a non-enumerable key", () => {
    // The same weakness against bootstrap's **one rule of its own**. A
    // non-enumerable `Facet` would bypass the only check this module does not
    // delegate to the catalog.
    const hostRegistry: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
    };
    Object.defineProperty(hostRegistry, "Facet", { value: stub("Facet"), enumerable: false });

    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: hostRegistry,
        theme: THEME,
      }),
    );

    expect(rejection.code).toBe("reserved_structural_tag");
    expect(rejection.at).toBe(`registry.Facet`);
  });

  it("records the one residual: a proxy that lies about its own keys", () => {
    // `getOwnPropertyNames` closes the enumerability hole but still asks the
    // object what it owns, and a `Proxy` may answer with less than it holds.
    // That is not closable in general — every enumeration primitive routes
    // through the same trap — so what this pins is that the **residual is
    // fail-safe**: bootstrap accepts, but the session's registry is built from
    // the catalog's tags, so the concealed `Facet` implementation is absent
    // from what actually mounts.
    const concealed = stub("Facet");
    const backing: Record<string, Implementation> = {
      Screen: stub("Screen"),
      Modal: stub("Modal"),
      Facet: concealed,
    };
    const lying = new Proxy(backing, {
      ownKeys: () => ["Screen", "Modal"],
    }) as ComponentRegistry;

    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: lying,
        theme: THEME,
      }),
    );

    expect(Object.getOwnPropertyNames(session.registry)).toEqual(["Screen", "Modal"]);
    expect(session.registry["Facet"]).toBeUndefined();
    expect(Object.values(session.registry)).not.toContain(concealed);
  });

  it("records the accepted gap: manual spreading resolves a collision before Facet sees it", () => {
    // `createRegistry`'s duplicate defence is **opt-in**, because
    // `bootstrapRenderer` accepts any record a host hands it. Composing the two
    // halves with object spread resolves the collision at the spread, leaving
    // Facet nothing to detect. The owner ruled manual spreading out of
    // contract; this states the consequence rather than leaving it implicit, so
    // that a future change of mind is a failing test rather than a re-discovery.
    const trusted = stub("trusted Modal");
    const attacker = stub("attacker Modal");
    const spread = { ...{ Screen: stub("Screen"), Modal: trusted }, ...{ Modal: attacker } };

    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: spread,
        theme: THEME,
      }),
    );

    expect(session.registry["Modal"]).toBe(attacker);
    expect(session.registry["Modal"]).not.toBe(trusted);
  });

  it("rejects an implementation that is not callable", () => {
    const hostRegistry = {
      Screen: stub("Screen"),
      Modal: { title: "not a component" },
    } as unknown as ComponentRegistry;

    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: hostRegistry,
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("implementation_not_callable");
    expect(rejection.at).toBe("registry.Modal");
  });

  it("rejects a registry that is not an object at all", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: null as unknown as ComponentRegistry,
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("registry_not_an_object");
    expect(rejection.at).toBe("registry");
  });
});

describe("bootstrapRenderer mirrors the catalog's Screen rule rather than re-inventing it", () => {
  it("relays the missing-Screen rejection with its pinned code and location", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(modalSpec(), plainSpec("Text")),
      registry: registryFor("Modal", "Text"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("missing_screen_spec");
    expect(rejection.at).toBe("components");
  });

  it("relays the pre-existing duplicate-tag rejection for a second Screen", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("duplicate_tag");
    expect(rejection.at).toBe("components[1].tag");
  });

  it("relays every nonconforming-Screen fault under one code, located by fault", () => {
    const conforming = screenSpec();
    const cases: readonly { readonly spec: ComponentSpec; readonly at: string }[] = [
      { spec: { ...conforming, acceptsChildren: false }, at: "components[0].acceptsChildren" },
      {
        // The collect block is itself **conforming** — a declared value prop
        // other than the address, and the required scalar-string `name` the
        // address rule wants. WU-11's collection-address rule runs inside
        // ordinary member validation, ahead of the Screen refinement, so a
        // fixture whose `valueProp` named the address would reject as
        // `nonconforming_collect_name` and never reach the fault it is here to
        // exercise. What this case proves is that a Screen may not collect
        // **even when the collect block is otherwise valid**.
        spec: {
          ...conforming,
          props: {
            ...conforming.props,
            value: { type: "string", guidance: "The value this component collects." },
          },
          collect: { collectable: true, valueProp: "value" },
        },
        at: "components[0].collect",
      },
      { spec: { ...conforming, props: {} }, at: "components[0].props.name" },
      {
        spec: {
          ...conforming,
          props: { name: { type: "number", guidance: "A screen name.", required: true } },
        },
        at: "components[0].props.name.type",
      },
      {
        spec: {
          ...conforming,
          props: { name: { type: "string", guidance: "A screen name.", default: "home" } },
        },
        at: "components[0].props.name.default",
      },
      {
        spec: {
          ...conforming,
          props: {
            name: { type: "string", guidance: "A screen name.", required: true, enum: ["home"] },
          },
        },
        at: "components[0].props.name.enum",
      },
      {
        spec: {
          ...conforming,
          props: {
            name: { type: "string", guidance: "A screen name.", required: true, bindable: false },
          },
        },
        at: "components[0].props.name.bindable",
      },
      {
        spec: { ...conforming, props: { name: { type: "string", guidance: "A screen name." } } },
        at: "components[0].props.name.required",
      },
    ];

    for (const { spec, at } of cases) {
      const rejection = rejected(
        bootstrapRenderer({
          catalog: catalogOf(spec, modalSpec()),
          registry: registryFor("Screen", "Modal"),
          theme: THEME,
        }),
      );
      expect(rejection.code).toBe("nonconforming_screen_spec");
      expect(rejection.at).toBe(at);
    }
  });

  it("relays the catalog's own Facet reservation from the catalog position", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), { ...plainSpec("Facet"), tag: "Facet" }, modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("reserved_structural_tag");
    expect(rejection.at).toBe("components[1].tag");
  });
});

describe("bootstrapRenderer requires any registered Modal to conform, and no Modal at all", () => {
  it("rejects a Modal that omits a projected prop", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), {
        ...modalSpec(),
        props: {
          triggerLabel: { type: "string", guidance: "Opens it.", required: true },
        },
      }),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("modal_prop_omitted");
    expect(rejection.at).toBe("props.title");
  });

  it("rejects a Modal that substitutes its own default for a projected prop", () => {
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), {
        ...modalSpec(),
        props: {
          triggerLabel: { type: "string", guidance: "Opens it.", default: "Open" },
          title: { type: "string", guidance: "The heading.", required: true },
        },
      }),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("modal_prop_default_conflict");
  });

  it("bootstraps a catalog that registers no Modal at all", () => {
    // Owner ruling: **only `Screen` is mandatory**. `validateModalConformance`
    // still rejects an omitted spec when it is called — what changed is that
    // bootstrap calls it only when a `Modal` spec is present. A host with no
    // overlap contract gets a session that simply offers no authored modal tag
    // and no frame, rather than a rejection it cannot act on.
    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), plainSpec("Text")),
        registry: registryFor("Screen", "Text"),
        theme: THEME,
      }),
    );

    expect(session.index.has("Modal")).toBe(false);
    expect(Object.keys(session.registry).sort()).toEqual(["Screen", "Text"]);
  });

  it("bootstraps a custom-only host catalog: Screen plus its own components, no Modal", () => {
    // The DoD case for the ruling: not one framework tag anywhere, and no
    // `Modal`. Exact catalog/registry equality is unchanged and still carries
    // `Screen`.
    const catalog = catalogOf(
      screenSpec(),
      plainSpec("Gauge"),
      plainSpec("Panel"),
      plainSpec("Ledger"),
    );
    const registry = registryFor("Screen", "Gauge", "Panel", "Ledger");

    const session = accepted(bootstrapRenderer({ catalog, registry, theme: THEME }));

    expect([...session.index.keys()].sort()).toEqual(["Gauge", "Ledger", "Panel", "Screen"]);
    expect(session.index.has("Modal")).toBe(false);
    expect(session.copy).toBe(NEUTRAL_COPY_DEFAULTS);
  });

  it("still rejects a present nonconforming Modal in an otherwise custom-only catalog", () => {
    // Optional does not mean unchecked. A `Modal` a host *did* register is held
    // to the frame contract exactly as before, with the code and location
    // relayed unchanged.
    const result = bootstrapRenderer({
      catalog: catalogOf(screenSpec(), plainSpec("Gauge"), {
        ...modalSpec(),
        acceptsChildren: false,
      }),
      registry: registryFor("Screen", "Gauge", "Modal"),
      theme: THEME,
    });

    const rejection = rejected(result);
    expect(rejection.code).toBe("modal_must_accept_children");
    expect(rejection.at).toBe("acceptsChildren");
  });
});

describe("bootstrapRenderer resolves neutral copy from the framework and the host only", () => {
  it("uses the framework defaults themselves when the host configures nothing", () => {
    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
      }),
    );

    // Reference identity, not deep equality. The session's copy *is* the frozen
    // framework default object, so nothing was merged, copied over, or
    // reconstructed from anywhere else on the way through.
    expect(session.copy).toBe(NEUTRAL_COPY_DEFAULTS);
  });

  it("applies a host override once, and keeps every other string at its default", () => {
    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
        copy: { render: { preparing: "One moment…" } },
      }),
    );

    expect(session.copy.render.preparing).toBe("One moment…");
    expect(session.copy.render.componentUnavailable).toBe(
      NEUTRAL_COPY_DEFAULTS.render.componentUnavailable,
    );
    expect(session.copy.validation.messageTooLong).toBe(
      NEUTRAL_COPY_DEFAULTS.validation.messageTooLong,
    );
    expect(Object.isFrozen(session.copy)).toBe(true);
  });

  it("rejects host copy outside the closed form or over B-24", () => {
    const base = {
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    };

    const unknownKey = rejected(
      bootstrapRenderer({ ...base, copy: { render: { preparingNow: "hi" } } }),
    );
    expect(unknownKey.code).toBe("unknown_copy_key");

    const tooLong = rejected(
      bootstrapRenderer({
        ...base,
        copy: { render: { preparing: "x".repeat(BOUNDS.frameworkCopyChars + 1) } },
      }),
    );
    expect(tooLong.code).toBe("copy_too_long");
    expect(tooLong.at).toBe("render.preparing");
  });

  it("leaves the resolved copy byte-identical under a hostile catalog and registry", () => {
    // Everything an agent or a host could plausibly reach for as a copy
    // selector, all at once: prop names that match copy slots, prop names that
    // match copy *groups*, a `facet`-prefixed name (which owner decision 1 made
    // an ordinary custom prop), enum domains and defaults carrying replacement
    // text, when-to-use text carrying replacement text, and a registered tag
    // named after a copy slot. None of it is an input path.
    const hostile: ComponentSpec = {
      tag: "Preparing",
      whenToUse: "Preparing… Content unavailable. This section could not be displayed.",
      props: {
        preparing: { type: "string", guidance: "Owned copy.", default: "PWNED preparing" },
        componentUnavailable: { type: "string", guidance: "Owned copy.", default: "PWNED crash" },
        corruptSubtree: { type: "string", guidance: "Owned copy.", default: "PWNED corrupt" },
        render: { type: "string", guidance: "Owned group.", default: "PWNED render" },
        validation: { type: "string", guidance: "Owned group.", default: "PWNED validation" },
        messageTooLong: { type: "string", guidance: "Owned copy.", default: "PWNED too long" },
        facetPreparing: { type: "string", guidance: "Ordinary custom prop.", default: "PWNED" },
        tone: {
          type: "string",
          guidance: "A domain carrying replacement text.",
          enum: ["PWNED preparing", "PWNED crash"],
          default: "PWNED preparing",
        },
      },
      acceptsChildren: false,
    };

    // Serialized *before* the hostile bootstrap, so the comparison below is a
    // statement about what that call did to the shared frozen defaults rather
    // than a restatement of the reference identity asserted with it.
    const beforeBootstrap = JSON.stringify(NEUTRAL_COPY_DEFAULTS);

    const session = accepted(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec(), hostile),
        registry: registryFor("Screen", "Modal", "Preparing"),
        theme: THEME,
      }),
    );

    expect(session.copy).toBe(NEUTRAL_COPY_DEFAULTS);
    expect(JSON.stringify(session.copy)).toBe(beforeBootstrap);
    expect(JSON.stringify(session.copy)).not.toContain("PWNED");
  });

  it("resolves copy from the option's own value, never from a prototype", () => {
    // The option designed to be omitted is the live path: a host that omits
    // `copy` must get `NEUTRAL_COPY_DEFAULTS` even when something upstream has
    // planted a `copy` on `Object.prototype`. A prototype-chained read
    // (`options["copy"]`) hands that planted object straight to
    // `resolveNeutralCopy`, which then accepts it as a well-formed host
    // override — defeating one frame above it the `Object.hasOwn` discipline
    // core's `neutral-copy.ts` applies at every level.
    const polluted = { render: { preparing: "PWNED — attacker copy" } };
    Object.defineProperty(Object.prototype, "copy", {
      value: polluted,
      configurable: true,
      writable: true,
    });
    try {
      const options = {
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
      };
      // The pollution is live and would be read by any prototype-chained access.
      expect((options as { copy?: unknown }).copy).toBe(polluted);

      const session = accepted(bootstrapRenderer(options));

      expect(session.copy).toBe(NEUTRAL_COPY_DEFAULTS);
      expect(session.copy.render.preparing).not.toBe("PWNED — attacker copy");
    } finally {
      delete (Object.prototype as { copy?: unknown }).copy;
    }
  });

  it("has exactly one copy input, and it is the host's bootstrap option", () => {
    // The complementary half of the assertion above: changing the *only*
    // declared copy input is the only thing that changes the resolved copy.
    // The default is captured rather than spelled out — pinning WU-19's English
    // from here would make an edit to the copy set fail in an unrelated suite.
    const defaultCorrupt = NEUTRAL_COPY_DEFAULTS.render.corruptSubtree;
    const base = {
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    };
    const overridden: NeutralCopy = accepted(
      bootstrapRenderer({ ...base, copy: { render: { corruptSubtree: "Not shown" } } }),
    ).copy;

    expect(overridden.render.corruptSubtree).toBe("Not shown");
    expect(overridden).not.toBe(NEUTRAL_COPY_DEFAULTS);
    // Overriding is per-session: the framework defaults the *next* session will
    // resolve are untouched by this one.
    expect(NEUTRAL_COPY_DEFAULTS.render.corruptSubtree).toBe(defaultCorrupt);
    expect(accepted(bootstrapRenderer(base)).copy.render.corruptSubtree).toBe(defaultCorrupt);
  });
});

describe("bootstrapRenderer requires a complete theme", () => {
  it("relays a missing token rejection", () => {
    const incomplete = {
      ...THEME,
      color: { ...THEME.color, accent: undefined },
    } as unknown as FacetTheme;

    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: incomplete,
      }),
    );

    expect(rejection.at).toBe("color.accent");
  });

  it("relays a rejection for a theme that is not an object", () => {
    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: "dark" as unknown as FacetTheme,
      }),
    );

    expect(rejection.code.length).toBeGreaterThan(0);
  });
});

describe("bootstrapRenderer takes one closed object form and is total", () => {
  it("rejects anything that is not a bootstrap object", () => {
    for (const value of [null, undefined, "bootstrap", 7, [], true]) {
      const rejection = rejected(bootstrapRenderer(value as never));
      expect(rejection.code).toBe("bootstrap_not_an_object");
    }
  });

  it("rejects an option the form does not declare", () => {
    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
        transport: "sse",
      } as never),
    );

    expect(rejection.code).toBe("unknown_bootstrap_key");
    expect(rejection.at).toBe("transport");
  });

  it("rejects an undeclared option hidden behind a non-enumerable key", () => {
    // The closed form has to be closed against the *own property names*, not
    // just the enumerable ones — otherwise "an option it does not declare is a
    // rejection, not an ignored extra" is exactly what a host does not get.
    const options: Record<string, unknown> = {
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    };
    Object.defineProperty(options, "transport", { value: "sse", enumerable: false });

    const rejection = rejected(bootstrapRenderer(options as never));

    expect(rejection.code).toBe("unknown_bootstrap_key");
    expect(rejection.at).toBe("transport");
  });

  it("reads every option as an own property, so a prototype cannot supply one", () => {
    // A host that "configured" bootstrap by planting options on a prototype
    // configured nothing. Reading through the prototype chain would make the
    // form's closedness decorative: the key enumeration above sees own names
    // only, so anything reachable only by inheritance must be unreadable too,
    // or the two halves disagree.
    const planted = {
      catalog: catalogOf(screenSpec(), modalSpec()),
      registry: registryFor("Screen", "Modal"),
      theme: THEME,
    };
    const inherited = Object.create(planted) as Record<string, unknown>;
    expect(inherited["catalog"]).toBe(planted.catalog);
    expect(Object.getOwnPropertyNames(inherited)).toEqual([]);

    const rejection = rejected(bootstrapRenderer(inherited as never));

    expect(rejection.code).toBe("catalog_not_an_object");
  });

  it("leaves an inherited undeclared key alone, because nothing can read it", () => {
    // The complement, and a deliberate non-rejection: an unknown key reachable
    // only through the prototype chain configures nothing — no option read can
    // see it — so refusing it would turn unrelated `Object.prototype` pollution
    // into a bootstrap outage without closing anything. The closed form is
    // enforced over own property names; inheritance is simply not an input.
    const base = { transport: "sse" };
    const options = Object.create(base) as Record<string, unknown>;
    options["catalog"] = catalogOf(screenSpec(), modalSpec());
    options["registry"] = registryFor("Screen", "Modal");
    options["theme"] = THEME;

    const session = accepted(bootstrapRenderer(options as never));

    expect([...session.index.keys()].sort()).toEqual(["Modal", "Screen"]);
  });

  it("stays total when reading the catalog throws", () => {
    const hostile = {
      get components(): never {
        throw new Error("hostile catalog");
      },
    } as unknown as FacetCatalog;

    const rejection = rejected(
      bootstrapRenderer({
        catalog: hostile,
        registry: registryFor("Screen", "Modal"),
        theme: THEME,
      }),
    );

    expect(rejection.code).toBe("catalog_read_failed");
  });

  it("stays total when reading the registry throws", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("hostile registry");
        },
      },
    ) as ComponentRegistry;

    const rejection = rejected(
      bootstrapRenderer({
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: hostile,
        theme: THEME,
      }),
    );

    expect(rejection.code).toBe("bootstrap_read_failed");
  });

  it("answers rather than throws for every hostile option object", () => {
    // A sweep rather than another single case, because the option form now has
    // three distinct reflective steps — enumerating own names, testing own
    // presence, and reading the value — and each of them is a place a hostile
    // object can throw. Bootstrap is host configuration: a fault has to be a
    // result the host can read, never an exception unwinding out of it.
    const hostile: readonly unknown[] = [
      null,
      undefined,
      7,
      "bootstrap",
      true,
      Symbol("options"),
      [],
      () => 0,
      new Date(),
      Object.create(null),
      new Proxy(
        {},
        {
          ownKeys(): never {
            throw new Error("hostile ownKeys");
          },
        },
      ),
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor(): never {
            throw new Error("hostile descriptor");
          },
        },
      ),
      new Proxy(
        {},
        {
          has(): never {
            throw new Error("hostile has");
          },
        },
      ),
      new Proxy(
        {},
        {
          get(): never {
            throw new Error("hostile get");
          },
        },
      ),
      // A getter under a declared option name, once enumerable and once not:
      // the second is reachable only now that own *names* decide the form.
      throwingOption("catalog", true),
      throwingOption("copy", false),
      {
        catalog: catalogOf(screenSpec(), modalSpec()),
        registry: new Proxy(
          {},
          {
            ownKeys(): never {
              throw new Error("hostile registry");
            },
          },
        ),
        theme: THEME,
      },
    ];

    for (const [index, value] of hostile.entries()) {
      const result = bootstrapRenderer(value as never);
      expect(typeof result.ok, `hostile input ${index}`).toBe("boolean");
      if (result.ok) {
        throw new Error(`hostile input ${index} was accepted`);
      }
      expect(result.code.length, `hostile input ${index}`).toBeGreaterThan(0);
    }
  });

  it("reports the first fault in a fixed order, so the same input always rejects the same way", () => {
    // A catalog with no Screen, a registry carrying the reserved Facet, an
    // over-long copy string, and a broken theme, all at once. The catalog is
    // validated first, so its rejection is the one a host sees — every time.
    const hostRegistry: Record<string, Implementation> = { Modal: stub("Modal"), Facet: stub("F") };

    const first = rejected(
      bootstrapRenderer({
        catalog: catalogOf(modalSpec()),
        registry: hostRegistry,
        theme: {} as unknown as FacetTheme,
        copy: { render: { preparing: "x".repeat(BOUNDS.frameworkCopyChars + 1) } },
      }),
    );
    const second = rejected(
      bootstrapRenderer({
        catalog: catalogOf(modalSpec()),
        registry: hostRegistry,
        theme: {} as unknown as FacetTheme,
        copy: { render: { preparing: "x".repeat(BOUNDS.frameworkCopyChars + 1) } },
      }),
    );

    expect(first.code).toBe("missing_screen_spec");
    expect(first).toEqual(second);
  });
});
