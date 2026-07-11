import { boundedDescription, BoundedIssues, isPlainObject, printableValue } from "./issues.js";
import {
  COMPONENT_NODE_TYPES,
  INTRINSIC_COMPONENT_TYPES,
  PRIMITIVE_BRICK_TYPES,
  type ComponentNodeType,
  type FacetNode,
} from "./nodes.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";

export const CATALOG_COMPONENT_TYPES = [
  ...INTRINSIC_COMPONENT_TYPES,
] as const satisfies readonly ComponentNodeType[];

export const CATALOG_BRICK_TYPES = [
  ...PRIMITIVE_BRICK_TYPES,
  ...COMPONENT_NODE_TYPES,
] as const satisfies readonly FacetNode["type"][];

export interface CatalogThemePolicy {
  readonly active?: string;
  readonly switchPolicy: "locked" | "allowed";
  readonly allowed?: readonly string[];
}

export interface CatalogBrick {
  readonly type: FacetNode["type"];
  readonly variants?: readonly string[];
  readonly guidance?: string;
}

export interface CatalogComponent {
  readonly type: ComponentNodeType;
  readonly variants?: readonly string[];
  readonly guidance?: string;
}

export type CatalogCompositionsPolicy =
  { readonly mode: "all" } | { readonly mode: "allow"; readonly names: readonly string[] };

export type CatalogUsageOrder = readonly ["composition", "component", "primitive"];

export interface CatalogUsagePolicy {
  readonly order: CatalogUsageOrder;
  readonly editBeforeAppend: boolean;
  readonly compactScreens: boolean;
  readonly maxScreenSections?: number;
}

export interface FacetCatalog {
  readonly name: string;
  readonly description?: string;
  readonly theme: CatalogThemePolicy;
  readonly bricks: readonly CatalogBrick[];
  readonly components?: readonly CatalogComponent[];
  readonly compositions: CatalogCompositionsPolicy;
  readonly primitiveFallback: "allowed" | "discouraged";
  readonly policy: CatalogUsagePolicy;
}

export interface CatalogValidationResult {
  readonly catalog: FacetCatalog;
  readonly issues: readonly string[];
}

const MAX_CATALOG_ITEMS = 128;
const MAX_CATALOG_POLICY_COUNT = 32;
const MAX_SCREEN_SECTIONS = 20;

const CANONICAL_USAGE_ORDER = ["composition", "component", "primitive"] as const;

const DEFAULT_COMPONENTS: readonly CatalogComponent[] = [
  {
    type: "button",
    variants: ["primary", "secondary", "danger"],
    guidance: "Use for direct visitor actions before hand-rolled pressable boxes.",
  },
  {
    type: "section",
    variants: ["default", "surface"],
    guidance: "Use as compact screen/page regions.",
  },
  {
    type: "card",
    variants: ["default", "interactive"],
    guidance: "Use for grouped content, records, and action panels.",
  },
  { type: "tabs", variants: ["default"], guidance: "Use for local screen navigation." },
  { type: "nav", variants: ["default"], guidance: "Use for app and section navigation." },
  { type: "table", variants: ["default"], guidance: "Use for display-only tabular data." },
  { type: "chart", variants: ["default"], guidance: "Use for display-only chart data." },
  {
    type: "metric",
    variants: ["default", "success"],
    guidance: "Use for compact KPIs and metrics.",
  },
  { type: "keyValue", variants: ["default"], guidance: "Use for compact label/value details." },
  {
    type: "badge",
    variants: ["neutral", "success", "warning", "danger"],
    guidance: "Use for compact statuses and labels.",
  },
  {
    type: "progress",
    variants: ["default", "success"],
    guidance: "Use for bounded percentage progress.",
  },
  {
    type: "alert",
    variants: ["info", "success", "warning", "danger"],
    guidance: "Use for feedback, warnings, and notices.",
  },
  {
    type: "list",
    variants: ["default", "compact"],
    guidance: "Use for capped task or summary lists.",
  },
  { type: "divider", variants: ["default"], guidance: "Use to separate dense content." },
  { type: "form", variants: ["default"], guidance: "Use for grouped visitor input." },
  { type: "search", variants: ["default"], guidance: "Use for search input and submission." },
  {
    type: "filterBar",
    variants: ["default"],
    guidance: "Use for compact filtering controls.",
  },
  {
    type: "emptyState",
    variants: ["default"],
    guidance: "Use for no-data and no-result states.",
  },
  { type: "loading", variants: ["default"], guidance: "Use for pending and busy states." },
];

