import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  validateCatalog,
  validateComponentSpec,
} from "@facet/core";
import type { ComponentSpec, DataModel, FacetCatalog, PropSchema } from "@facet/core";

import { BUTTON_SPEC, FIELD_SPEC, INTERACTIVE_SPECS } from "./specs-interactive.js";

/** The two interactive tags this module owns, in declaration order. */
const INTERACTIVE_TAGS: readonly string[] = ["Button", "Field"];

/**
 * The framework collection address, stated here as a literal rather than read
 * back from `FIELD_SPEC`.
 *
 * `CollectSpec` carries no address key, so the exact lowercase prop name `name`
 * is the convention a `Button`'s collect list resolves against — and the shape
 * it must take is fixed: a required scalar string with guidance, mentioning
 * neither a default, nor a domain, nor a binding. A test that derived any of
 * this from the spec it is checking would pass whatever the spec happened to
 * say, so every expectation below is written out independently and the spec is
 * measured against it.
 */
const ADDRESS = "name";

/** Exactly the keys an address declaration carries — no fourth key. */
const ADDRESS_KEYS: readonly string[] = ["type", "required", "guidance"];

/**
 * The three keywords an address never mentions. Each is checked as a **key**: a
 * `bindable: false` is still a statement about binding, and a conforming address
 * simply does not make one.
 */
const ADDRESS_FORBIDDEN_KEYS: readonly string[] = ["default", "enum", "bindable"];

/**
 * The framework collection request list, stated here as a literal rather than
 * read back from `BUTTON_SPEC`.
 *
 * The prop name is the reservation: a spec that declares `collect` is declaring
 * the list an author writes, so the shape it must take is fixed — a scalar
 * string with guidance, mentioning neither a default, nor a domain, nor a
 * binding. As with the address, a test that derived any of this from the spec it
 * is checking would pass whatever the spec happened to say, so every expectation
 * below is written out independently and `BUTTON_SPEC` is measured against it.
 */
const REQUEST = "collect";

/** The keys a request declaration must carry. */
const REQUEST_KEYS: readonly string[] = ["type", "guidance"];

/**
 * The one key a request list *may* carry beyond those, deliberately left
 * unconstrained by the framework.
 *
 * This is where the request list and the address differ. An address is always
 * required, because a collectable with no name is unaddressable. Whether a
 * control *must* name fields is a question about that control, so the rule
 * admits `required: true`, `required: false` and no `required` at all — and this
 * suite permits the key rather than pinning it, then proves below that both
 * values are accepted. `Button`'s own choice to omit it is a product decision
 * about `Button`, pinned separately in the action-domain group.
 */
const REQUEST_OPTIONAL_KEYS: readonly string[] = ["required"];

/**
 * The three keywords a request list never mentions. Each is checked as a
 * **key**, for the same reason as the address: a `bindable: false` is still a
 * statement about binding, and a conforming request list simply does not make
 * one.
 */
const REQUEST_FORBIDDEN_KEYS: readonly string[] = ["default", "enum", "bindable"];

/**
 * The framework event argument, stated here as a literal rather than read back
 * from `BUTTON_SPEC`.
 *
 * The prop name is the reservation (D-07): a spec that declares `arg` has
 * declared the one explicit value an `agent:` event carries, so the shape it
 * must take is fixed — a scalar string with guidance, authored literally, with
 * no default and no binding. As with the address and the request list, every
 * expectation below is written out independently and `BUTTON_SPEC` is measured
 * against it.
 */
const EVENT_ARG = "arg";

/** The keys an argument declaration must carry. */
const EVENT_ARG_KEYS: readonly string[] = ["type", "guidance"];

/**
 * The two keys an argument *may* carry beyond those, both deliberately left to
 * the component — and together the whole difference between this rule and the
 * request list's. Whether a control must send an argument is a question about
 * that control, and a closed domain of argument values is an authoring
 * constraint the component is entitled to declare: the author still writes one
 * literal value, and pinning the set it comes from is what a prop domain is for.
 * Both are permitted here and proved accepted below; `Button`'s own choice to
 * declare neither is a product decision about `Button`, pinned separately.
 */
const EVENT_ARG_OPTIONAL_KEYS: readonly string[] = ["required", "enum"];

/**
 * The two keywords an argument never mentions — a **shorter** list than the
 * request list's, and `enum` is the one it drops. Each is checked as a **key**,
 * for the same reason as the other two framework props: a `bindable: false` is
 * still a statement about binding, and a conforming argument makes none.
 */
const EVENT_ARG_FORBIDDEN_KEYS: readonly string[] = ["default", "bindable"];

/**
 * The smallest conforming `Screen` registration, declared here rather than
 * imported from the layout group.
 *
 * Every valid catalog carries exactly one `Screen` — the renderer mounts a
 * stored screen root like any other node — so a catalog assembled from
 * interactive specs alone is incomplete by construction. This stub supplies
 * that one member and nothing else, which keeps the assertions below about
 * Button and Field instead of about whatever the real `Screen` happens
 * to declare.
 */
