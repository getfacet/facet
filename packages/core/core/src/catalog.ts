import { boundedDescription, BoundedIssues, isPlainObject, printableValue } from "./issues.js";
import { HIGH_LEVEL_NODE_TYPES, type FacetNode } from "./nodes.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";

export const CATALOG_BRICK_TYPES = [
  "box",
  "text",
  "media",
  "field",
  ...HIGH_LEVEL_NODE_TYPES,
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

export type CatalogStampsPolicy =
  { readonly mode: "all" } | { readonly mode: "allow"; readonly names: readonly string[] };

export interface CatalogUsagePolicy {
  readonly order: readonly ["stamp", "brick", "primitive"];
  readonly editBeforeAppend: boolean;
  readonly compactScreens: boolean;
  readonly maxScreenSections?: number;
}

export interface FacetCatalog {
  readonly name: string;
  readonly description?: string;
  readonly theme: CatalogThemePolicy;
  readonly bricks: readonly CatalogBrick[];
  readonly stamps: CatalogStampsPolicy;
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

export const DEFAULT_CATALOG: FacetCatalog = {
  name: "default",
  description: "Default Facet catalog for compact product and app UI.",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: [
    { type: "box", guidance: "Primitive fallback for custom flow layout." },
    { type: "text", guidance: "Primitive fallback for freeform copy." },
    {
      type: "media",
      variants: ["default", "hero"],
      guidance: "Use for bounded image/video media.",
    },
    { type: "field", variants: ["default"], guidance: "Use for visitor input controls." },
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
    { type: "table", variants: ["default"], guidance: "Use for display-only tabular data." },
    { type: "chart", variants: ["default"], guidance: "Use for display-only chart data." },
    {
      type: "stat",
      variants: ["default", "success"],
      guidance: "Use for compact KPIs and metrics.",
    },
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
  ],
  stamps: { mode: "all" },
  primitiveFallback: "allowed",
  policy: {
    order: ["stamp", "brick", "primitive"],
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

function cloneStampsPolicy(stamps: CatalogStampsPolicy): CatalogStampsPolicy {
  return stamps.mode === "all" ? { mode: "all" } : { mode: "allow", names: [...stamps.names] };
}

function cloneUsagePolicy(policy: CatalogUsagePolicy): CatalogUsagePolicy {
  const cloned: {
    order: readonly ["stamp", "brick", "primitive"];
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...policy.order] as CatalogUsagePolicy["order"],
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
    stamps: CatalogStampsPolicy;
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
  return cloned;
}

function defaultCatalog(): FacetCatalog {
  return cloneCatalog(DEFAULT_CATALOG);
}

function isBrickType(value: unknown): value is FacetNode["type"] {
  return typeof value === "string" && (CATALOG_BRICK_TYPES as readonly string[]).includes(value);
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

function validateCatalogStamps(raw: unknown, issues: BoundedIssues): CatalogStampsPolicy {
  if (!isPlainObject(raw)) return cloneStampsPolicy(DEFAULT_CATALOG.stamps);
  if (raw.mode === "all") return { mode: "all" };
  if (raw.mode !== "allow") {
    issues.push(`catalog stamps: invalid mode ${printableValue(raw.mode)}; defaulted to all`);
    return cloneStampsPolicy(DEFAULT_CATALOG.stamps);
  }
  const names = themeNameList(raw.names, "stamps.names", issues);
  return { mode: "allow", names: names ?? [] };
}

function validateUsagePolicy(raw: unknown, issues: BoundedIssues): CatalogUsagePolicy {
  if (!isPlainObject(raw)) return cloneUsagePolicy(DEFAULT_CATALOG.policy);
  const policy: {
    order: readonly ["stamp", "brick", "primitive"];
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    order: [...DEFAULT_CATALOG.policy.order] as CatalogUsagePolicy["order"],
    editBeforeAppend:
      typeof raw.editBeforeAppend === "boolean"
        ? raw.editBeforeAppend
        : DEFAULT_CATALOG.policy.editBeforeAppend,
    compactScreens:
      typeof raw.compactScreens === "boolean"
        ? raw.compactScreens
        : DEFAULT_CATALOG.policy.compactScreens,
  };
  if (
    Array.isArray(raw.order) &&
    raw.order.length === 3 &&
    raw.order[0] === "stamp" &&
    raw.order[1] === "brick" &&
    raw.order[2] === "primitive"
  ) {
    policy.order = ["stamp", "brick", "primitive"];
  } else if (raw.order !== undefined) {
    issues.push("catalog policy: invalid order defaulted to stamp > brick > primitive");
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

  const catalog: {
    name: string;
    description?: string;
    theme: CatalogThemePolicy;
    bricks: readonly CatalogBrick[];
    stamps: CatalogStampsPolicy;
    primitiveFallback: "allowed" | "discouraged";
    policy: CatalogUsagePolicy;
  } = {
    name:
      typeof input.name === "string" && isValidThemeName(input.name)
        ? input.name
        : DEFAULT_CATALOG.name,
    theme: validateCatalogTheme(input.theme, issues),
    bricks: validateCatalogBricks(input.bricks, issues),
    stamps: validateCatalogStamps(input.stamps, issues),
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
