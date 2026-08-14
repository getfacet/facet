/**
 * The component spec form.
 *
 * A `ComponentSpec` is the serializable description of one trusted component:
 * its tag, one line saying when to use it, a closed prop contract with per-prop
 * guidance, whether it takes children, and — only for a component Facet
 * collects a value from — a `collect` block. It is plain JSON data, because the
 * same spec has to travel to the agent as discovery text, to the renderer as a
 * validation table, and to disk as part of a session.
 *
 * `PropSchema` is deliberately a **closed subset** of JSON Schema rather than
 * JSON Schema itself. The author grammar admits quoted scalars and explicit
 * `data:`/`nav:`/`agent:` references and nothing else, so an authored value is
 * always a string, a number or a boolean. Admitting `$ref` or the composition
 * keywords would let a spec promise something the grammar cannot express and
 * the validator cannot check, so every keyword outside the subset is rejected
 * by name — an unknown key is a rejection, never an ignored extra.
 *
 * A component that consumes structured data — a table's rows, a chart's
 * series — declares an `array` or `object` prop instead. That branch is
 * **shallow, closed and binding-only**: the type, the guidance, an optional
 * `required`, and a literal `bindable: true`. Nothing else. There is no
 * `items`, no `properties`, no default and no domain, because the value never
 * comes from the markup — it arrives from the bounded data model through a
 * `data:path` binding, where its size and shape are already governed. Shape
 * keywords here would describe a value this file never sees. Inline array and
 * object markup stays forbidden by the grammar itself, not by this file.
 *
 * A component Facet collects from also has to be **addressable**. A `Button`
 * names the fields it sends by their authored name, so that name is part of the
 * declared contract rather than a convention a host may or may not honour. The
 * address is the exact lowercase `name` prop — `CollectSpec` stays closed and
 * gains no `nameProp`, because a per-registration address prop would let two
 * catalogs disagree about how an author writes a collect list. Declaring it is
 * therefore an obligation of every collectable spec, and it is a required scalar
 * string the author writes literally — and the one prop `valueProp` may not
 * name, since the framework consumes the address rather than handing it to the
 * component as a value.
 *
 * The list of addresses is reserved by the same convention. The exact lowercase
 * `collect` prop is where a `Button` writes the field names its event carries,
 * so a spec that declares it has declared Facet's request list and nothing else:
 * a scalar string, authored literally, with no default, no domain and no
 * binding. This rule is **not** gated on the block — the two are independent,
 * and gating it would leave the one component that actually writes a list, a
 * non-collectable `Button`, unguarded. Nothing obliges a spec to declare it; the
 * reservation only says what it means once declared.
 *
 * The two collection rules answer different questions and stay separately
 * machine-readable. `nonconforming_collect_request` reads the **declaration** of
 * the request list, `nonconforming_collect_name` reads the **address** a request
 * resolves to. The request list is part of the prop contract, so it is answered
 * with the props — before the collect block is read at all.
 *
 * The exact lowercase `arg` is reserved by the same convention and for the same
 * reason: an `agent:` event carries one explicit argument, so the renderer that
 * forwards it is reading a framework convention rather than inferring meaning
 * from a component-specific prop. It is a scalar string authored literally, with
 * no default and no binding — but, unlike the request list, `required` and a
 * closed `enum` domain stay the spec's own business. That difference is the
 * whole point of its own forbidden-key set, and its rejections carry their own
 * code, `nonconforming_event_arg`.
 *
 * There is deliberately **no `category` field**. Grouping is presentation, it
 * drifts from whatever the agent actually needs, and a closed form is easier to
 * trust than an extensible one.
 *
 * `validateComponentSpec` is **total**: it never throws, for any input of any
 * type, including a host object with a throwing getter. It returns the first
 * failure in a fixed order, so the same input always yields the same rejection.
 */

import { BOUNDS } from "./bounds.js";
import { validateComponentAuthoring, type ComponentAuthoring } from "./component-authoring.js";
import { isFacetIdentifier } from "./identifiers.js";
import { facetThemeToKebabCase, type FacetThemeTokenValueKind } from "./theme-contract.js";