const SCREEN_STUB: Record<string, unknown> = {
  tag: "Screen",
  whenToUse: "The screen root a catalog must register, standing in for the real one.",
  props: {
    name: { type: "string", guidance: "The screen's name.", required: true },
  },
  acceptsChildren: true,
};

/** The registered set an authored document actually reaches: the stub plus the two. */
const REGISTERED_SPECS: readonly unknown[] = [SCREEN_STUB, ...INTERACTIVE_SPECS];

const SOURCE = readFileSync(new URL("./specs-interactive.ts", import.meta.url), "utf8");

function specFor(tag: string): ComponentSpec {
  const found = INTERACTIVE_SPECS.find((candidate) => candidate.tag === tag);
  if (found === undefined) {
    throw new Error(`the interactive group declares no ${tag} spec`);
  }
  return found;
}

function propOf(tag: string, name: string): PropSchema {
  const schema = specFor(tag).props[name];
  if (schema === undefined) {
    throw new Error(`${tag} declares no ${name} prop`);
  }
  return schema;
}

/** The first rejection code, or `"accepted"` — so a passing case reads as one. */
function rejection(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.code;
}

/** The location the first rejection names, so a negative case pins where it failed. */
function rejectionAt(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.at;
}

/** The line the first rejection carries, so a negative case pins what it says. */
function rejectionDetail(value: unknown): string {
  const result = validateComponentSpec(value);
  return result.ok ? "accepted" : result.detail;
}

function withProps(spec: ComponentSpec, props: Record<string, unknown>): unknown {
  return { ...spec, props };
}

function withProp(spec: ComponentSpec, name: string, schema: unknown): unknown {
  return withProps(spec, { ...spec.props, [name]: schema });
}

function withoutProp(spec: ComponentSpec, name: string): unknown {
  const props: Record<string, unknown> = { ...spec.props };
  delete props[name];
  return withProps(spec, props);
}

function withCollect(spec: ComponentSpec, collect: unknown): unknown {
  return { ...spec, collect };
}

/**
 * One way an address can stop conforming, paired with the location the single
 * pinned code is expected to name.
 *
 * Each mutation is built from literals — the real guidance is carried across
 * only because guidance is not what any of these cases is about — and every one
 * of them is handed to `validateComponentSpec`, so a case that stopped being a
 * violation would surface as an acceptance rather than pass quietly.
 */
const ADDRESS_MUTATIONS: readonly {
  readonly label: string;
  readonly mutate: (spec: ComponentSpec, guidance: string) => unknown;
}[] = [
  { label: "no address at all", mutate: (spec) => withoutProp(spec, ADDRESS) },
  {
    label: "address that is not a string",
    mutate: (spec, guidance) =>
      withProp(spec, ADDRESS, { type: "boolean", required: true, guidance }),
  },
  {
    label: "address with a default",
    mutate: (spec, guidance) =>
      withProp(spec, ADDRESS, { type: "string", guidance, default: "region" }),
  },
  {
    label: "address with a domain",
    mutate: (spec, guidance) =>
      withProp(spec, ADDRESS, {
        type: "string",
        required: true,
        guidance,
        enum: ["region", "sector"],
      }),
  },
  {
    label: "address declared unbindable",
    mutate: (spec, guidance) =>
      withProp(spec, ADDRESS, { type: "string", required: true, guidance, bindable: false }),
  },
  {
    label: "address declared bindable",
    mutate: (spec, guidance) =>
      withProp(spec, ADDRESS, { type: "string", required: true, guidance, bindable: true }),
  },
  {
    label: "optional address",
    mutate: (spec, guidance) => withProp(spec, ADDRESS, { type: "string", guidance }),
  },
  {
    label: "address named as the value prop",
    mutate: (spec) =>
      withCollect(spec, { collectable: true, valueProp: ADDRESS, sensitiveProp: "secret" }),
  },
];

/**
 * One way a request-list declaration can stop conforming, paired with the
 * location the single pinned code is expected to name.
 *
 * Each mutation is built from literals and handed to `validateComponentSpec`, so
 * a case that stopped being a violation would surface as an acceptance rather
 * than pass quietly. Guidance is carried across because none of these cases is
 * about guidance; the case that *is* about it lives on its own below, because it
 * is answered by a different rule.
 */
const REQUEST_MUTATIONS: readonly {
  readonly label: string;
  readonly mutate: (spec: ComponentSpec, guidance: string) => unknown;
}[] = [
  {
    label: "request list that is not a string",
    mutate: (spec, guidance) => withProp(spec, REQUEST, { type: "number", guidance }),
  },
  {
    label: "request list with a default",
    mutate: (spec, guidance) =>
      withProp(spec, REQUEST, { type: "string", guidance, default: "region" }),
  },
  {
    label: "request list with a domain",
    mutate: (spec, guidance) =>
      withProp(spec, REQUEST, { type: "string", guidance, enum: ["region", "sector"] }),
  },
  {
    label: "request list declared unbindable",
    mutate: (spec, guidance) =>
      withProp(spec, REQUEST, { type: "string", guidance, bindable: false }),
  },
  {
    label: "request list declared bindable",
    mutate: (spec, guidance) =>
      withProp(spec, REQUEST, { type: "string", guidance, bindable: true }),
  },
];

