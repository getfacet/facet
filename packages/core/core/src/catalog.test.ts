import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { buildCatalogIndex, validateCatalog, validateModalConformance } from "./catalog.js";
import type { CatalogValidationResult, FacetCatalog, ModalConformanceResult } from "./catalog.js";

function spec(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag,
    whenToUse: `Use ${tag} when the content calls for it.`,
    props: {},
    content: { mode: "none" },
    ...overrides,
  };
}

/**
 * The `Modal` the framework frame projects: a trigger label, a title, and flow
 * content in named body/actions slots. Everything else — scrim, placement, z band, focus trap,
 * escape — belongs to the frame, so it never appears in the registered schema.
 */
function conformingModal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag: "Modal",
    whenToUse: "Show focused content over the page without leaving the screen.",
    props: {
      triggerLabel: { type: "string", required: true, guidance: "Label of the opening control." },
      title: { type: "string", required: true, guidance: "Title shown in the frame header." },
    },
    content: {
      mode: "slots",
      slots: {
        body: { guidance: "Content shown in the frame.", minChildren: 1, maxChildren: 16 },
        actions: { guidance: "Actions shown in the footer.", minChildren: 0, maxChildren: 4 },
      },
    },
    ...overrides,
  };
}

function modalWithProps(props: Record<string, unknown>): Record<string, unknown> {
  return { ...conformingModal(), props };
}

/**
 * The `name` a conforming screen root declares: a plain required string the
 * author writes literally. No `default`, `enum` or `bindable` key — a screen
 * whose name could be defaulted, drawn from a domain or bound would not resolve
 * to a stable navigation target before the renderer mounts it.
 */
function screenNameProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "string",
    required: true,
    guidance: "The name this screen is navigated to by.",
    ...overrides,
  };
}

/**
 * The `Screen` root every valid catalog registers, in its **conforming** shape.
 * Presence alone is not enough: the renderer mounts a stored `Screen` root, so
 * the registered spec has to be one the grammar and renderer can actually use.
 * Every downstream fixture copies this exact shape — a bare
 * `{ tag: "Screen", content: { mode: "children" } }` is **not** conforming.
 */
function screenSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return spec("Screen", {
    props: { name: screenNameProp() },
    content: { mode: "children" },
    ...overrides,
  });
}

/**
 * The framework's collection address on a collectable member: the exact
 * lowercase `name`, a required scalar string with no `default`, `enum` or
 * `bindable` key. `component-spec.ts` owns the rule; a catalog inherits it
 * through ordinary member validation, which is why these fixtures live here too.
 */
function collectNameProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "string",
    required: true,
    guidance: "The name a collect list addresses this field by.",
    ...overrides,
  };
}

/** A collectable member, in the shape WU-25 registers for `Field`. */
function collectableSpec(props: Record<string, unknown>): Record<string, unknown> {
  return spec("Field", {
    props: { value: { type: "string", guidance: "The current value." }, ...props },
    collect: { collectable: true, valueProp: "value", valueKind: "string" },
  });
}

/** A catalog holding exactly the given members, Screen or not. */
function catalogOf(...components: readonly unknown[]): Record<string, unknown> {
  return { components };
}

/**
 * The same, with the required `Screen` appended. It goes **last** so a member's
 * index in these fixtures is the index the rejection names.
 */
function catalogWithScreen(...components: readonly unknown[]): Record<string, unknown> {
  return catalogOf(...components, screenSpec());
}

function acceptCatalog(value: unknown): FacetCatalog {
  const result = validateCatalog(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.catalog;
}

function catalogRejection(value: unknown): string {
  const result = validateCatalog(value);
  return result.ok ? "accepted" : result.code;
}

function catalogRejectionAt(value: unknown): string {
  const result = validateCatalog(value);
  return result.ok ? "accepted" : result.at;
}

function modalRejection(value: unknown): string {
  const result = validateModalConformance(value);
  return result.ok ? "accepted" : result.code;
}

describe("validateCatalog — the accepted catalog", () => {
  it("accepts a catalog of distinct components", () => {
    const catalog = acceptCatalog(catalogWithScreen(spec("Card"), spec("Text"), conformingModal()));
    expect(catalog.components.map((component) => component.tag)).toEqual([
      "Card",
      "Text",
      "Modal",
      "Screen",
    ]);
  });

  it("returns a frozen catalog the host cannot widen after validation", () => {
    const source = catalogWithScreen(spec("Card"));
    const catalog = acceptCatalog(source);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.components)).toBe(true);
    (source["components"] as unknown[]).push(spec("Injected"));
    expect(catalog.components).toHaveLength(2);
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const duplicated = catalogOf(spec("Card"), spec("Card"));
    expect(validateCatalog(duplicated)).toEqual(validateCatalog(duplicated));
  });
});

describe("validateCatalog — duplicate tags are rejected (one tag, one component)", () => {
  it("rejects two components sharing a tag", () => {
    expect(catalogRejection(catalogOf(spec("Card"), spec("Text"), spec("Card")))).toBe(
      "duplicate_tag",
    );
  });

  it("names the second occurrence, not the first", () => {
    expect(catalogRejectionAt(catalogOf(spec("Card"), spec("Text"), spec("Card")))).toBe(
      "components[2].tag",
    );
  });

  it("treats tags differing only in case as distinct — the registry match is exact", () => {
    expect(validateCatalog(catalogWithScreen(spec("Card"), spec("card"))).ok).toBe(true);
  });
});