/** The three scalar types an authored prop value can take. */
type PropType = "string" | "number" | "boolean";

/** The two structured types, which a prop can only ever receive by binding. */
export type StructuredPropType = "array" | "object";

/** Every type a prop schema may declare. */
type PropDeclarationType = PropType | StructuredPropType;

/**
 * One prop's contract: its type, the guidance the agent reads, whether it is
 * required, whether it accepts a `data:path` binding, its domain, and its
 * default. A required prop never carries a default — a default is what makes a
 * prop optional, so declaring both is a contradiction, not a preference. The
 * two structured branches carry none of the domain or default keywords at all.
 */
export type PropSchema =
  | {
      readonly type: "string";
      readonly guidance: string;
      readonly required?: boolean;
      readonly bindable?: boolean;
      readonly enum?: readonly string[];
      readonly default?: string;
    }
  | {
      readonly type: "number";
      readonly guidance: string;
      readonly required?: boolean;
      readonly bindable?: boolean;
      readonly enum?: readonly number[];
      readonly minimum?: number;
      readonly maximum?: number;
      readonly default?: number;
    }
  | {
      readonly type: "boolean";
      readonly guidance: string;
      readonly required?: boolean;
      readonly bindable?: boolean;
      readonly default?: boolean;
    }
  | {
      readonly type: StructuredPropType;
      readonly guidance: string;
      readonly required?: boolean;
      readonly bindable: true;
    };

/**
 * Declares that Facet — not the component — owns this component's collected
 * value. `valueProp` names the declared prop the framework injects; a truthy
 * `sensitiveProp` excludes the value from any collected payload.
 *
 * The block is **closed**: it carries no address key. The address a collect list
 * writes is the framework's own `name` prop, declared in `props` like any other
 * part of the contract.
 */
export interface CollectSpec {
  readonly collectable: true;
  readonly valueProp: string;
  readonly sensitiveProp?: string;
}

/** Component-owned recipe tokens the active theme must fill when this spec is active. */
export interface ThemeRecipeSpec {
  readonly tokens: Readonly<Record<string, FacetThemeTokenValueKind>>;
}

/** The serializable description of one component in the active catalog. */
export interface ComponentSpec {
  readonly tag: string;
  /** One line, at most B-12 characters: when an agent should reach for this. */
  readonly whenToUse: string;
  /** Closed role-specific semantics for agent discovery and component selection. */
  readonly authoring: ComponentAuthoring;
  readonly props: Readonly<Record<string, PropSchema>>;
  readonly acceptsChildren: boolean;
  readonly collect?: CollectSpec;
  readonly themeRecipe?: ThemeRecipeSpec;
}

/**
 * What `validateComponentSpec` answers: the accepted spec, or the first failure
 * — its code, the location it names, and one line of detail.
 *
 * Both branches are spelled out here rather than assembled from named halves,
 * because this alias is the whole public contract: a consumer that stores a
 * result, or writes a fixture rejection, has to be able to name its type, and a
 * signature naming a type the consumer cannot import is not a contract.
 */
export type ComponentSpecValidationResult =
  | { readonly ok: true; readonly spec: ComponentSpec }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch on its own, for the helpers below that can only fail.
 * It is **derived from** the public result rather than being its source, so the
 * two cannot drift and the private name never reaches an emitted signature.
 */
type SpecRejection = Extract<ComponentSpecValidationResult, { readonly ok: false }>;

const SPEC_KEYS: readonly string[] = [
  "tag",
  "whenToUse",
  "authoring",
  "props",
  "acceptsChildren",
  "collect",
  "themeRecipe",
];

const COLLECT_KEYS: readonly string[] = ["collectable", "valueProp", "sensitiveProp"];
const THEME_RECIPE_KEYS: readonly string[] = ["tokens"];
const TOKEN_VALUE_KINDS: readonly FacetThemeTokenValueKind[] = [
  "color",
  "length",
  "number",
  "opacity",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "duration",
  "easing",
  "shadow",
  "effect",
  "text",
];