/**
 * One way an event-argument declaration can stop conforming, paired with the
 * location the single pinned code is expected to name.
 *
 * Each mutation is built from literals and handed to `validateComponentSpec`, so
 * a case that stopped being a violation would surface as an acceptance rather
 * than pass quietly. Guidance is carried across because none of these cases is
 * about guidance; the case that *is* about it lives on its own below, because it
 * is answered by a different rule. There is no missing-argument row: unlike the
 * collection address, an absent `arg` is never a fault, which is proved as an
 * acceptance instead.
 */
const EVENT_ARG_MUTATIONS: readonly {
  readonly label: string;
  readonly mutate: (spec: ComponentSpec, guidance: string) => unknown;
}[] = [
  {
    label: "argument that is not a string",
    mutate: (spec, guidance) => withProp(spec, EVENT_ARG, { type: "number", guidance }),
  },
  {
    label: "argument declared a bindable array",
    mutate: (spec, guidance) =>
      withProp(spec, EVENT_ARG, { type: "array", guidance, bindable: true }),
  },
  {
    label: "argument with a default",
    mutate: (spec, guidance) =>
      withProp(spec, EVENT_ARG, { type: "string", guidance, default: "region" }),
  },
  {
    label: "argument declared unbindable",
    mutate: (spec, guidance) =>
      withProp(spec, EVENT_ARG, { type: "string", guidance, bindable: false }),
  },
  {
    label: "argument declared bindable",
    mutate: (spec, guidance) =>
      withProp(spec, EVENT_ARG, { type: "string", guidance, bindable: true }),
  },
];

function acceptCatalog(components: readonly unknown[]): FacetCatalog {
  const result = validateCatalog({ components });
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.catalog;
}

function catalogPropOf(tag: string, name: string): unknown {
  const spec = acceptCatalog(REGISTERED_SPECS).components.find(
    (candidate) => candidate.tag === tag,
  );
  return spec?.props[name];
}

/**
 * Hands one candidate `arg` declaration to `validateComponentSpec` on an
 * otherwise untouched `Button`, and reports what the **accepted** spec carries
 * under `key` — the literal `"absent"` when the accepted schema does not mention
 * it at all, or the rejection when the spec was refused.
 *
 * Reading the value back off the result is what makes a permission test mean
 * something: a validator that accepted the declaration and then silently dropped
 * the keyword would pass an acceptance-only check. `key` is deliberately not
 * defaulted, so the absence a caller is asking about is always one it named.
 */
function acceptedArgKey(schema: unknown, key: string): unknown {
  const result = validateComponentSpec(withProp(specFor("Button"), EVENT_ARG, schema));
  if (!result.ok) {
    return `${result.code} at ${result.at}`;
  }
  const accepted = result.spec.props[EVENT_ARG];
  if (accepted === undefined) {
    return "the accepted spec declares no argument";
  }
  const bag: Record<string, unknown> = { ...accepted };
  return key in bag ? bag[key] : "absent";
}

/** A domain of exactly `size` distinct members, for the B-11 pair. */
function domain(size: number): readonly string[] {
  return Array.from({ length: size }, (_, index) => `member-${index}`);
}

/** A prop contract of exactly `count` declared props, for the B-10 pair. */
function padded(count: number): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    props[`pad${index}`] = { type: "string", guidance: "Filler." };
  }
  return props;
}

/**
 * Validates one authored document against a catalog of exactly these three
 * specs plus the Screen every valid catalog registers, so the action, binding
 * and collect declarations are exercised the way an agent actually reaches
 * them.
 */
function authorOutcome(body: string, model: DataModel = {}): string {
  const source = `<Facet entry="home"><Screen name="home">${body}</Screen></Facet>`;
  const parsed = parseMarkup(source);
  if (!parsed.ok) {
    return parsed.error.code;
  }
  const result = validateAuthorMarkup(parsed.ast, acceptCatalog(REGISTERED_SPECS), model);
  return result.ok ? "accepted" : result.error.code;
}

describe("interactive specs — the two tags register", () => {
  it("declares exactly Button and Field", () => {
    expect(INTERACTIVE_SPECS.map((spec) => spec.tag)).toEqual(INTERACTIVE_TAGS);
  });

  it("groups the two named specs in registration order", () => {
    expect(INTERACTIVE_SPECS).toEqual([BUTTON_SPEC, FIELD_SPEC]);
  });

  it("accepts every spec on its own", () => {
    for (const spec of INTERACTIVE_SPECS) {
      expect([spec.tag, rejection(spec)]).toEqual([spec.tag, "accepted"]);
    }
  });

  it("registers both as ordinary members alongside the required Screen", () => {
    expect(acceptCatalog(REGISTERED_SPECS).components.map((spec) => spec.tag)).toEqual([
      "Screen",
      ...INTERACTIVE_TAGS,
    ]);
  });

  it("is not a complete catalog on its own: the required Screen is what it lacks", () => {
    const result = validateCatalog({ components: INTERACTIVE_SPECS });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "missing_screen_spec",
      "components",
    ]);
  });
});