const DEFAULT_PRIMITIVE_BRICKS: readonly CatalogBrick[] = [
  { type: "box", guidance: "Primitive fallback for custom flow layout." },
  { type: "text", guidance: "Primitive fallback for freeform copy." },
  {
    type: "media",
    variants: ["default", "hero"],
    guidance: "Use for bounded image/video media.",
  },
  { type: "field", variants: ["default"], guidance: "Use for visitor input controls." },
];

const DEFAULT_LEGACY_BRICKS: readonly CatalogBrick[] = [
  {
    type: "stat",
    variants: ["default", "success"],
    guidance: "Legacy alias for metric; prefer metric for new catalogs.",
  },
];

const DEFAULT_BRICKS: readonly CatalogBrick[] = [
  ...DEFAULT_PRIMITIVE_BRICKS,
  ...DEFAULT_COMPONENTS,
  ...DEFAULT_LEGACY_BRICKS,
];

export const DEFAULT_CATALOG: FacetCatalog = {
  name: "default",
  description: "Default Facet catalog for compact product and app UI.",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: DEFAULT_BRICKS,
  components: DEFAULT_COMPONENTS,
  compositions: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: CANONICAL_USAGE_ORDER,
    editBeforeAppend: true,
    compactScreens: true,
    maxScreenSections: 6,
  },
};

function cloneThemePolicy(theme: CatalogThemePolicy): CatalogThemePolicy {
  const cloned: {
    active?: string;
    switchPolicy: "locked" | "allowed";
    allowed?: readonly string[];
  } = { switchPolicy: theme.switchPolicy };
  if (theme.active !== undefined) cloned.active = theme.active;
  if (theme.allowed !== undefined) cloned.allowed = [...theme.allowed];
  return cloned;
}

function cloneCatalogBrick(brick: CatalogBrick): CatalogBrick {
  const cloned: { type: FacetNode["type"]; variants?: readonly string[]; guidance?: string } = {
    type: brick.type,
  };
  if (brick.variants !== undefined) cloned.variants = [...brick.variants];
  if (brick.guidance !== undefined) cloned.guidance = brick.guidance;
  return cloned;
}

function cloneCatalogBricks(bricks: readonly CatalogBrick[]): readonly CatalogBrick[] {
  return bricks.map(cloneCatalogBrick);
}

function cloneCatalogComponent(component: CatalogComponent): CatalogComponent {
  const cloned: { type: ComponentNodeType; variants?: readonly string[]; guidance?: string } = {
    type: component.type,
  };
  if (component.variants !== undefined) cloned.variants = [...component.variants];
  if (component.guidance !== undefined) cloned.guidance = component.guidance;
  return cloned;
}

function cloneCatalogComponents(
  components: readonly CatalogComponent[],
): readonly CatalogComponent[] {
  return components.map(cloneCatalogComponent);
}

function cloneCompositionsPolicy(
  compositions: CatalogCompositionsPolicy,
): CatalogCompositionsPolicy {
  return compositions.mode === "all"
    ? { mode: "all" }
    : { mode: "allow", names: [...compositions.names] };
}