/** The exact prop name a collect list addresses a collectable component by. */
const COLLECT_NAME_PROP = "name";

/** The exact prop name that carries a collect list an author writes. */
const COLLECT_REQUEST_PROP = "collect";

/** The exact prop name that carries the one explicit argument an event sends. */
const EVENT_ARG_PROP = "arg";

/**
 * The keywords neither framework prop may carry. Each is checked as a **key**: a
 * `bindable: false` is as much a declaration about binding as a `bindable: true`,
 * and the conforming schema simply does not mention any of the three. An address
 * or a request list that could be defaulted, drawn from a domain or bound would
 * not resolve to authored field names at the moment the collection is assembled.
 */
const FRAMEWORK_PROP_FORBIDDEN_KEYS: readonly string[] = ["default", "enum", "bindable"];

/**
 * The keywords the event argument may not carry — a **shorter** set, not the one
 * above. `enum` is deliberately absent: a closed set of argument values is an
 * authoring constraint the component declares, and the framework reads whichever
 * value the author wrote from within it either way. `default` and `bindable`
 * stay forbidden for the same reason they are on the collection props — an
 * argument the author did not write, or one resolved from the data model, is not
 * the explicit argument the payload carries.
 */
const EVENT_ARG_FORBIDDEN_KEYS: readonly string[] = ["default", "bindable"];

const COMMON_PROP_KEYS: readonly string[] = ["type", "guidance", "required", "bindable", "default"];

/** A structured prop declares no default and no domain, so it drops both. */
const STRUCTURED_PROP_KEYS: readonly string[] = ["type", "guidance", "required", "bindable"];

/** The closed keyword set per declared type — everything else is an unknown key. */
const PROP_KEYS: Readonly<Record<PropDeclarationType, readonly string[]>> = {
  string: [...COMMON_PROP_KEYS, "enum"],
  number: [...COMMON_PROP_KEYS, "enum", "minimum", "maximum"],
  boolean: COMMON_PROP_KEYS,
  array: STRUCTURED_PROP_KEYS,
  object: STRUCTURED_PROP_KEYS,
};

function reject(code: string, at: string, detail: string): SpecRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A spec is serializable, so a non-finite number is never a legal value. */
function matchesScalarType(value: unknown, type: PropType): boolean {
  return type === "number" ? isFiniteNumber(value) : typeof value === type;
}

/** Keys are sorted so the first unknown key is the same one on every run. */
function firstUnknownKey(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(record)
    .sort()
    .find((key) => !allowed.includes(key));
}

/**
 * Validates one component spec.
 *
 * Returns the accepted spec frozen and normalized to exactly the keys that were
 * present, so a host cannot widen a prop contract or an enum domain after the
 * trust boundary has accepted it.
 */
export function validateComponentSpec(value: unknown): ComponentSpecValidationResult {
  try {
    return validateSpec(value);
  } catch {
    return reject("spec_read_failed", "", "Reading the spec threw; a spec must be plain data.");
  }
}