describe("interactive specs — Field declares the collect contract (D-08)", () => {
  it("declares collectable, the value prop, and the sensitive prop", () => {
    expect(specFor("Field").collect).toEqual({
      collectable: true,
      valueProp: "value",
      sensitiveProp: "secret",
    });
  });

  it("keeps the collect block through catalog validation", () => {
    const field = acceptCatalog(REGISTERED_SPECS).components.find((spec) => spec.tag === "Field");
    expect(field?.collect).toEqual(specFor("Field").collect);
  });

  it("declares the named value prop as a string with a default, so an unregistered field has one", () => {
    const value = propOf("Field", "value");
    expect({ type: value.type, required: value.required }).toEqual({
      type: "string",
      required: undefined,
    });
    expect("default" in value ? value.default : undefined).toBe("");
  });

  it("keeps the collected value unbindable — a binding is read-only, collection is not", () => {
    expect(propOf("Field", "value").bindable).toBeUndefined();
  });

  it("declares the sensitive prop as a boolean that defaults to off", () => {
    const secret = propOf("Field", "secret");
    expect(secret.type).toBe("boolean");
    expect("default" in secret ? secret.default : undefined).toBe(false);
  });

  it("rejects the same spec once the sensitive prop is no longer a declared boolean", () => {
    const spec = specFor("Field");
    expect(rejection(withProp(spec, "secret", { type: "string", guidance: "Not a flag." }))).toBe(
      "invalid_sensitive_prop",
    );
    expect(rejectionAt(withoutProp(spec, "secret"))).toBe("collect.sensitiveProp");
  });

  it("rejects a collect block naming a prop the spec never declares", () => {
    const spec = specFor("Field");
    const collect = { collectable: true, valueProp: "absent", sensitiveProp: "secret" };
    expect(rejection(withCollect(spec, collect))).toBe("unknown_value_prop");
  });

  it("is the only collectable component in the group", () => {
    const collectable = INTERACTIVE_SPECS.filter((spec) => spec.collect !== undefined);
    expect(collectable.map((spec) => spec.tag)).toEqual(["Field"]);
  });
});

describe("interactive specs — Field declares the framework collection address (D-08)", () => {
  it("declares the address under the exact lowercase name the framework reserves", () => {
    expect(Object.keys(specFor("Field").props)).toContain(ADDRESS);
  });

  it("declares it with exactly the three keys an address carries and nothing else", () => {
    expect(Object.keys(propOf("Field", ADDRESS)).sort()).toEqual([...ADDRESS_KEYS].sort());
  });

  it("declares it a required scalar string", () => {
    const address = propOf("Field", ADDRESS);
    expect({ type: address.type, required: address.required }).toEqual({
      type: "string",
      required: true,
    });
  });

  it("gives it guidance the agent can read, inside B-13", () => {
    const { guidance } = propOf("Field", ADDRESS);
    expect(guidance.length > 0 && guidance.length <= BOUNDS.propGuidanceChars).toBe(true);
  });

  it("mentions none of default, enum or bindable — absent keys, not false values", () => {
    const address: Record<string, unknown> = { ...propOf("Field", ADDRESS) };
    expect(ADDRESS_FORBIDDEN_KEYS.filter((key) => key in address)).toEqual([]);
  });

  it("does not point the injected value at the address — Facet consumes and strips it", () => {
    expect(specFor("Field").collect?.valueProp).toBe("value");
    expect(specFor("Field").collect?.valueProp).not.toBe(ADDRESS);
  });

  it("satisfies the rule through validateComponentSpec, unmutated", () => {
    expect([rejection(specFor("Field")), rejectionAt(specFor("Field"))]).toEqual([
      "accepted",
      "accepted",
    ]);
  });

  it("is rejected under one pinned code whose location names the fault", () => {
    const spec = specFor("Field");
    const address = propOf("Field", ADDRESS);
    const { guidance } = address;
    const outcomes = ADDRESS_MUTATIONS.map(({ label, mutate }) => {
      const mutated = mutate(spec, guidance);
      return [label, rejection(mutated), rejectionAt(mutated)];
    });
    expect(outcomes).toEqual([
      ["no address at all", "nonconforming_collect_name", "props.name"],
      ["address that is not a string", "nonconforming_collect_name", "props.name.type"],
      ["address with a default", "nonconforming_collect_name", "props.name.default"],
      ["address with a domain", "nonconforming_collect_name", "props.name.enum"],
      ["address declared unbindable", "nonconforming_collect_name", "props.name.bindable"],
      ["address declared bindable", "nonconforming_collect_name", "props.name.bindable"],
      ["optional address", "nonconforming_collect_name", "props.name.required"],
      ["address named as the value prop", "nonconforming_collect_name", "collect.valueProp"],
    ]);
  });

  it("rejects a defaulted address that is still required under the general default rule first", () => {
    const defaulted = withProp(specFor("Field"), ADDRESS, {
      ...propOf("Field", ADDRESS),
      default: "region",
    });
    expect([rejection(defaulted), rejectionAt(defaulted)]).toEqual([
      "required_prop_with_default",
      "props.name",
    ]);
  });

  it("rejects an address named as the sensitive prop through the existing boolean rule", () => {
    const sensitive = withCollect(specFor("Field"), {
      collectable: true,
      valueProp: "value",
      sensitiveProp: ADDRESS,
    });
    expect([rejection(sensitive), rejectionAt(sensitive)]).toEqual([
      "invalid_sensitive_prop",
      "collect.sensitiveProp",
    ]);
  });

  it("keeps the address intact through catalog validation", () => {
    expect(catalogPropOf("Field", ADDRESS)).toEqual(propOf("Field", ADDRESS));
  });

  it("relays a nonconforming address from the catalog with the member index prefixed", () => {
    const broken = withoutProp(specFor("Field"), ADDRESS);
    const result = validateCatalog({ components: [SCREEN_STUB, BUTTON_SPEC, broken] });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "nonconforming_collect_name",
      "components[2].props.name",
    ]);
  });

  it("reports the member's own fault ahead of the catalog's missing Screen", () => {
    const broken = withoutProp(specFor("Field"), ADDRESS);
    const result = validateCatalog({ components: [broken] });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "nonconforming_collect_name",
      "components[0].props.name",
    ]);
  });
});