function cloneUsagePolicy(policy: CatalogUsagePolicy): CatalogUsagePolicy {
  const cloned: {
    order: CatalogUsageOrder;
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...policy.order] as CatalogUsageOrder,
    editBeforeAppend: policy.editBeforeAppend,
    compactScreens: policy.compactScreens,
  };
  if (policy.maxScreenSections !== undefined) cloned.maxScreenSections = policy.maxScreenSections;
  return cloned;
}

function cloneCatalog(catalog: FacetCatalog): FacetCatalog {
  const cloned: {
    name: string;
    description?: string;
    theme: CatalogThemePolicy;
    bricks: readonly CatalogBrick[];
    components?: readonly CatalogComponent[];
    compositions: CatalogCompositionsPolicy;
    primitiveFallback: "allowed" | "discouraged";
    policy: CatalogUsagePolicy;
  } = {
    name: catalog.name,
    theme: cloneThemePolicy(catalog.theme),
    bricks: cloneCatalogBricks(catalog.bricks),
    compositions: cloneCompositionsPolicy(catalog.compositions),
    primitiveFallback: catalog.primitiveFallback,
    policy: cloneUsagePolicy(catalog.policy),
  };
  if (catalog.description !== undefined) cloned.description = catalog.description;
  if (catalog.components !== undefined) {
    cloned.components = cloneCatalogComponents(catalog.components);
  }
  return cloned;
}

function defaultCatalog(): FacetCatalog {
  return cloneCatalog(DEFAULT_CATALOG);
}

function isBrickType(value: unknown): value is FacetNode["type"] {
  return typeof value === "string" && (CATALOG_BRICK_TYPES as readonly string[]).includes(value);
}

function isCatalogComponentType(value: unknown): value is ComponentNodeType {
  return typeof value === "string" && (COMPONENT_NODE_TYPES as readonly string[]).includes(value);
}

function boundedNameList(
  raw: unknown,
  field: string,
  label: "name" | "variant",
  issues: BoundedIssues,
): readonly string[] | undefined {
  // Distinguish absent from provided-with-wrong-shape. An ABSENT field stays
  // undefined (unrestricted). A PROVIDED-but-non-array field is a broken
  // restriction: fail closed to [] (allow nothing) with an issue, never open it
  // back up to "anything allowed" by returning undefined.
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issues.push(`catalog ${field}: expected an array of ${label}s; restriction kept empty`);
    return [];
  }
  const out: string[] = [];
  for (const value of raw.slice(0, MAX_CATALOG_POLICY_COUNT)) {
    if (typeof value === "string" && isValidThemeName(value)) {
      out.push(value);
    } else {
      issues.push(`catalog ${field}: malformed ${label} ${printableValue(value)} dropped`);
    }
  }
  if (raw.length > MAX_CATALOG_POLICY_COUNT) {
    issues.push(`catalog ${field}: exceeded the ${MAX_CATALOG_POLICY_COUNT}-item cap`);
  }
  // Fail closed: an author who PROVIDED a restriction list (even []) whose valid
  // entries come out empty gets an empty restriction (allow nothing), never
  // undefined (unrestricted). Returning undefined here would invert the intended
  // restriction into "anything allowed" downstream. An ABSENT/non-array field
  // stays undefined (unrestricted) via the guard at the top.
  if (out.length === 0) {
    issues.push(`catalog ${field}: no valid entries — restriction kept empty`);
    return [];
  }
  return out;
}

function themeNameList(
  raw: unknown,
  field: string,
  issues: BoundedIssues,
): readonly string[] | undefined {
  return boundedNameList(raw, field, "name", issues);
}

function variantList(
  raw: unknown,
  field: string,
  issues: BoundedIssues,
): readonly string[] | undefined {
  return boundedNameList(raw, field, "variant", issues);
}