function validateSpec(value: unknown): ComponentSpecValidationResult {
  if (!isRecord(value)) {
    return reject("spec_not_an_object", "", "A component spec must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, SPEC_KEYS);
  if (unknownKey !== undefined) {
    return reject("unknown_spec_key", unknownKey, "The component spec form is closed.");
  }

  const tag = value["tag"];
  if (!isFacetIdentifier(tag)) {
    return reject("invalid_tag", "tag", "A tag must be a Facet identifier of at most B-06 chars.");
  }

  const whenToUse = value["whenToUse"];
  if (typeof whenToUse !== "string" || whenToUse.length === 0) {
    return reject("invalid_when_to_use", "whenToUse", "A spec must say when to use the component.");
  }
  if (whenToUse.length > BOUNDS.componentWhenToUseChars) {
    return reject("when_to_use_too_long", "whenToUse", "When-to-use text exceeds B-12.");
  }

  const authoring = validateComponentAuthoring(value["authoring"]);
  if (!authoring.ok) {
    return authoring;
  }

  const acceptsChildren = value["acceptsChildren"];
  if (typeof acceptsChildren !== "boolean") {
    return reject(
      "invalid_accepts_children",
      "acceptsChildren",
      "acceptsChildren must be boolean.",
    );
  }

  const props = validateProps(value["props"]);
  if (!props.ok) {
    return props;
  }
  // A rule about the prop contract, so it is answered once the whole contract
  // has passed ordinary validation and before the collect block is read.
  const request = validateCollectRequest(props.props);
  if (request !== undefined) {
    return request;
  }
  // The other reserved authored prop, answered in the same place and in a fixed
  // order after the request list, so a spec wrong in both ways always reports
  // the same one first.
  const eventArg = validateEventArg(props.props);
  if (eventArg !== undefined) {
    return eventArg;
  }

  const base: ComponentSpec = {
    tag,
    whenToUse,
    authoring: authoring.authoring,
    props: props.props,
    acceptsChildren,
  };
  const recipe = validateThemeRecipe(value["themeRecipe"]);
  if (!recipe.ok) {
    return recipe;
  }
  const withRecipe = recipe.recipe === undefined ? base : { ...base, themeRecipe: recipe.recipe };

  if (!("collect" in value)) {
    return freezeSpec(withRecipe);
  }
  const collect = validateCollect(value["collect"], props.props);
  if (!collect.ok) {
    return collect;
  }
  return freezeSpec({ ...withRecipe, collect: collect.collect });
}

function freezeSpec(spec: ComponentSpec): { readonly ok: true; readonly spec: ComponentSpec } {
  return { ok: true, spec: Object.freeze(spec) };
}

function validateProps(
  value: unknown,
): { readonly ok: true; readonly props: Readonly<Record<string, PropSchema>> } | SpecRejection {
  if (!isRecord(value)) {
    return reject("invalid_props", "props", "A spec must declare a prop contract object.");
  }
  const names = Object.keys(value).sort();
  if (names.length > BOUNDS.propsPerComponentSpec) {
    return reject("too_many_props", "props", "Prop count exceeds B-10.");
  }
  const props: Record<string, PropSchema> = {};
  for (const name of names) {
    const at = `props.${name}`;
    if (!isFacetIdentifier(name)) {
      return reject("invalid_prop_name", at, "A prop name must be a Facet identifier.");
    }
    const schema = validatePropSchema(value[name], at);
    if (!schema.ok) {
      return schema;
    }
    props[name] = schema.schema;
  }
  return { ok: true, props: Object.freeze(props) };
}

function validateThemeRecipe(
  value: unknown,
): { readonly ok: true; readonly recipe: ThemeRecipeSpec | undefined } | SpecRejection {
  if (value === undefined) {
    return { ok: true, recipe: undefined };
  }
  if (!isRecord(value)) {
    return reject("invalid_theme_recipe", "themeRecipe", "themeRecipe must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, THEME_RECIPE_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_theme_recipe_key",
      `themeRecipe.${unknownKey}`,
      "The theme recipe form is closed.",
    );
  }
  const rawTokens = value["tokens"];
  if (!isRecord(rawTokens)) {
    return reject(
      "invalid_theme_recipe_tokens",
      "themeRecipe.tokens",
      "Recipe tokens are a plain object.",
    );
  }
  const names = Object.keys(rawTokens).sort();
  const projected = new Set<string>();
  const tokens: Record<string, FacetThemeTokenValueKind> = {};
  for (const name of names) {
    if (!isFacetIdentifier(name)) {
      return reject(
        "invalid_theme_recipe_token",
        `themeRecipe.tokens.${name}`,
        "A recipe token name must be a Facet identifier.",
      );
    }
    const projectedName = facetThemeToKebabCase(name);
    if (projected.has(projectedName)) {
      return reject(
        "duplicate_theme_recipe_token",
        `themeRecipe.tokens.${name}`,
        "Recipe token names must not collide after CSS variable projection.",
      );
    }
    projected.add(projectedName);
    const kind = rawTokens[name];
    if (typeof kind !== "string" || !TOKEN_VALUE_KINDS.includes(kind as FacetThemeTokenValueKind)) {
      return reject(
        "invalid_theme_recipe_token_kind",
        `themeRecipe.tokens.${name}`,
        "A recipe token kind must be one of Facet's declared theme token value kinds.",
      );
    }
    tokens[name] = kind as FacetThemeTokenValueKind;
  }
  return {
    ok: true,
    recipe: Object.freeze({
      tokens: Object.freeze(tokens),
    }),
  };
}

function validatePropSchema(
  value: unknown,
  at: string,
): { readonly ok: true; readonly schema: PropSchema } | SpecRejection {
  if (!isRecord(value)) {
    return reject("invalid_prop_schema", at, "A prop schema must be a plain object.");
  }
  const type = value["type"];
  if (!isPropDeclarationType(type)) {
    return reject(
      "invalid_prop_type",
      `${at}.type`,
      "A prop is a string, a number, a boolean, or a bindable array or object.",
    );
  }
  const unknownKey = firstUnknownKey(value, PROP_KEYS[type]);
  if (unknownKey !== undefined) {
    return reject("unknown_prop_key", `${at}.${unknownKey}`, "PropSchema is a closed subset.");
  }

  const guidance = value["guidance"];
  if (typeof guidance !== "string" || guidance.length === 0) {
    return reject("invalid_prop_guidance", `${at}.guidance`, "Every prop needs guidance text.");
  }
  if (guidance.length > BOUNDS.propGuidanceChars) {
    return reject("prop_guidance_too_long", `${at}.guidance`, "Prop guidance exceeds B-13.");
  }

  const flags = validateFlags(value, at);
  if (!flags.ok) {
    return flags;
  }
  if (type === "array" || type === "object") {
    return validateStructuredSchema(type, guidance, flags, at);
  }
  return validateScalarSchema(value, type, guidance, flags, at);
}

const PROP_DECLARATION_TYPES: readonly string[] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
];

function isPropDeclarationType(value: unknown): value is PropDeclarationType {
  return typeof value === "string" && PROP_DECLARATION_TYPES.includes(value);
}

/** The flags both branches read, already checked to be booleans if present. */
type PropFlags = { readonly required?: boolean; readonly bindable?: boolean };

/**
 * A structured prop is **binding-only**: its value arrives from the data model,
 * never from the markup, so an omitted or false `bindable` declares a prop no
 * author could ever fill. The closed key set has already rejected every domain,
 * default and shape keyword by the time this runs.
 */
function validateStructuredSchema(
  type: StructuredPropType,
  guidance: string,
  flags: PropFlags,
  at: string,
): { readonly ok: true; readonly schema: PropSchema } | SpecRejection {
  if (flags.bindable !== true) {
    return reject(
      "structured_prop_not_bindable",
      `${at}.bindable`,
      "A structured prop is filled by a binding, so it must declare bindable: true.",
    );
  }
  const draft: Record<string, unknown> = { type, guidance };
  if (flags.required !== undefined) {
    draft["required"] = flags.required;
  }
  draft["bindable"] = true;
  return { ok: true, schema: Object.freeze(draft) as PropSchema };
}

function validateScalarSchema(
  value: Record<string, unknown>,
  type: PropType,
  guidance: string,
  flags: PropFlags,
  at: string,
): { readonly ok: true; readonly schema: PropSchema } | SpecRejection {
  const domain = validateDomain(value, type, at);
  if (!domain.ok) {
    return domain;
  }
  const defaultValue = validateDefault(value, type, at, flags.required === true, domain);
  if (!defaultValue.ok) {
    return defaultValue;
  }

  const draft: Record<string, unknown> = { type, guidance };
  if (flags.required !== undefined) {
    draft["required"] = flags.required;
  }
  if (flags.bindable !== undefined) {
    draft["bindable"] = flags.bindable;
  }
  if (domain.members !== undefined) {
    draft["enum"] = domain.members;
  }
  if (domain.minimum !== undefined) {
    draft["minimum"] = domain.minimum;
  }
  if (domain.maximum !== undefined) {
    draft["maximum"] = domain.maximum;
  }
  if (defaultValue.value !== undefined) {
    draft["default"] = defaultValue.value;
  }
  // Every key present was individually checked against the closed subset for
  // this scalar type above, so the assembled record is a PropSchema.
  return { ok: true, schema: Object.freeze(draft) as PropSchema };
}

function validateFlags(
  value: Record<string, unknown>,
  at: string,
): { readonly ok: true; readonly required?: boolean; readonly bindable?: boolean } | SpecRejection {
  const flags: { required?: boolean; bindable?: boolean } = {};
  for (const flag of ["required", "bindable"] as const) {
    if (!(flag in value)) {
      continue;
    }
    const raw = value[flag];
    if (typeof raw !== "boolean") {
      return reject(`invalid_prop_${flag}`, `${at}.${flag}`, `${flag} must be a boolean.`);
    }
    flags[flag] = raw;
  }
  return { ok: true, ...flags };
}

type Domain = {
  readonly ok: true;
  readonly members?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
};

function validateDomain(
  value: Record<string, unknown>,
  type: PropType,
  at: string,
): Domain | SpecRejection {
  const members = "enum" in value ? validateEnum(value["enum"], type, `${at}.enum`) : undefined;
  if (members !== undefined && !members.ok) {
    return members;
  }
  const bounds = validateNumericBounds(value, at);
  if (!bounds.ok) {
    return bounds;
  }
  return {
    ok: true,
    ...(members === undefined ? {} : { members: members.members }),
    ...(bounds.minimum === undefined ? {} : { minimum: bounds.minimum }),
    ...(bounds.maximum === undefined ? {} : { maximum: bounds.maximum }),
  };
}

function validateEnum(
  raw: unknown,
  type: PropType,
  at: string,
): { readonly ok: true; readonly members: readonly (string | number)[] } | SpecRejection {
  if (!Array.isArray(raw)) {
    return reject("invalid_enum", at, "An enum domain must be an array.");
  }
  const members: readonly unknown[] = raw;
  if (members.length === 0) {
    return reject("empty_enum", at, "An empty domain admits no value.");
  }
  if (members.length > BOUNDS.enumValuesPerProp) {
    return reject("too_many_enum_values", at, "Enum size exceeds B-11.");
  }
  const seen = new Set<unknown>();
  for (const member of members) {
    if (!matchesScalarType(member, type)) {
      return reject("invalid_enum_value", at, `Every domain value must be a ${type}.`);
    }
    if (seen.has(member)) {
      return reject("duplicate_enum_value", at, "Domain values are distinct.");
    }
    seen.add(member);
  }
  return { ok: true, members: Object.freeze([...members] as readonly (string | number)[]) };
}

function validateNumericBounds(
  value: Record<string, unknown>,
  at: string,
):
  | {
      readonly ok: true;
      readonly minimum: number | undefined;
      readonly maximum: number | undefined;
    }
  | SpecRejection {
  const bounds: { minimum: number | undefined; maximum: number | undefined } = {
    minimum: undefined,
    maximum: undefined,
  };
  for (const key of ["minimum", "maximum"] as const) {
    if (!(key in value)) {
      continue;
    }
    const raw = value[key];
    if (!isFiniteNumber(raw)) {
      return reject(`invalid_prop_${key}`, `${at}.${key}`, `${key} must be a finite number.`);
    }
    bounds[key] = raw;
  }
  if (bounds.minimum !== undefined && bounds.maximum !== undefined) {
    if (bounds.minimum > bounds.maximum) {
      return reject("inverted_numeric_domain", at, "minimum must not exceed maximum.");
    }
  }
  return { ok: true, ...bounds };
}

function validateDefault(
  value: Record<string, unknown>,
  type: PropType,
  at: string,
  required: boolean,
  domain: Domain,
): { readonly ok: true; readonly value: string | number | boolean | undefined } | SpecRejection {
  if (!("default" in value)) {
    return { ok: true, value: undefined };
  }
  const location = `${at}.default`;
  const raw = value["default"];
  if (!matchesScalarType(raw, type)) {
    return reject("invalid_prop_default", location, `A default must be a ${type}.`);
  }
  if (required) {
    return reject("required_prop_with_default", at, "A default is what makes a prop optional.");
  }
  if (domain.members !== undefined && !domain.members.some((member) => member === raw)) {
    return reject("default_outside_domain", location, "The default is not in the enum domain.");
  }
  if (isFiniteNumber(raw)) {
    const belowMinimum = domain.minimum !== undefined && raw < domain.minimum;
    const aboveMaximum = domain.maximum !== undefined && raw > domain.maximum;
    if (belowMinimum || aboveMaximum) {
      return reject("default_outside_domain", location, "The default is outside minimum/maximum.");
    }
  }
  return { ok: true, value: raw as string | number | boolean };
}

function validateCollect(
  value: unknown,
  props: Readonly<Record<string, PropSchema>>,
): { readonly ok: true; readonly collect: CollectSpec } | SpecRejection {
  if (!isRecord(value)) {
    return reject("invalid_collect", "collect", "A collect block must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, COLLECT_KEYS);
  if (unknownKey !== undefined) {
    return reject("unknown_collect_key", `collect.${unknownKey}`, "The collect block is closed.");
  }
  if (value["collectable"] !== true) {
    return reject(
      "invalid_collectable",
      "collect.collectable",
      "A non-collectable component omits the collect block entirely.",
    );
  }
  const valueProp = value["valueProp"];
  if (!isFacetIdentifier(valueProp) || !Object.hasOwn(props, valueProp)) {
    return reject(
      "unknown_value_prop",
      "collect.valueProp",
      "valueProp must name a declared prop.",
    );
  }
  if (!("sensitiveProp" in value)) {
    const address = validateCollectName(props, valueProp);
    return (
      address ?? { ok: true, collect: Object.freeze({ collectable: true as const, valueProp }) }
    );
  }
  const sensitiveProp = value["sensitiveProp"];
  if (!isFacetIdentifier(sensitiveProp) || props[sensitiveProp]?.type !== "boolean") {
    return reject(
      "invalid_sensitive_prop",
      "collect.sensitiveProp",
      "sensitiveProp must name a declared boolean prop.",
    );
  }
  const address = validateCollectName(props, valueProp);
  return (
    address ?? {
      ok: true,
      collect: Object.freeze({ collectable: true as const, valueProp, sensitiveProp }),
    }
  );
}

/**
 * Checks the collection request list, when a spec declares one.
 *
 * The prop name is the reservation, so a declaration of the wrong type is a
 * nonconforming request list rather than an ordinary prop that happens to share
 * the name: a host cannot opt out of the convention by declaring `collect` as
 * something else. The rule deliberately does **not** consult the collect block —
 * a `Button` declares the list and collects nothing, a `Field` collects and
 * declares no list — and `required` is left to the spec, because whether a
 * component must carry a list is a question about that component, not about
 * Facet's ability to read one.
 *
 * Guidance is not re-checked here. Every prop already needs it, so the "scalar
 * string with guidance" shape is complete once ordinary validation has run.
 *
 * Returns `undefined` when the declaration conforms, so the caller reads as a
 * guard.
 */
function validateCollectRequest(
  props: Readonly<Record<string, PropSchema>>,
): SpecRejection | undefined {
  const at = `props.${COLLECT_REQUEST_PROP}`;
  const request = props[COLLECT_REQUEST_PROP];
  if (request === undefined) {
    return undefined;
  }
  if (request.type !== "string") {
    return rejectCollectRequest(`${at}.type`, "A collection request list is a scalar string.");
  }
  const forbidden = FRAMEWORK_PROP_FORBIDDEN_KEYS.find((key) => key in request);
  if (forbidden !== undefined) {
    return rejectCollectRequest(
      `${at}.${forbidden}`,
      "A request list is authored literally, so it carries no default, domain or binding.",
    );
  }
  return undefined;
}

function rejectCollectRequest(at: string, detail: string): SpecRejection {
  return reject("nonconforming_collect_request", at, detail);
}

/**
 * Checks the event argument, when a spec declares one.
 *
 * An `agent:` event carries one explicit argument, so the exact lowercase `arg`
 * is reserved the way the two collection props are: the renderer forwarding it
 * is reading a framework convention, not inferring meaning from a
 * component-specific prop. The name is the reservation, so a declaration of the
 * wrong type is a nonconforming argument rather than an ordinary prop that
 * happens to share the name.
 *
 * Two things the request list forbids are **left to the spec** here, and the
 * shorter forbidden-key set above is the whole difference. `required` is the
 * component's own business — whether a control must carry an argument says
 * nothing about Facet's ability to read one — and `enum` is a legitimate
 * authoring constraint: the author still writes one literal value, and pinning
 * the closed set it comes from is exactly what a prop domain is for. Reusing the
 * collection set would forbid a domain the default `Button` is entitled to.
 *
 * Guidance is not re-checked here; every prop already needs it.
 *
 * Returns `undefined` when the declaration conforms, so the caller reads as a
 * guard.
 */
function validateEventArg(props: Readonly<Record<string, PropSchema>>): SpecRejection | undefined {
  const at = `props.${EVENT_ARG_PROP}`;
  const arg = props[EVENT_ARG_PROP];
  if (arg === undefined) {
    return undefined;
  }
  if (arg.type !== "string") {
    return rejectEventArg(`${at}.type`, "An event argument is a scalar string.");
  }
  const forbidden = EVENT_ARG_FORBIDDEN_KEYS.find((key) => key in arg);
  if (forbidden !== undefined) {
    return rejectEventArg(
      `${at}.${forbidden}`,
      "An argument is authored literally, so it carries no default and no binding.",
    );
  }
  return undefined;
}

function rejectEventArg(at: string, detail: string): SpecRejection {
  return reject("nonconforming_event_arg", at, detail);
}

/**
 * Checks the collection address a collectable spec must declare.
 *
 * It runs **after** the collect block's own keys, so a malformed block is
 * reported as the malformed block it is rather than as a missing address; and it
 * reads the already-normalized props, so bounded guidance and every other
 * ordinary prop rule have been applied first. One code covers every
 * nonconformity — a host reading it has one thing to fix and the location names
 * which part.
 *
 * The address is also the one prop `valueProp` may **not** name. The framework
 * consumes the address and strips it before mount, so a spec that pointed the
 * injected value at it would have Facet overwrite the very name a collect list
 * resolves. That check comes last, once the address is known to exist and
 * conform, so a spec wrong in both ways is reported as the address fault it is.
 *
 * Returns `undefined` when the address conforms, so the caller reads as a guard.
 */
function validateCollectName(
  props: Readonly<Record<string, PropSchema>>,
  valueProp: string,
): SpecRejection | undefined {
  const at = `props.${COLLECT_NAME_PROP}`;
  const name = props[COLLECT_NAME_PROP];
  if (name === undefined) {
    return rejectCollectName(at, "A collectable component declares the name a collect list uses.");
  }
  if (name.type !== "string") {
    return rejectCollectName(`${at}.type`, "A collection address is a scalar string.");
  }
  const forbidden = FRAMEWORK_PROP_FORBIDDEN_KEYS.find((key) => key in name);
  if (forbidden !== undefined) {
    return rejectCollectName(
      `${at}.${forbidden}`,
      "An address is authored literally, so it carries no default, domain or binding.",
    );
  }
  if (name.required !== true) {
    return rejectCollectName(`${at}.required`, "Every collectable field is addressed by name.");
  }
  if (valueProp === COLLECT_NAME_PROP) {
    return rejectCollectName(
      "collect.valueProp",
      "The collection address cannot also be the value prop Facet injects.",
    );
  }
  return undefined;
}

function rejectCollectName(at: string, detail: string): SpecRejection {
  return reject("nonconforming_collect_name", at, detail);
}