describe("interactive specs — Button's action prop domain", () => {
  it("declares action a required string, because only a string prop may carry an action", () => {
    const action = propOf("Button", "action");
    expect({ type: action.type, required: action.required }).toEqual({
      type: "string",
      required: true,
    });
  });

  it("declares no enum on action — the domain is the scheme vocabulary, not a value list", () => {
    expect("enum" in propOf("Button", "action")).toBe(false);
  });

  it("keeps action unbindable — what a control does is authored, never published data", () => {
    expect(propOf("Button", "action").bindable).toBeUndefined();
  });

  it("admits nav: and agent: and nothing else", () => {
    expect(authorOutcome(`<Button label="Go" action="nav:home" />`)).toBe("accepted");
    expect(authorOutcome(`<Button label="Refresh" action="agent:refresh" />`)).toBe("accepted");
    expect(authorOutcome(`<Button label="Toggle" action="local:toggle" />`)).toBe("unknown-scheme"); // component-hard-cut: allowed-negative
  });

  it("rejects a nav: target no screen in the same document declares", () => {
    expect(authorOutcome(`<Button label="Go" action="nav:details" />`)).toBe("unknown-screen");
  });

  it("rejects a Button that declares no action at all", () => {
    expect(authorOutcome(`<Button label="Go" />`)).toBe("missing-required-prop");
  });

  it("declares an optional collect prop naming the fields a visitor event carries", () => {
    const collect = propOf("Button", "collect");
    expect({ type: collect.type, required: collect.required }).toEqual({
      type: "string",
      required: undefined,
    });
    expect(
      authorOutcome(
        `<Field name="region" label="Region" /><Button label="Refresh" action="agent:refresh" collect="region" />`,
      ),
    ).toBe("accepted");
  });

  it("carries no collect block of its own — a control sends values, it never holds one", () => {
    expect(specFor("Button").collect).toBeUndefined();
  });
});