function validateCatalogTheme(raw: unknown, issues: BoundedIssues): CatalogThemePolicy {
  if (!isPlainObject(raw)) return cloneThemePolicy(DEFAULT_CATALOG.theme);
  const policy: {
    active?: string;
    switchPolicy: "locked" | "allowed";
    allowed?: readonly string[];
  } = {
    switchPolicy:
      raw.switchPolicy === "allowed" || raw.switchPolicy === "locked" ? raw.switchPolicy : "locked",
  };
  if (
    raw.switchPolicy !== undefined &&
    raw.switchPolicy !== "allowed" &&
    raw.switchPolicy !== "locked"
  ) {
    issues.push(
      `catalog theme: invalid switchPolicy ${printableValue(raw.switchPolicy)}; defaulted to locked`,
    );
  }
  if (typeof raw.active === "string" && isValidThemeName(raw.active)) {
    policy.active = raw.active;
  } else if (raw.active !== undefined) {
    issues.push("catalog theme: malformed active theme dropped");
  }
  const allowed = themeNameList(raw.allowed, "theme.allowed", issues);
  if (allowed !== undefined) policy.allowed = allowed;
  return policy;
}

function validateCatalogBricks(raw: unknown, issues: BoundedIssues): readonly CatalogBrick[] {
  if (!Array.isArray(raw)) return cloneCatalogBricks(DEFAULT_CATALOG.bricks);
  const bricks: CatalogBrick[] = [];
  for (const item of raw.slice(0, MAX_CATALOG_ITEMS)) {
    if (!isPlainObject(item) || !isBrickType(item.type)) {
      issues.push(
        `catalog bricks: unknown type ${printableValue(isPlainObject(item) ? item.type : item)} dropped`,
      );
      continue;
    }
    const brick: { type: FacetNode["type"]; variants?: readonly string[]; guidance?: string } = {
      type: item.type,
    };
    const variants = variantList(item.variants, `bricks.${item.type}.variants`, issues);
    if (variants !== undefined) brick.variants = variants;
    const { description: guidance, warning } = boundedDescription(
      item.guidance,
      `catalog bricks.${item.type}.guidance`,
      MAX_DESCRIPTION_LENGTH,
    );
    if (guidance !== undefined) brick.guidance = guidance;
    if (warning !== undefined && item.guidance !== undefined) issues.push(warning);
    bricks.push(brick);
  }
  if (raw.length > MAX_CATALOG_ITEMS) {
    issues.push(`catalog bricks: exceeded the ${MAX_CATALOG_ITEMS}-item cap`);
  }
  // Fail closed: a PROVIDED bricks array (empty or all-invalid) that validates to
  // empty allows nothing — never substitute the permissive default, which would
  // invert a restriction into "everything allowed". An ABSENT field never reaches
  // here (the caller guards on Array.isArray before invoking).
  if (bricks.length === 0) {
    issues.push(
      "catalog bricks: provided restriction list validated to empty; no catalog bricks allowed (primitives follow primitiveFallback)",
    );
  }
  return bricks;
}

function validateCatalogComponents(
  raw: unknown,
  issues: BoundedIssues,
): readonly CatalogComponent[] {
  if (!Array.isArray(raw)) return cloneCatalogComponents(DEFAULT_COMPONENTS);
  const components: CatalogComponent[] = [];
  for (const item of raw.slice(0, MAX_CATALOG_ITEMS)) {
    if (!isPlainObject(item) || !isCatalogComponentType(item.type)) {
      issues.push(
        `catalog components: unknown type ${printableValue(isPlainObject(item) ? item.type : item)} dropped`,
      );
      continue;
    }
    const component: {
      type: ComponentNodeType;
      variants?: readonly string[];
      guidance?: string;
    } = { type: item.type };
    const variants = variantList(item.variants, `components.${item.type}.variants`, issues);
    if (variants !== undefined) component.variants = variants;
    const { description: guidance, warning } = boundedDescription(
      item.guidance,
      `catalog components.${item.type}.guidance`,
      MAX_DESCRIPTION_LENGTH,
    );
    if (guidance !== undefined) component.guidance = guidance;
    if (warning !== undefined && item.guidance !== undefined) issues.push(warning);
    components.push(component);
  }
  if (raw.length > MAX_CATALOG_ITEMS) {
    issues.push(`catalog components: exceeded the ${MAX_CATALOG_ITEMS}-item cap`);
  }
  // Fail closed (mirrors validateCatalogBricks): a PROVIDED components array that
  // validates to empty allows nothing, rather than reopening the full default set.
  if (components.length === 0) {
    issues.push(
      "catalog components: provided restriction list validated to empty; no catalog components allowed (primitives follow primitiveFallback)",
    );
  }
  return components;
}