describe("validateCatalog — slot tag restrictions resolve inside the same catalog", () => {
  function structured(allowedTags: readonly string[]): Record<string, unknown> {
    return spec("Structured", {
      content: {
        mode: "slots",
        slots: {
          items: {
            guidance: "Components admitted to this region.",
            minChildren: 0,
            maxChildren: 4,
            allowedTags,
          },
        },
      },
    });
  }

  it("accepts a forward reference to a component registered later", () => {
    expect(validateCatalog(catalogWithScreen(structured(["Card"]), spec("Card"))).ok).toBe(true);
  });

  it("rejects an allowed tag no component in the catalog registers", () => {
    const value = catalogWithScreen(structured(["Missing"]), spec("Card"));
    expect(catalogRejection(value)).toBe("unknown_allowed_tag");
    expect(catalogRejectionAt(value)).toBe("components[0].content.slots.items.allowedTags.0");
  });
});

describe("validateCatalog — component recipe namespaces stay unique", () => {
  const recipe = { tokens: { background: "color" } };

  it("rejects two recipe-owning components whose tags collide after CSS projection", () => {
    expect(
      catalogRejection(
        catalogWithScreen(
          spec("MetricCard", { themeRecipe: recipe }),
          spec("Metric-Card", { themeRecipe: recipe }),
        ),
      ),
    ).toBe("duplicate_theme_recipe_namespace");
  });

  it("names the second component whose recipe namespace collides", () => {
    expect(
      catalogRejectionAt(
        catalogWithScreen(
          spec("MetricCard", { themeRecipe: recipe }),
          spec("Metric-Card", { themeRecipe: recipe }),
        ),
      ),
    ).toBe("components[1].tag");
  });

  it("does not reject a non-recipe component that shares the projected spelling", () => {
    expect(
      validateCatalog(
        catalogWithScreen(spec("MetricCard", { themeRecipe: recipe }), spec("Metric-Card")),
      ).ok,
    ).toBe(true);
  });
});

describe("validateCatalog — `Facet` is the one reserved grammar position", () => {
  it("rejects a component registered under the `Facet` grammar position", () => {
    expect(catalogRejection(catalogOf(spec("Facet")))).toBe("reserved_structural_tag");
  });

  it("names the offending registration's tag", () => {
    expect(catalogRejectionAt(catalogOf(spec("Text"), spec("Facet")))).toBe("components[1].tag");
  });

  it("matches `Facet` exactly — a longer tag that starts with it is legal", () => {
    expect(validateCatalog(catalogWithScreen(spec("FacetThing"))).ok).toBe(true);
  });

  it("matches `Facet` case-sensitively — `facet` is an ordinary tag", () => {
    expect(validateCatalog(catalogWithScreen(spec("facet"))).ok).toBe(true);
  });

  it("rejects the whole catalog and leaves the input untouched", () => {
    const source = catalogOf(spec("Card"), spec("Facet"));
    const before = JSON.stringify(source);
    expect(validateCatalog(source).ok).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const reserved = catalogOf(spec("Facet"));
    expect(validateCatalog(reserved)).toEqual(validateCatalog(reserved));
  });
});

/**
 * `Screen` is a registered component, not a reserved position. The renderer
 * mounts a stored `Screen` root and bootstrap demands exact catalog/registry
 * equality, so a catalog that could not register `Screen` would be
 * unsatisfiable — and one that simply omits it has no root to mount.
 */
describe("validateCatalog — every valid catalog registers exactly one `Screen`", () => {
  it("accepts a component registered under the `Screen` tag", () => {
    const catalog = acceptCatalog(catalogOf(spec("Text"), screenSpec()));
    expect(catalog.components.map((component) => component.tag)).toEqual(["Text", "Screen"]);
  });

  it("accepts the minimal catalog — one Screen and nothing else", () => {
    expect(acceptCatalog(catalogOf(screenSpec())).components).toHaveLength(1);
  });

  it("rejects a catalog carrying no Screen spec", () => {
    expect(catalogRejection(catalogOf(spec("Card"), spec("Text")))).toBe("missing_screen_spec");
  });

  it("rejects an empty catalog — zero Screens is not a special case", () => {
    expect(catalogRejection(catalogOf())).toBe("missing_screen_spec");
  });

  it("names the components array, because no single member is at fault", () => {
    expect(catalogRejectionAt(catalogOf(spec("Card")))).toBe("components");
  });

  it("rejects a second Screen through the duplicate-tag rule, naming the second", () => {
    const twoScreens = catalogOf(screenSpec(), spec("Card"), screenSpec());
    expect(catalogRejection(twoScreens)).toBe("duplicate_tag");
    expect(catalogRejectionAt(twoScreens)).toBe("components[2].tag");
  });

  it("does not accept a near-miss spelling as the Screen root", () => {
    expect(catalogRejection(catalogOf(spec("Screens"), spec("screen")))).toBe(
      "missing_screen_spec",
    );
  });

  it("reports a member's own rejection first — the Screen check runs after the members", () => {
    const broken = { ...spec("Card"), category: "surface" };
    expect(catalogRejection(catalogOf(broken))).toBe("unknown_spec_key");
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const rootless = catalogOf(spec("Card"));
    expect(validateCatalog(rootless)).toEqual(validateCatalog(rootless));
  });
});

/**
 * Presence is not conformance. A merely-present `Screen` would let a host
 * bootstrap a screen root the grammar and renderer cannot safely mount — one
 * that takes no children, collects a value, or carries a `name` the author
 * cannot write literally. The refinement is pinned to **one** code,
 * `nonconforming_screen_spec`, whose location names the offending member and
 * key; WU-31's bootstrap mirrors this rather than inventing a registry-only rule.
 */
