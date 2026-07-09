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

export type CatalogStampsPolicy =
  { readonly mode: "all" } | { readonly mode: "allow"; readonly names: readonly string[] };

export type CatalogCompositionsPolicy = CatalogStampsPolicy;

export type CatalogLegacyUsageOrder = readonly ["stamp", "brick", "primitive"];
export type CatalogComponentUsageOrder = readonly ["composition", "component", "primitive"];

export interface CatalogUsagePolicy {
  readonly order: CatalogLegacyUsageOrder;
  readonly componentOrder?: CatalogComponentUsageOrder;
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
  readonly stamps: CatalogStampsPolicy;
  readonly compositions?: CatalogCompositionsPolicy;
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

const LEGACY_USAGE_ORDER = ["stamp", "brick", "primitive"] as const;
const COMPONENT_USAGE_ORDER = ["composition", "component", "primitive"] as const;

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
  stamps: { mode: "all" },
  compositions: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: LEGACY_USAGE_ORDER,
    componentOrder: COMPONENT_USAGE_ORDER,
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

function cloneStampsPolicy(stamps: CatalogStampsPolicy): CatalogStampsPolicy {
  return stamps.mode === "all" ? { mode: "all" } : { mode: "allow", names: [...stamps.names] };
}

function cloneUsagePolicy(policy: CatalogUsagePolicy): CatalogUsagePolicy {
  const cloned: {
    order: CatalogLegacyUsageOrder;
    componentOrder?: CatalogComponentUsageOrder;
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...policy.order] as CatalogLegacyUsageOrder,
    editBeforeAppend: policy.editBeforeAppend,
    compactScreens: policy.compactScreens,
  };
  if (policy.componentOrder !== undefined) {
    cloned.componentOrder = [...policy.componentOrder] as CatalogComponentUsageOrder;
  }
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
    stamps: CatalogStampsPolicy;
    compositions?: CatalogCompositionsPolicy;
    primitiveFallback: "allowed" | "discouraged";
    policy: CatalogUsagePolicy;
  } = {
    name: catalog.name,
    theme: cloneThemePolicy(catalog.theme),
    bricks: cloneCatalogBricks(catalog.bricks),
    stamps: cloneStampsPolicy(catalog.stamps),
    primitiveFallback: catalog.primitiveFallback,
    policy: cloneUsagePolicy(catalog.policy),
  };
  if (catalog.description !== undefined) cloned.description = catalog.description;
  if (catalog.components !== undefined) {
    cloned.components = cloneCatalogComponents(catalog.components);
  }
  if (catalog.compositions !== undefined)
    cloned.compositions = cloneStampsPolicy(catalog.compositions);
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

function themeNameList(
  raw: unknown,
  field: string,
  issues: BoundedIssues,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const value of raw.slice(0, MAX_CATALOG_POLICY_COUNT)) {
    if (typeof value === "string" && isValidThemeName(value)) {
      out.push(value);
    } else {
      issues.push(`catalog ${field}: malformed name ${printableValue(value)} dropped`);
    }
  }
  if (raw.length > MAX_CATALOG_POLICY_COUNT) {
    issues.push(`catalog ${field}: exceeded the ${MAX_CATALOG_POLICY_COUNT}-item cap`);
  }
  return out.length > 0 ? out : undefined;
}

function variantList(
  raw: unknown,
  field: string,
  issues: BoundedIssues,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const value of raw.slice(0, MAX_CATALOG_POLICY_COUNT)) {
    if (typeof value === "string" && isValidThemeName(value)) {
      out.push(value);
    } else {
      issues.push(`catalog ${field}: malformed variant ${printableValue(value)} dropped`);
    }
  }
  if (raw.length > MAX_CATALOG_POLICY_COUNT) {
    issues.push(`catalog ${field}: exceeded the ${MAX_CATALOG_POLICY_COUNT}-item cap`);
  }
  return out.length > 0 ? out : undefined;
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
  return bricks.length > 0 ? bricks : cloneCatalogBricks(DEFAULT_CATALOG.bricks);
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
  return components.length > 0 ? components : cloneCatalogComponents(DEFAULT_COMPONENTS);
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