function componentsFromBricks(bricks: readonly CatalogBrick[]): readonly CatalogComponent[] {
  const components: CatalogComponent[] = [];
  for (const brick of bricks) {
    if (!isCatalogComponentType(brick.type)) continue;
    components.push(cloneCatalogComponent({ ...brick, type: brick.type }));
  }
  return components;
}

function bricksFromComponents(components: readonly CatalogComponent[]): readonly CatalogBrick[] {
  return components.map((component) => cloneCatalogBrick({ ...component, type: component.type }));
}

function validateCatalogCompositions(
  raw: unknown,
  issues: BoundedIssues,
): CatalogCompositionsPolicy {
  // Absent → the allow-all default (a composition policy is opt-in). A PROVIDED
  // policy of the wrong shape (e.g. an array) is a broken restriction: fail
  // closed to an empty allow-list, never silently fall back to allow-all.
  if (raw === undefined) return cloneCompositionsPolicy(DEFAULT_CATALOG.compositions);
  if (!isPlainObject(raw)) {
    issues.push("catalog compositions: expected a policy object; restriction kept empty");
    return { mode: "allow", names: [] };
  }
  if (raw.mode === "all") return { mode: "all" };
  if (raw.mode !== "allow") {
    issues.push(
      `catalog compositions: invalid mode ${printableValue(raw.mode)}; restriction kept empty`,
    );
    return { mode: "allow", names: [] };
  }
  const names = themeNameList(raw.names, "compositions.names", issues);
  // An allow-list with no valid names allows nothing — diagnose the silent
  // allow-nothing rather than emitting an unremarked empty restriction. A
  // mistyped `names` already pushed its own issue via boundedNameList.
  if (names === undefined) {
    issues.push("catalog compositions.names: no valid entries — restriction kept empty");
    return { mode: "allow", names: [] };
  }
  return { mode: "allow", names };
}

function isCanonicalUsageOrder(value: unknown): value is CatalogUsageOrder {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === "composition" &&
    value[1] === "component" &&
    value[2] === "primitive"
  );
}

function validateUsagePolicy(raw: unknown, issues: BoundedIssues): CatalogUsagePolicy {
  if (!isPlainObject(raw)) return cloneUsagePolicy(DEFAULT_CATALOG.policy);
  const policy: {
    order: CatalogUsageOrder;
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...CANONICAL_USAGE_ORDER] as CatalogUsageOrder,
    editBeforeAppend:
      typeof raw.editBeforeAppend === "boolean"
        ? raw.editBeforeAppend
        : DEFAULT_CATALOG.policy.editBeforeAppend,
    compactScreens:
      typeof raw.compactScreens === "boolean"
        ? raw.compactScreens
        : DEFAULT_CATALOG.policy.compactScreens,
  };
  if (raw.order !== undefined && !isCanonicalUsageOrder(raw.order)) {
    issues.push("catalog policy: invalid order defaulted to composition > component > primitive");
  }
  if (
    typeof raw.maxScreenSections === "number" &&
    Number.isInteger(raw.maxScreenSections) &&
    raw.maxScreenSections >= 1 &&
    raw.maxScreenSections <= MAX_SCREEN_SECTIONS
  ) {
    policy.maxScreenSections = raw.maxScreenSections;
  } else if (raw.maxScreenSections !== undefined) {
    policy.maxScreenSections = DEFAULT_CATALOG.policy.maxScreenSections ?? 6;
    issues.push(
      `catalog policy: maxScreenSections defaulted to ${String(policy.maxScreenSections)}`,
    );
  } else if (DEFAULT_CATALOG.policy.maxScreenSections !== undefined) {
    policy.maxScreenSections = DEFAULT_CATALOG.policy.maxScreenSections;
  }
  return policy;
}