describe("validateCatalog — the registered `Screen` must conform, not merely exist", () => {
  /** The Screen sits at index 1 throughout, so the location must name it. */
  function screenCatalog(overrides: Record<string, unknown>): Record<string, unknown> {
    return catalogOf(spec("Card"), screenSpec(overrides));
  }

  function nameProp(overrides: Record<string, unknown>): Record<string, unknown> {
    return { props: { name: screenNameProp(overrides) } };
  }

  it("accepts the conforming Screen", () => {
    expect(validateCatalog(screenCatalog({})).ok).toBe(true);
  });

  it("accepts a Screen that adds ordinary presentation props beside `name`", () => {
    const decorated = nameProp({});
    decorated["props"] = {
      name: screenNameProp(),
      tone: { type: "string", enum: ["plain", "muted"], guidance: "The screen's tone." },
    };
    expect(validateCatalog(screenCatalog(decorated)).ok).toBe(true);
  });

  it("still validates those extra props normally — they are not exempted", () => {
    const undocumented = { props: { name: screenNameProp(), tone: { type: "string" } } };
    expect(catalogRejection(screenCatalog(undocumented))).toBe("invalid_prop_guidance");
  });

  it("rejects a Screen whose `name` prop is absent", () => {
    expect(catalogRejection(screenCatalog({ props: {} }))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog({ props: {} }))).toBe("components[1].props.name");
  });

  it("rejects a Screen whose `name` is not a scalar string", () => {
    const wrongType = nameProp({ type: "number" });
    expect(catalogRejection(screenCatalog(wrongType))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(wrongType))).toBe("components[1].props.name.type");
  });

  it("rejects a bound `name` — the type check names the structured branch first", () => {
    const bound = {
      props: { name: { type: "array", required: true, bindable: true, guidance: "n" } },
    };
    expect(catalogRejection(screenCatalog(bound))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(bound))).toBe("components[1].props.name.type");
  });

  it("rejects a Screen whose `name` omits `required`", () => {
    const optional = { props: { name: { type: "string", guidance: "The screen name." } } };
    expect(catalogRejection(screenCatalog(optional))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(optional))).toBe("components[1].props.name.required");
  });

  it("rejects a Screen whose `name` declares `required: false`", () => {
    const optional = nameProp({ required: false });
    expect(catalogRejection(screenCatalog(optional))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(optional))).toBe("components[1].props.name.required");
  });

  it("rejects a `default` on `name` — the key, not a falsy value", () => {
    const defaulted = { props: { name: { type: "string", guidance: "n", default: "home" } } };
    expect(catalogRejection(screenCatalog(defaulted))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(defaulted))).toBe("components[1].props.name.default");
  });

  it("rejects an `enum` on `name`", () => {
    const domained = nameProp({ enum: ["home", "detail"] });
    expect(catalogRejection(screenCatalog(domained))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(domained))).toBe("components[1].props.name.enum");
  });

  it("rejects `bindable: true` on `name`", () => {
    const bindable = nameProp({ bindable: true });
    expect(catalogRejection(screenCatalog(bindable))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(bindable))).toBe("components[1].props.name.bindable");
  });

  it("rejects `bindable: false` on `name` — an absent key is required, not a false one", () => {
    const bindable = nameProp({ bindable: false });
    expect(catalogRejection(screenCatalog(bindable))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(bindable))).toBe("components[1].props.name.bindable");
  });

  it("rejects a Screen that accepts no children — a screen root holds content", () => {
    const childless = { content: { mode: "none" } };
    expect(catalogRejection(screenCatalog(childless))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(childless))).toBe("components[1].content");
  });

  /**
   * A collecting `Screen` that is otherwise well formed: the collected value has
   * its **own** declared prop, because the address may not double as the value
   * prop and a spec that breaks that rule would be rejected by member validation
   * before it ever reached this refinement.
   */
  const collectingScreen: Record<string, unknown> = {
    props: { name: screenNameProp(), value: { type: "string", guidance: "The current value." } },
    collect: { collectable: true, valueProp: "value", valueKind: "string" },
  };

  it("rejects a Screen declaring collect — a screen root is not a collected value", () => {
    expect(catalogRejection(screenCatalog(collectingScreen))).toBe("nonconforming_screen_spec");
    expect(catalogRejectionAt(screenCatalog(collectingScreen))).toBe("components[1].collect");
  });

  it("pins one code for every nonconformity, so WU-31 mirrors a single name", () => {
    const nonconforming: readonly Record<string, unknown>[] = [
      { props: {} },
      nameProp({ type: "number" }),
      { props: { name: { type: "string", guidance: "n" } } },
      nameProp({ required: false }),
      { props: { name: { type: "string", guidance: "n", default: "home" } } },
      nameProp({ enum: ["home"] }),
      nameProp({ bindable: true }),
      nameProp({ bindable: false }),
      { content: { mode: "none" } },
      collectingScreen,
    ];
    const codes = nonconforming.map((overrides) => catalogRejection(screenCatalog(overrides)));
    expect(codes).toEqual(Array.from({ length: 10 }, () => "nonconforming_screen_spec"));
  });

  it("leaves bounded guidance to ordinary prop validation rather than restating B-13", () => {
    const overlong = nameProp({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(catalogRejection(screenCatalog(overlong))).toBe("prop_guidance_too_long");
  });

  it("lets ordinary member validation reject first — a required `name` with a default", () => {
    const contradicting = nameProp({ default: "home" });
    expect(catalogRejection(screenCatalog(contradicting))).toBe("required_prop_with_default");
  });

  it("lets a sibling member's own rejection come first", () => {
    const broken = { ...spec("Card"), category: "surface" };
    expect(catalogRejection(catalogOf(broken, screenSpec({ content: { mode: "none" } })))).toBe(
      "unknown_spec_key",
    );
  });

  it("lets `duplicate_tag` come first — the refinement does not reorder precedence", () => {
    const duplicated = catalogOf(
      spec("Card"),
      spec("Card"),
      screenSpec({ content: { mode: "none" } }),
    );
    expect(catalogRejection(duplicated)).toBe("duplicate_tag");
  });

  it("reports a missing Screen before conformance — there is nothing to refine", () => {
    expect(catalogRejection(catalogOf(spec("Card")))).toBe("missing_screen_spec");
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const nonconforming = screenCatalog({ content: { mode: "none" } });
    expect(validateCatalog(nonconforming)).toEqual(validateCatalog(nonconforming));
  });
});