function validateCatalogNamedPolicy(
  raw: unknown,
  label: "stamps" | "compositions",
  issues: BoundedIssues,
): CatalogStampsPolicy {
  if (!isPlainObject(raw)) return cloneStampsPolicy(DEFAULT_CATALOG.stamps);
  if (raw.mode === "all") return { mode: "all" };
  if (raw.mode !== "allow") {
    issues.push(`catalog ${label}: invalid mode ${printableValue(raw.mode)}; defaulted to all`);
    return cloneStampsPolicy(DEFAULT_CATALOG.stamps);
  }
  const names = themeNameList(raw.names, `${label}.names`, issues);
  return { mode: "allow", names: names ?? [] };
}

function validateCatalogStamps(raw: unknown, issues: BoundedIssues): CatalogStampsPolicy {
  return validateCatalogNamedPolicy(raw, "stamps", issues);
}

function validateCatalogCompositions(
  raw: unknown,
  issues: BoundedIssues,
): CatalogCompositionsPolicy {
  return validateCatalogNamedPolicy(raw, "compositions", issues);
}

function isLegacyUsageOrder(value: unknown): value is CatalogLegacyUsageOrder {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === "stamp" &&
    value[1] === "brick" &&
    value[2] === "primitive"
  );
}

function isComponentUsageOrder(value: unknown): value is CatalogComponentUsageOrder {
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
    order: CatalogLegacyUsageOrder;
    componentOrder?: CatalogComponentUsageOrder;
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...LEGACY_USAGE_ORDER] as CatalogLegacyUsageOrder,
    componentOrder: [...COMPONENT_USAGE_ORDER] as CatalogComponentUsageOrder,
    editBeforeAppend:
      typeof raw.editBeforeAppend === "boolean"
        ? raw.editBeforeAppend
        : DEFAULT_CATALOG.policy.editBeforeAppend,
    compactScreens:
      typeof raw.compactScreens === "boolean"
        ? raw.compactScreens
        : DEFAULT_CATALOG.policy.compactScreens,
  };
  if (isLegacyUsageOrder(raw.order)) {
    policy.order = [...LEGACY_USAGE_ORDER] as CatalogLegacyUsageOrder;
  } else if (isComponentUsageOrder(raw.order)) {
    policy.order = [...LEGACY_USAGE_ORDER] as CatalogLegacyUsageOrder;
    policy.componentOrder = [...COMPONENT_USAGE_ORDER] as CatalogComponentUsageOrder;
  } else if (raw.order !== undefined) {
    issues.push("catalog policy: invalid order defaulted to composition > component > primitive");
  }
  if (isComponentUsageOrder(raw.componentOrder)) {
    policy.componentOrder = [...COMPONENT_USAGE_ORDER] as CatalogComponentUsageOrder;
  } else if (isLegacyUsageOrder(raw.componentOrder)) {
    policy.componentOrder = [...COMPONENT_USAGE_ORDER] as CatalogComponentUsageOrder;
  } else if (raw.componentOrder !== undefined) {
    issues.push(
      "catalog policy: invalid componentOrder defaulted to composition > component > primitive",
    );
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

  const hasBricks = Array.isArray(input.bricks);
  const componentItems = Array.isArray(input.components)
    ? validateCatalogComponents(input.components, issues)
    : undefined;
  const bricks = hasBricks
    ? validateCatalogBricks(input.bricks, issues)
    : componentItems !== undefined
      ? bricksFromComponents(componentItems)
      : cloneCatalogBricks(DEFAULT_CATALOG.bricks);
  const components =
    componentItems ??
    (hasBricks ? componentsFromBricks(bricks) : cloneCatalogComponents(DEFAULT_COMPONENTS));
  const stamps =
    isPlainObject(input.stamps) || !isPlainObject(input.compositions)
      ? validateCatalogStamps(input.stamps, issues)
      : validateCatalogCompositions(input.compositions, issues);
  const compositions = isPlainObject(input.compositions)
    ? validateCatalogCompositions(input.compositions, issues)
    : cloneStampsPolicy(stamps);

  const catalog: {
    name: string;
    description?: string;
    theme: CatalogThemePolicy;
    bricks: readonly CatalogBrick[];
    components: readonly CatalogComponent[];
    stamps: CatalogStampsPolicy;
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
    stamps,
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