describe("interactive specs — Button declares the framework collection request list (D-08)", () => {
  it("declares the request list under the exact lowercase name the framework reserves", () => {
    expect(Object.keys(specFor("Button").props)).toContain(REQUEST);
  });

  it("carries every key a request list must, and nothing beyond the one it may", () => {
    const keys = Object.keys(propOf("Button", REQUEST));
    expect(REQUEST_KEYS.filter((key) => !keys.includes(key))).toEqual([]);
    expect(
      keys.filter((key) => !REQUEST_KEYS.includes(key) && !REQUEST_OPTIONAL_KEYS.includes(key)),
    ).toEqual([]);
  });

  it("declares it a scalar string", () => {
    expect(propOf("Button", REQUEST).type).toBe("string");
  });

  it("gives it guidance the agent can read, inside B-13", () => {
    const { guidance } = propOf("Button", REQUEST);
    expect(guidance.length > 0 && guidance.length <= BOUNDS.propGuidanceChars).toBe(true);
  });

  it("mentions none of default, enum or bindable — absent keys, not false values", () => {
    const request: Record<string, unknown> = { ...propOf("Button", REQUEST) };
    expect(REQUEST_FORBIDDEN_KEYS.filter((key) => key in request)).toEqual([]);
  });

  it("satisfies the rule through validateComponentSpec, unmutated", () => {
    expect([rejection(specFor("Button")), rejectionAt(specFor("Button"))]).toEqual([
      "accepted",
      "accepted",
    ]);
  });

  it("leaves required to the component — the rule pins neither value", () => {
    // Acceptance alone would prove nothing if the flag never reached the
    // validator, so each variant is read back off the accepted spec: the
    // normalized prop must carry the very value that was declared.
    const spec = specFor("Button");
    const { guidance } = propOf("Button", REQUEST);
    const accepted = [true, false].map((required) => {
      const result = validateComponentSpec(
        withProp(spec, REQUEST, { type: "string", guidance, required }),
      );
      return [required, result.ok ? result.spec.props[REQUEST]?.required : result.code];
    });
    expect(accepted).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it("is rejected under one pinned code whose location names the fault", () => {
    const spec = specFor("Button");
    const { guidance } = propOf("Button", REQUEST);
    const outcomes = REQUEST_MUTATIONS.map(({ label, mutate }) => {
      const mutated = mutate(spec, guidance);
      return [label, rejection(mutated), rejectionAt(mutated)];
    });
    expect(outcomes).toEqual([
      ["request list that is not a string", "nonconforming_collect_request", "props.collect.type"],
      ["request list with a default", "nonconforming_collect_request", "props.collect.default"],
      ["request list with a domain", "nonconforming_collect_request", "props.collect.enum"],
      [
        "request list declared unbindable",
        "nonconforming_collect_request",
        "props.collect.bindable",
      ],
      ["request list declared bindable", "nonconforming_collect_request", "props.collect.bindable"],
    ]);
  });

  it("leaves guidance to the ordinary prop rule, which answers it first", () => {
    const stripped = withProp(specFor("Button"), REQUEST, { type: "string" });
    expect([rejection(stripped), rejectionAt(stripped)]).toEqual([
      "invalid_prop_guidance",
      "props.collect.guidance",
    ]);
  });

  it("keeps the request list intact through catalog validation", () => {
    expect(catalogPropOf("Button", REQUEST)).toEqual(propOf("Button", REQUEST));
  });

  it("relays a nonconforming request list from the catalog with the member index prefixed", () => {
    const { guidance } = propOf("Button", REQUEST);
    const broken = withProp(specFor("Button"), REQUEST, {
      type: "string",
      guidance,
      bindable: true,
    });
    const result = validateCatalog({ components: [SCREEN_STUB, broken, FIELD_SPEC] });
    expect(result.ok ? ["accepted", ""] : [result.code, result.at]).toEqual([
      "nonconforming_collect_request",
      "components[1].props.collect.bindable",
    ]);
  });

  it("is the only spec in the group that declares a request list", () => {
    const declaring = INTERACTIVE_SPECS.filter((spec) => REQUEST in spec.props);
    expect(declaring.map((spec) => spec.tag)).toEqual(["Button"]);
  });

  it("governs a collectable spec too — the request rule is not gated on collectability", () => {
    // The two framework props are independent rules, and this group's own specs
    // are the evidence: the one spec that declares a request list collects
    // nothing, and the one collectable spec declares no request list. Gating the
    // request rule on collectability would leave `Button` — the only shipped
    // component that actually writes a list — unguarded, so the rule reaches a
    // collectable and a non-collectable alike.
    const { guidance } = propOf("Button", REQUEST);
    const bound = { type: "string", guidance, bindable: true };
    expect(specFor("Button").collect).toBeUndefined();
    expect(REQUEST in specFor("Field").props).toBe(false);
    expect(rejection(withProp(specFor("Field"), REQUEST, bound))).toBe(
      "nonconforming_collect_request",
    );
    expect(rejection(withProp(specFor("Button"), REQUEST, bound))).toBe(
      "nonconforming_collect_request",
    );
  });

  it("is unaffected by the address rule, which reaches collectables only", () => {
    // `Button` declares no address at all and is accepted, because it is not
    // collectable; `Field` is, and its address is checked. Neither rule stands
    // in for the other.
    expect(ADDRESS in specFor("Button").props).toBe(false);
    expect(rejection(specFor("Button"))).toBe("accepted");
    expect(rejection(withoutProp(specFor("Field"), ADDRESS))).toBe("nonconforming_collect_name");
  });
});

describe("interactive specs — Button declares the framework event argument (D-07)", () => {
  it("declares the argument under the exact lowercase name the framework reserves", () => {
    expect(Object.keys(specFor("Button").props)).toContain(EVENT_ARG);
  });

  it("carries every key an argument must, and nothing beyond the two it may", () => {
    const keys = Object.keys(propOf("Button", EVENT_ARG));
    expect(EVENT_ARG_KEYS.filter((key) => !keys.includes(key))).toEqual([]);
    expect(
      keys.filter((key) => !EVENT_ARG_KEYS.includes(key) && !EVENT_ARG_OPTIONAL_KEYS.includes(key)),
    ).toEqual([]);
  });

  it("declares it a scalar string", () => {
    expect(propOf("Button", EVENT_ARG).type).toBe("string");
  });

  it("gives it guidance the agent can read, inside B-13", () => {
    const { guidance } = propOf("Button", EVENT_ARG);
    expect(guidance.length > 0 && guidance.length <= BOUNDS.propGuidanceChars).toBe(true);
  });

  it("mentions neither default nor bindable — absent keys, not false values", () => {
    const arg: Record<string, unknown> = { ...propOf("Button", EVENT_ARG) };
    expect(EVENT_ARG_FORBIDDEN_KEYS.filter((key) => key in arg)).toEqual([]);
  });

  it("satisfies the rule through validateComponentSpec, and the accepted spec still carries it", () => {
    const result = validateComponentSpec(specFor("Button"));
    expect(
      result.ok ? Object.keys(result.spec.props[EVENT_ARG] ?? {}).sort() : result.code,
    ).toEqual([...EVENT_ARG_KEYS].sort());
  });

  it("declares neither required nor enum on its own argument — Button's choice, not the rule's", () => {
    // A claim about `Button`, separate from the rule below, which permits both.
    // Absence is read as a missing key, so a declared `required: undefined`
    // would fail here rather than read as an omission.
    const arg: Record<string, unknown> = { ...propOf("Button", EVENT_ARG) };
    expect(["required" in arg, "enum" in arg]).toEqual([false, false]);
  });

  it("leaves required to the component — the rule pins neither value, nor its absence", () => {
    // Acceptance alone would prove nothing if the flag never reached the
    // validator, so each variant is read back off the accepted spec.
    const { guidance } = propOf("Button", EVENT_ARG);
    expect([
      acceptedArgKey({ type: "string", guidance, required: true }, "required"),
      acceptedArgKey({ type: "string", guidance, required: false }, "required"),
      acceptedArgKey({ type: "string", guidance }, "required"),
    ]).toEqual([true, false, "absent"]);
  });

  it("admits a closed enum domain, read back off the accepted spec rather than merely accepted", () => {
    const { guidance } = propOf("Button", EVENT_ARG);
    expect(
      acceptedArgKey({ type: "string", guidance, enum: ["region", "sector"] }, "enum"),
    ).toEqual(["region", "sector"]);
  });

  it("differs from the request list in exactly one keyword, and a domain is it", () => {
    // The same declaration under each reserved name: a domain is a legitimate
    // authoring constraint on an argument and a violation on a request list, so
    // the difference is a real one rather than a restatement of one rule.
    const { guidance } = propOf("Button", EVENT_ARG);
    const withDomain = { type: "string", guidance, enum: ["region", "sector"] };
    const spec = specFor("Button");
    expect([
      rejection(withProp(spec, EVENT_ARG, withDomain)),
      rejection(withProp(spec, REQUEST, withDomain)),
    ]).toEqual(["accepted", "nonconforming_collect_request"]);
    expect(REQUEST_FORBIDDEN_KEYS.filter((key) => !EVENT_ARG_FORBIDDEN_KEYS.includes(key))).toEqual(
      ["enum"],
    );
  });

  it("is never obligatory — an absent argument is no fault, so no bare props.arg location exists", () => {
    // Unlike the collection address, whose absence on a collectable *is* the
    // fault, the reservation only says what `arg` means once declared. Both
    // directions: `Button` with it removed, and the spec that never declares it,
    // are both accepted.
    const stripped = withoutProp(specFor("Button"), EVENT_ARG);
    expect([rejection(stripped), rejectionAt(stripped)]).toEqual(["accepted", "accepted"]);
    expect(
      ["Field"].map((tag) => [tag, EVENT_ARG in specFor(tag).props, rejection(specFor(tag))]),
    ).toEqual([["Field", false, "accepted"]]);
  });

  it("is rejected under one pinned code whose location names the fault", () => {
    const spec = specFor("Button");
    const { guidance } = propOf("Button", EVENT_ARG);
    const outcomes = EVENT_ARG_MUTATIONS.map(({ label, mutate }) => {
      const mutated = mutate(spec, guidance);
      return [label, rejection(mutated), rejectionAt(mutated)];
    });
    expect(outcomes).toEqual([
      ["argument that is not a string", "nonconforming_event_arg", "props.arg.type"],
      ["argument declared a bindable array", "nonconforming_event_arg", "props.arg.type"],
      ["argument with a default", "nonconforming_event_arg", "props.arg.default"],
      ["argument declared unbindable", "nonconforming_event_arg", "props.arg.bindable"],
      ["argument declared bindable", "nonconforming_event_arg", "props.arg.bindable"],
    ]);
  });

  it("says why, in the two lines the rule carries", () => {
    const spec = specFor("Button");
    const { guidance } = propOf("Button", EVENT_ARG);
    expect([
      rejectionDetail(withProp(spec, EVENT_ARG, { type: "number", guidance })),
      rejectionDetail(withProp(spec, EVENT_ARG, { type: "string", guidance, default: "region" })),
      rejectionDetail(withProp(spec, EVENT_ARG, { type: "string", guidance, bindable: true })),
    ]).toEqual([
      "An event argument is a scalar string.",
      "An argument is authored literally, so it carries no default and no binding.",
      "An argument is authored literally, so it carries no default and no binding.",
    ]);
  });

  it("leaves guidance to the ordinary prop rule, which answers it first", () => {
    const stripped = withProp(specFor("Button"), EVENT_ARG, { type: "string" });
    expect([rejection(stripped), rejectionAt(stripped)]).toEqual([
      "invalid_prop_guidance",
      "props.arg.guidance",
    ]);
  });

  it("keeps the argument intact through catalog validation", () => {
    expect(catalogPropOf("Button", EVENT_ARG)).toEqual(propOf("Button", EVENT_ARG));
  });

  it("relays a nonconforming argument from the catalog with the member index prefixed", () => {
    const { guidance } = propOf("Button", EVENT_ARG);
    const relayed = [
      { type: "number", guidance },
      { type: "string", guidance, default: "region" },
      { type: "string", guidance, bindable: true },
    ].map((schema) => {
      const broken = withProp(specFor("Button"), EVENT_ARG, schema);
      const result = validateCatalog({ components: [SCREEN_STUB, broken, FIELD_SPEC] });
      return result.ok ? ["accepted", ""] : [result.code, result.at];
    });
    expect(relayed).toEqual([
      ["nonconforming_event_arg", "components[1].props.arg.type"],
      ["nonconforming_event_arg", "components[1].props.arg.default"],
      ["nonconforming_event_arg", "components[1].props.arg.bindable"],
    ]);
  });

  it("is the only spec in the group that declares an argument", () => {
    const declaring = INTERACTIVE_SPECS.filter((spec) => EVENT_ARG in spec.props);
    expect(declaring.map((spec) => spec.tag)).toEqual(["Button"]);
  });

  it("reserves the exact lowercase name — a near miss registers as an ordinary prop", () => {
    // Each near miss carries a declaration that would be two violations at once
    // under the reserved name — the wrong type and a default — so an acceptance
    // proves the rule did not reach the name rather than that the shape was
    // innocent. The same declaration under `arg` is the control, and every case
    // is built on a `Button` whose own argument has been removed first, so what
    // is measured is the name and not whatever `BUTTON_SPEC` declares.
    const spec = specFor("Button");
    const ordinary = {
      type: "number",
      guidance: "An ordinary prop that is not the reservation.",
      default: 3,
    };
    const others: Record<string, unknown> = { ...spec.props };
    delete others[EVENT_ARG];
    const under = (name: string): unknown => withProps(spec, { ...others, [name]: ordinary });
    expect(["Arg", "args", "argument"].map((name) => [name, rejection(under(name))])).toEqual([
      ["Arg", "accepted"],
      ["args", "accepted"],
      ["argument", "accepted"],
    ]);
    expect([rejection(under(EVENT_ARG)), rejectionAt(under(EVENT_ARG))]).toEqual([
      "nonconforming_event_arg",
      "props.arg.type",
    ]);
  });

  it("is authorable on an agent: event, so the declaration is reachable from markup", () => {
    expect(authorOutcome(`<Button label="Pick" action="agent:pick" arg="north" />`)).toBe(
      "accepted",
    );
  });
});

describe("interactive specs — bounded metadata", () => {
  it("keeps every when-to-use line inside B-12 and every guidance line inside B-13", () => {
    for (const spec of INTERACTIVE_SPECS) {
      expect([spec.tag, spec.whenToUse.length <= BOUNDS.componentWhenToUseChars]).toEqual([
        spec.tag,
        true,
      ]);
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        expect([located, schema.guidance.length <= BOUNDS.propGuidanceChars]).toEqual([
          located,
          true,
        ]);
      }
    }
  });

  it("keeps every prop count inside B-10 and every domain inside B-11", () => {
    for (const spec of INTERACTIVE_SPECS) {
      const names = Object.keys(spec.props);
      expect([spec.tag, names.length <= BOUNDS.propsPerComponentSpec]).toEqual([spec.tag, true]);
      for (const [name, schema] of Object.entries(spec.props)) {
        const located = `${spec.tag}.${name}`;
        const size = "enum" in schema && schema.enum !== undefined ? schema.enum.length : 0;
        expect([located, size <= BOUNDS.enumValuesPerProp]).toEqual([located, true]);
      }
    }
  });

  it("accepts a domain of exactly B-11 members and rejects one more", () => {
    const spec = specFor("Button");
    const at = (size: number): unknown =>
      withProp(spec, "tone", { type: "string", guidance: "A domain.", enum: domain(size) });
    expect(rejection(at(BOUNDS.enumValuesPerProp))).toBe("accepted");
    expect(rejection(at(BOUNDS.enumValuesPerProp + 1))).toBe("too_many_enum_values");
  });

  it("accepts exactly B-10 declared props and rejects one more", () => {
    const spec = specFor("Button");
    expect(rejection(withProps(spec, padded(BOUNDS.propsPerComponentSpec)))).toBe("accepted");
    expect(rejection(withProps(spec, padded(BOUNDS.propsPerComponentSpec + 1)))).toBe(
      "too_many_props",
    );
  });
});

describe("interactive specs — the module stays a private, core-only leaf", () => {
  it("imports nothing but @facet/core", () => {
    const specifiers = [...SOURCE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(new Set(specifiers)).toEqual(new Set(["@facet/core"]));
  });

  it("carries no NUL byte", () => {
    expect(SOURCE.includes(String.fromCharCode(0))).toBe(false);
  });
});