/**
 * The collection address at the catalog boundary (D-08).
 *
 * `component-spec.ts` owns the rule — a collectable spec declares the exact
 * lowercase `name` as a required scalar string — and the catalog inherits it
 * through ordinary member validation. That inheritance is what fixes its place
 * in the deterministic order: it is a member's own rejection, so it comes ahead
 * of `duplicate_tag`, `missing_screen_spec` and the screen refinement alike,
 * and it is relayed with the failing member's index like any other.
 */
describe("validateCatalog — a collectable member must declare its collection address", () => {
  it("accepts a catalog whose collectable member declares a conforming address", () => {
    const catalog = acceptCatalog(catalogWithScreen(collectableSpec({ name: collectNameProp() })));
    expect(catalog.components[0]?.collect?.valueProp).toBe("value");
    expect(catalog.components[0]?.props["name"]?.type).toBe("string");
    expect(catalog.components[0]?.props["name"]?.required).toBe(true);
  });

  it("rejects a collectable member that declares no address, naming its index", () => {
    const missing = catalogWithScreen(collectableSpec({}));
    expect(catalogRejection(missing)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(missing)).toBe("components[0].props.name");
  });

  it("rejects a nonconforming address, naming the offending key under its index", () => {
    const bound = catalogWithScreen(collectableSpec({ name: collectNameProp({ bindable: true }) }));
    expect(catalogRejection(bound)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(bound)).toBe("components[0].props.name.bindable");
  });

  it("relays every branch of the rule, not only the key check", () => {
    const wrongType = catalogWithScreen(
      collectableSpec({ name: collectNameProp({ type: "number" }) }),
    );
    expect(catalogRejection(wrongType)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(wrongType)).toBe("components[0].props.name.type");
    const optional = catalogWithScreen(
      collectableSpec({ name: { type: "string", guidance: "The name." } }),
    );
    expect(catalogRejection(optional)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(optional)).toBe("components[0].props.name.required");
  });

  it("relays the address/value-prop collision under the same code and index", () => {
    const collided = catalogWithScreen(
      spec("Field", {
        props: { name: collectNameProp() },
        collect: { collectable: true, valueProp: "name", valueKind: "string" },
      }),
    );
    expect(catalogRejection(collided)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(collided)).toBe("components[0].collect.valueProp");
  });

  it("comes before `missing_screen_spec` — a member's own rejection is first", () => {
    expect(catalogRejection(catalogOf(collectableSpec({})))).toBe("nonconforming_collect_name");
  });

  it("comes before `duplicate_tag` — the members are validated in order", () => {
    const duplicated = catalogWithScreen(collectableSpec({}), spec("Card"), spec("Card"));
    expect(catalogRejection(duplicated)).toBe("nonconforming_collect_name");
  });

  it("comes before the screen refinement, which is a separate rule with its own code", () => {
    const both = catalogOf(collectableSpec({}), screenSpec({ content: { mode: "none" } }));
    expect(catalogRejection(both)).toBe("nonconforming_collect_name");
    expect(
      catalogRejection(catalogOf(spec("Card"), screenSpec({ content: { mode: "none" } }))),
    ).toBe("nonconforming_screen_spec");
  });

  it("applies to a collectable Screen too — the address rule is not tag-specific", () => {
    const collectingScreen = screenSpec({
      props: {
        name: collectNameProp({ bindable: true }),
        value: { type: "string", guidance: "The current value." },
      },
      collect: { collectable: true, valueProp: "value", valueKind: "string" },
    });
    const catalog = catalogOf(spec("Card"), collectingScreen);
    expect(catalogRejection(catalog)).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(catalog)).toBe("components[1].props.name.bindable");
  });

  it("leaves `name` ordinary on a member that collects nothing", () => {
    const ornamental = spec("Badge", {
      props: { name: { type: "object", guidance: "A bound record.", bindable: true } },
    });
    expect(validateCatalog(catalogWithScreen(ornamental)).ok).toBe(true);
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const missing = catalogWithScreen(collectableSpec({}));
    expect(validateCatalog(missing)).toEqual(validateCatalog(missing));
  });
});

/**
 * The collection request list at the catalog boundary (D-08).
 *
 * `component-spec.ts` owns this rule too — the exact lowercase declared prop
 * `collect` is a scalar string carrying no `default`, `enum` or `bindable` key —
 * and the catalog inherits it through ordinary member validation, exactly as it
 * inherits the address rule above. That is what fixes its place in the
 * deterministic order: it is a member's own rejection, so it precedes
 * `duplicate_tag`, `missing_screen_spec` and the screen refinement, and it is
 * relayed with the failing member's index.
 *
 * The two collection codes stay distinguishable here as well: this one names a
 * catalog's **declaration** of the request list, `nonconforming_collect_name`
 * names the **address** a request resolves to, and the declaration is read
 * first.
 */