export function validateCatalog(input: unknown): CatalogValidationResult {
  const issues = new BoundedIssues();
  try {
    return validateCatalogUnsafe(input, issues);
  } catch {
    issues.push("catalog could not be read safely; default catalog used");
    return { catalog: defaultCatalog(), issues: issues.list };
  }
}

function validateCatalogUnsafe(input: unknown, issues: BoundedIssues): CatalogValidationResult {
  if (input === undefined) return { catalog: defaultCatalog(), issues: issues.list };
  if (!isPlainObject(input)) {
    issues.push("catalog is not an object; default catalog used");
    return { catalog: defaultCatalog(), issues: issues.list };
  }

  // Distinguish absent (fall back to the default vocabulary) from
  // provided-but-not-an-array (a broken restriction — fail closed to nothing)
  // for BOTH restriction fields. A mistyped restriction must never silently
  // reopen the full default set.
  const bricksProvided = input.bricks !== undefined;
  const componentsProvided = input.components !== undefined;
  let componentItems: readonly CatalogComponent[] | undefined;
  if (Array.isArray(input.components)) {
    componentItems = validateCatalogComponents(input.components, issues);
  } else if (componentsProvided) {
    issues.push(
      "catalog components: expected an array; restriction kept empty (primitives follow primitiveFallback)",
    );
    componentItems = [];
  } else {
    componentItems = undefined;
  }
  let bricks: readonly CatalogBrick[];
  if (Array.isArray(input.bricks)) {
    bricks = validateCatalogBricks(input.bricks, issues);
  } else if (bricksProvided) {
    issues.push(
      "catalog bricks: expected an array; restriction kept empty (primitives follow primitiveFallback)",
    );
    bricks = [];
  } else {
    bricks =
      componentItems !== undefined
        ? bricksFromComponents(componentItems)
        : cloneCatalogBricks(DEFAULT_CATALOG.bricks);
  }
  const components =
    componentItems ??
    (bricksProvided ? componentsFromBricks(bricks) : cloneCatalogComponents(DEFAULT_COMPONENTS));
  const compositions = validateCatalogCompositions(input.compositions, issues);

  const catalog: {
    name: string;
    description?: string;
    theme: CatalogThemePolicy;
    bricks: readonly CatalogBrick[];
    components: readonly CatalogComponent[];
    compositions: CatalogCompositionsPolicy;
    primitiveFallback: "allowed" | "discouraged";
    policy: CatalogUsagePolicy;
  } = {
    name:
      typeof input.name === "string" && isValidThemeName(input.name)
        ? input.name
        : DEFAULT_CATALOG.name,
    theme: validateCatalogTheme(input.theme, issues),
    bricks,
    components,
    compositions,
    primitiveFallback:
      input.primitiveFallback === "allowed" || input.primitiveFallback === "discouraged"
        ? input.primitiveFallback
        : DEFAULT_CATALOG.primitiveFallback,
    policy: validateUsagePolicy(input.policy, issues),
  };
  if (
    input.name !== undefined &&
    catalog.name === DEFAULT_CATALOG.name &&
    input.name !== DEFAULT_CATALOG.name
  ) {
    issues.push("catalog name is missing or malformed; defaulted");
  }
  const { description, warning } = boundedDescription(
    input.description,
    "catalog",
    MAX_DESCRIPTION_LENGTH,
  );
  if (description !== undefined) catalog.description = description;
  if (warning !== undefined && input.description !== undefined) issues.push(warning);
  return { catalog, issues: issues.list };
}