describe("validateCatalog — a declared `collect` prop must be the framework request list", () => {
  /** The request list in its conforming shape, as WU-25 registers it on `Button`. */
  function collectRequestProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "string",
      guidance: "The field names this event carries, separated by spaces.",
      ...overrides,
    };
  }

  /** A member that declares the list and collects nothing — a `Button`. */
  function requesterSpec(schema: unknown = collectRequestProp()): Record<string, unknown> {
    return spec("Button", {
      props: {
        label: { type: "string", required: true, guidance: "The words on the control." },
        collect: schema,
      },
    });
  }

  it("accepts a catalog whose member declares a conforming request list", () => {
    const catalog = acceptCatalog(catalogWithScreen(requesterSpec()));
    expect(catalog.components[0]?.props["collect"]?.type).toBe("string");
    expect(catalog.components[0]?.collect).toBeUndefined();
  });

  it("rejects a nonconforming declaration, naming the offending key under its index", () => {
    const bound = catalogWithScreen(requesterSpec(collectRequestProp({ bindable: true })));
    expect(catalogRejection(bound)).toBe("nonconforming_collect_request");
    expect(catalogRejectionAt(bound)).toBe("components[0].props.collect.bindable");
  });

  it("relays every branch of the rule, not only the binding key", () => {
    const rows: readonly (readonly [unknown, string])[] = [
      [{ type: "number", guidance: "A count." }, "components[0].props.collect.type"],
      [collectRequestProp({ default: "" }), "components[0].props.collect.default"],
      [collectRequestProp({ enum: ["amount"] }), "components[0].props.collect.enum"],
    ];
    for (const [schema, at] of rows) {
      const catalog = catalogWithScreen(requesterSpec(schema));
      expect(catalogRejection(catalog)).toBe("nonconforming_collect_request");
      expect(catalogRejectionAt(catalog)).toBe(at);
    }
  });

  it("comes before `missing_screen_spec` — a member's own rejection is first", () => {
    const bad = requesterSpec(collectRequestProp({ bindable: true }));
    expect(catalogRejection(catalogOf(bad))).toBe("nonconforming_collect_request");
    // The control: with a conforming list the same rootless catalog reaches the
    // Screen rule, so the row above rejects for the declaration it has.
    expect(catalogRejection(catalogOf(requesterSpec()))).toBe("missing_screen_spec");
  });

  it("comes before `duplicate_tag` — the members are validated in order", () => {
    const bad = requesterSpec(collectRequestProp({ bindable: true }));
    const duplicated = catalogWithScreen(bad, spec("Card"), spec("Card"));
    expect(catalogRejection(duplicated)).toBe("nonconforming_collect_request");
    expect(catalogRejection(catalogWithScreen(requesterSpec(), spec("Card"), spec("Card")))).toBe(
      "duplicate_tag",
    );
  });

  it("applies to the `Screen` member too, ahead of the screen refinement", () => {
    const nonconforming = screenSpec({
      props: { name: screenNameProp(), collect: collectRequestProp({ enum: ["home"] }) },
      content: { mode: "none" },
    });
    const catalog = catalogOf(spec("Card"), nonconforming);
    expect(catalogRejection(catalog)).toBe("nonconforming_collect_request");
    expect(catalogRejectionAt(catalog)).toBe("components[1].props.collect.enum");
    // The control: with a conforming list the same Screen fails the refinement,
    // so the row above is not rejecting through the refinement's own code.
    const conforming = screenSpec({
      props: { name: screenNameProp(), collect: collectRequestProp() },
      content: { mode: "none" },
    });
    expect(catalogRejection(catalogOf(spec("Card"), conforming))).toBe("nonconforming_screen_spec");
  });

  it("comes before the address rule, which answers a different question", () => {
    const both = spec("Field", {
      props: {
        value: { type: "string", guidance: "The current value." },
        collect: collectRequestProp({ bindable: true }),
      },
      collect: { collectable: true, valueProp: "value", valueKind: "string" },
    });
    expect(catalogRejection(catalogWithScreen(both))).toBe("nonconforming_collect_request");
    expect(catalogRejectionAt(catalogWithScreen(both))).toBe(
      "components[0].props.collect.bindable",
    );
    // The control: the same member with a conforming list reaches the address
    // rule and reports the missing address under the other code.
    const addressOnly = spec("Field", {
      props: {
        value: { type: "string", guidance: "The current value." },
        collect: collectRequestProp(),
      },
      collect: { collectable: true, valueProp: "value", valueKind: "string" },
    });
    expect(catalogRejection(catalogWithScreen(addressOnly))).toBe("nonconforming_collect_name");
    expect(catalogRejectionAt(catalogWithScreen(addressOnly))).toBe("components[0].props.name");
  });

  it("leaves the declaration to ordinary member validation first", () => {
    const overlong = collectRequestProp({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(catalogRejection(catalogWithScreen(requesterSpec(overlong)))).toBe(
      "prop_guidance_too_long",
    );
    expect(catalogRejection(catalogWithScreen(requesterSpec({ type: "string" })))).toBe(
      "invalid_prop_guidance",
    );
  });

  it("leaves a differently spelled prop ordinary — the match is exact", () => {
    const ordinary = spec("Chart", {
      props: { Collect: { type: "object", guidance: "A bound record.", bindable: true } },
    });
    expect(validateCatalog(catalogWithScreen(ordinary)).ok).toBe(true);
  });

  it("is relayed by `validateModalConformance` too — it validates the member first", () => {
    const modal = conformingModal({
      props: {
        triggerLabel: { type: "string", required: true, guidance: "Label of the opening control." },
        title: { type: "string", required: true, guidance: "Title shown in the frame header." },
        collect: collectRequestProp({ bindable: true }),
      },
    });
    expect(modalRejection(modal)).toBe("nonconforming_collect_request");
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const bound = catalogWithScreen(requesterSpec(collectRequestProp({ bindable: true })));
    expect(validateCatalog(bound)).toEqual(validateCatalog(bound));
  });
});

/**
 * The event argument at the catalog boundary (D-07).
 *
 * `component-spec.ts` owns this rule as well — the exact lowercase declared prop
 * `arg` is a scalar string carrying no `default` and no `bindable` key, though
 * `required` and `enum` stay its own business — and the catalog inherits it
 * through ordinary member validation, exactly as it inherits the two collection
 * rules above. It is therefore a member's own rejection, ahead of
 * `duplicate_tag`, `missing_screen_spec` and the screen refinement, relayed with
 * the failing member's index.
 */
describe("validateCatalog — a declared `arg` prop must be the framework event argument", () => {
  /** The event argument in its conforming shape, as WU-25 registers it on `Button`. */
  function eventArgProp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "string",
      guidance: "One explicit argument sent with an `agent:` event.",
      ...overrides,
    };
  }

  /** A member that declares the argument — a `Button`. */
  function senderSpec(schema: unknown = eventArgProp()): Record<string, unknown> {
    return spec("Button", {
      props: {
        label: { type: "string", required: true, guidance: "The words on the control." },
        arg: schema,
      },
    });
  }

  it("accepts a catalog whose member declares a conforming argument", () => {
    const catalog = acceptCatalog(catalogWithScreen(senderSpec()));
    expect(catalog.components[0]?.props["arg"]?.type).toBe("string");
  });

  it("accepts `required` and `enum` on the argument, read back off the catalog", () => {
    const catalog = acceptCatalog(
      catalogWithScreen(senderSpec(eventArgProp({ required: true, enum: ["approve", "reject"] }))),
    );
    const arg = catalog.components[0]?.props["arg"];
    expect(arg?.required).toBe(true);
    expect(arg?.type === "string" ? arg.enum : undefined).toEqual(["approve", "reject"]);
  });

  it("rejects a nonconforming declaration, naming the offending key under its index", () => {
    const bound = catalogWithScreen(senderSpec(eventArgProp({ bindable: true })));
    expect(catalogRejection(bound)).toBe("nonconforming_event_arg");
    expect(catalogRejectionAt(bound)).toBe("components[0].props.arg.bindable");
  });

  it("relays every branch of the rule, not only the binding key", () => {
    const rows: readonly (readonly [unknown, string])[] = [
      [{ type: "number", guidance: "A count." }, "components[0].props.arg.type"],
      [eventArgProp({ default: "" }), "components[0].props.arg.default"],
      [eventArgProp({ bindable: false }), "components[0].props.arg.bindable"],
    ];
    for (const [schema, at] of rows) {
      const catalog = catalogWithScreen(senderSpec(schema));
      expect(catalogRejection(catalog)).toBe("nonconforming_event_arg");
      expect(catalogRejectionAt(catalog)).toBe(at);
    }
  });

  it("comes before `missing_screen_spec` — a member's own rejection is first", () => {
    const bad = senderSpec(eventArgProp({ bindable: true }));
    expect(catalogRejection(catalogOf(bad))).toBe("nonconforming_event_arg");
    // The control: with a conforming argument the same rootless catalog reaches
    // the Screen rule, so the row above rejects for the declaration it has.
    expect(catalogRejection(catalogOf(senderSpec()))).toBe("missing_screen_spec");
  });

  it("comes before `duplicate_tag` — the members are validated in order", () => {
    const bad = senderSpec(eventArgProp({ bindable: true }));
    expect(catalogRejection(catalogWithScreen(bad, spec("Card"), spec("Card")))).toBe(
      "nonconforming_event_arg",
    );
    expect(catalogRejection(catalogWithScreen(senderSpec(), spec("Card"), spec("Card")))).toBe(
      "duplicate_tag",
    );
  });

  it("applies to the `Screen` member too, ahead of the screen refinement", () => {
    const nonconforming = screenSpec({
      props: { name: screenNameProp(), arg: eventArgProp({ default: "home" }) },
      content: { mode: "none" },
    });
    const catalog = catalogOf(spec("Card"), nonconforming);
    expect(catalogRejection(catalog)).toBe("nonconforming_event_arg");
    expect(catalogRejectionAt(catalog)).toBe("components[1].props.arg.default");
    // The control: with a conforming argument the same Screen fails the
    // refinement, so the row above is not rejecting through the other code.
    const conforming = screenSpec({
      props: { name: screenNameProp(), arg: eventArgProp() },
      content: { mode: "none" },
    });
    expect(catalogRejection(catalogOf(spec("Card"), conforming))).toBe("nonconforming_screen_spec");
  });

  it("leaves the declaration to ordinary member validation first", () => {
    const overlong = eventArgProp({ guidance: "n".repeat(BOUNDS.propGuidanceChars + 1) });
    expect(catalogRejection(catalogWithScreen(senderSpec(overlong)))).toBe(
      "prop_guidance_too_long",
    );
    expect(catalogRejection(catalogWithScreen(senderSpec({ type: "string" })))).toBe(
      "invalid_prop_guidance",
    );
  });

  it("leaves a differently spelled prop ordinary — the match is exact", () => {
    const bound = { type: "object", guidance: "A bound record.", bindable: true };
    for (const name of ["Arg", "args", "argument"]) {
      expect(
        validateCatalog(catalogWithScreen(spec("Chart", { props: { [name]: bound } }))).ok,
      ).toBe(true);
    }
    // The contrast: the exact lowercase name under the same schema rejects.
    expect(catalogRejection(catalogWithScreen(spec("Chart", { props: { arg: bound } })))).toBe(
      "nonconforming_event_arg",
    );
  });

  it("is relayed by `validateModalConformance` too — it validates the member first", () => {
    const modal = conformingModal({
      props: {
        triggerLabel: { type: "string", required: true, guidance: "Label of the opening control." },
        title: { type: "string", required: true, guidance: "Title shown in the frame header." },
        arg: eventArgProp({ bindable: true }),
      },
    });
    expect(modalRejection(modal)).toBe("nonconforming_event_arg");
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const bound = catalogWithScreen(senderSpec(eventArgProp({ bindable: true })));
    expect(validateCatalog(bound)).toEqual(validateCatalog(bound));
  });
});

describe("validateCatalog — an invalid member spec rejects the whole catalog", () => {
  it("relays the spec rejection with an indexed location", () => {
    const broken = { ...spec("Card"), category: "surface" };
    expect(catalogRejection(catalogOf(spec("Text"), broken))).toBe("unknown_spec_key");
    expect(catalogRejectionAt(catalogOf(spec("Text"), broken))).toBe("components[1].category");
  });

  it("relays a rejection from inside a member's prop contract", () => {
    const broken = { ...spec("Card"), props: { label: { type: "string" } } };
    expect(catalogRejectionAt(catalogOf(broken))).toBe("components[0].props.label.guidance");
  });

  it("rejects a member that is not a spec at all", () => {
    expect(catalogRejection(catalogOf("Card"))).toBe("spec_not_an_object");
  });
});

describe("validateCatalog — a member may declare a bindable structured prop", () => {
  /** The shape WU-25 registers for `Table`: rows arrive only through a binding. */
  const tableRows = {
    type: "array",
    required: true,
    bindable: true,
    guidance: "The rows to render, bound from the data model.",
  };

  it("accepts a component whose prop is a required bindable array", () => {
    const catalog = acceptCatalog(catalogWithScreen(spec("Table", { props: { rows: tableRows } })));
    expect(catalog.components[0]?.props["rows"]).toEqual(tableRows);
  });

  it("accepts a component whose prop is a bindable object", () => {
    const summary = { type: "object", bindable: true, guidance: "The bound summary record." };
    expect(validateCatalog(catalogWithScreen(spec("Summary", { props: { summary } }))).ok).toBe(
      true,
    );
  });

  it("relays a structured-prop rejection with an indexed location", () => {
    const broken = spec("Table", { props: { rows: { type: "array", guidance: "The rows." } } });
    expect(catalogRejection(catalogOf(broken))).toBe("structured_prop_not_bindable");
    expect(catalogRejectionAt(catalogOf(broken))).toBe("components[0].props.rows.bindable");
  });
});

describe("validateCatalog — totality", () => {
  const nonCatalogs: readonly unknown[] = [
    undefined,
    null,
    0,
    "catalog",
    true,
    Symbol("catalog"),
    () => catalogOf(),
    new Date(0),
    [spec("Card")],
  ];

  it("returns a structured rejection rather than throwing on a non-catalog input", () => {
    for (const input of nonCatalogs) {
      expect(() => validateCatalog(input)).not.toThrow();
      expect(validateCatalog(input).ok).toBe(false);
    }
  });

  it("rejects a components field that is not an array", () => {
    expect(catalogRejection({ components: { Card: spec("Card") } })).toBe("invalid_components");
  });

  it("rejects an unknown top-level catalog key — the trust boundary is closed", () => {
    expect(catalogRejection({ components: [], version: 2 })).toBe("unknown_catalog_key");
  });

  it("survives a throwing getter", () => {
    const hostile = {
      get components(): unknown[] {
        throw new Error("boom");
      },
    };
    expect(() => validateCatalog(hostile)).not.toThrow();
    expect(validateCatalog(hostile).ok).toBe(false);
  });
});

describe("buildCatalogIndex", () => {
  it("looks a spec up by its tag", () => {
    const catalog = acceptCatalog(catalogWithScreen(spec("Card"), spec("Text")));
    const index = buildCatalogIndex(catalog);
    expect(index.get("Card")?.tag).toBe("Card");
    expect(index.get("Text")?.tag).toBe("Text");
    expect(index.size).toBe(3);
  });

  it("resolves the Screen root like any other registered tag", () => {
    const index = buildCatalogIndex(acceptCatalog(catalogWithScreen(spec("Card"))));
    expect(index.get("Screen")?.tag).toBe("Screen");
    expect(index.get("Screen")?.content.mode).toBe("children");
  });

  it("returns undefined for an unregistered tag rather than inventing one", () => {
    const index = buildCatalogIndex(acceptCatalog(catalogWithScreen(spec("Card"))));
    expect(index.get("Script")).toBeUndefined();
    expect(index.get("__proto__")).toBeUndefined();
    expect(index.get("constructor")).toBeUndefined();
  });

  it("indexes the minimal catalog to its one Screen", () => {
    expect(buildCatalogIndex(acceptCatalog(catalogOf(screenSpec()))).size).toBe(1);
  });
});

describe("validateModalConformance — Modal is the one dedicated overlap contract (DC-017)", () => {
  it("accepts a conforming custom Modal", () => {
    expect(validateModalConformance(conformingModal()).ok).toBe(true);
  });

  it("accepts a conforming Modal that adds its own content prop", () => {
    const extended = modalWithProps({
      ...(conformingModal()["props"] as Record<string, unknown>),
      description: { type: "string", guidance: "Supporting copy under the title." },
    });
    expect(validateModalConformance(extended).ok).toBe(true);
  });

  it("rejects an omitted Modal — a host that registers no Modal has no overlap contract", () => {
    expect(modalRejection(undefined)).toBe("modal_spec_omitted");
    expect(modalRejection(null)).toBe("modal_spec_omitted");
  });

  it("rejects a Modal schema that omits a prop the frame projection consumes", () => {
    const propsWithoutTitle = {
      triggerLabel: { type: "string", required: true, guidance: "Label of the control." },
    };
    expect(modalRejection(modalWithProps(propsWithoutTitle))).toBe("modal_prop_omitted");
  });

  it("rejects a Modal schema that omits the prop contract entirely", () => {
    expect(modalRejection(modalWithProps({}))).toBe("modal_prop_omitted");
  });

  it("rejects a Modal whose prop type contradicts the frame projection", () => {
    const contradicting = modalWithProps({
      triggerLabel: { type: "string", required: true, guidance: "Label of the control." },
      title: { type: "number", required: true, guidance: "Title shown in the header." },
    });
    expect(modalRejection(contradicting)).toBe("modal_prop_type_mismatch");
  });

  it("rejects a Modal that declares a frame-projected prop as a structured prop", () => {
    const contradicting = modalWithProps({
      triggerLabel: { type: "string", required: true, guidance: "Label of the control." },
      title: { type: "object", required: true, bindable: true, guidance: "The bound title." },
    });
    expect(modalRejection(contradicting)).toBe("modal_prop_type_mismatch");
  });

  it("rejects a Modal that makes a required frame prop optional", () => {
    const contradicting = modalWithProps({
      triggerLabel: { type: "string", required: true, guidance: "Label of the control." },
      title: { type: "string", guidance: "Title shown in the header." },
    });
    expect(modalRejection(contradicting)).toBe("modal_prop_optionality_mismatch");
  });

  it("rejects a Modal that substitutes its own default for a frame-projected prop", () => {
    const contradicting = modalWithProps({
      triggerLabel: { type: "string", guidance: "Label of the control.", default: "Open" },
      title: { type: "string", required: true, guidance: "Title shown in the header." },
    });
    expect(modalRejection(contradicting)).toBe("modal_prop_default_conflict");
  });

  it("rejects a Modal without named slots — the frame projects body and actions", () => {
    expect(modalRejection(conformingModal({ content: { mode: "none" } }))).toBe(
      "modal_must_use_slots",
    );
  });

  it("rejects a Modal declaring collect — the frame owns the overlap, not a value", () => {
    // The collect block is well-formed, address included, so the rejection is
    // the frame's rule rather than an earlier member-validation one.
    const collecting = {
      ...conformingModal(),
      props: {
        ...(conformingModal()["props"] as Record<string, unknown>),
        name: collectNameProp(),
        value: { type: "string", guidance: "The current value." },
      },
      collect: { collectable: true, valueProp: "value", valueKind: "string" },
    };
    expect(modalRejection(collecting)).toBe("modal_must_not_collect");
  });

  it("rejects a spec registered under another tag", () => {
    expect(modalRejection(conformingModal({ tag: "Dialog" }))).toBe("modal_tag_mismatch");
  });

  it("rejects a Modal that is not a valid component spec at all", () => {
    expect(modalRejection(conformingModal({ whenToUse: "" }))).toBe("invalid_when_to_use");
    expect(modalRejection(42)).toBe("spec_not_an_object");
  });

  it("is total on hostile input", () => {
    const hostile = new Proxy(conformingModal(), {
      ownKeys(): never {
        throw new Error("boom");
      },
    });
    expect(() => validateModalConformance(hostile)).not.toThrow();
    expect(validateModalConformance(hostile).ok).toBe(false);
  });

  it("is deterministic — the same input yields an equal result on repeat calls", () => {
    const contradicting = conformingModal({ content: { mode: "none" } });
    expect(validateModalConformance(contradicting)).toEqual(
      validateModalConformance(contradicting),
    );
  });
});

describe("validateCatalog — bounds read from BOUNDS (DC-026)", () => {
  /** Sized to the bound exactly, with the required Screen occupying one slot. */
  function catalogOfSize(count: number): Record<string, unknown> {
    return {
      components: Array.from({ length: count }, (_, index) =>
        index === 0 ? screenSpec() : spec(`c${index}`),
      ),
    };
  }

  it("B-09 — accepts exactly BOUNDS.componentsPerCatalog components", () => {
    const catalog = acceptCatalog(catalogOfSize(BOUNDS.componentsPerCatalog));
    expect(catalog.components).toHaveLength(BOUNDS.componentsPerCatalog);
    expect(buildCatalogIndex(catalog).size).toBe(BOUNDS.componentsPerCatalog);
  });

  it("B-09 — rejects one component past BOUNDS.componentsPerCatalog", () => {
    const oversized = catalogOfSize(BOUNDS.componentsPerCatalog + 1);
    expect(catalogRejection(oversized)).toBe("too_many_components");
    expect(catalogRejectionAt(oversized)).toBe("components");
  });
});

/**
 * The public result contracts, held the way a consumer holds them. As in
 * `component-spec.test.ts`, the annotations are the test: vitest erases
 * `import type`, so only the typecheck can see a missing export.
 */
describe("the catalog module's public result contracts", () => {
  it("lets a consumer declare the catalog result type and both of its branches", () => {
    const accepted: CatalogValidationResult = validateCatalog(catalogWithScreen(spec("Card")));
    expect(accepted.ok ? accepted.catalog.components.length : accepted.code).toBe(2);

    const rejection: CatalogValidationResult = {
      ok: false,
      code: "catalog_not_an_object",
      at: "",
      detail: "A catalog must be a plain object.",
    };
    expect(validateCatalog(null)).toEqual(rejection);
  });

  it("lets a consumer declare the Modal conformance result and both of its branches", () => {
    const accepted: ModalConformanceResult = validateModalConformance(conformingModal());
    expect(accepted).toEqual({ ok: true });

    const rejection: ModalConformanceResult = {
      ok: false,
      code: "modal_spec_omitted",
      at: "Modal",
      detail: "No Modal is registered, so none can conform.",
    };
    expect(validateModalConformance(undefined)).toEqual(rejection);
  });
});
