import { COMPONENT_NODE_TYPES, type ComponentNodeType, type FacetNode } from "./nodes.js";
import { boundedDescription, BoundedIssues, isPlainObject, printableValue } from "./issues.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";
import {
  cloneCatalogBrick,
  cloneCatalogBricks,
  cloneCatalogComponent,
  cloneCatalogComponents,
  cloneCompositionsPolicy,
  cloneThemePolicy,
  cloneUsagePolicy,
  DEFAULT_CATALOG,
  DEFAULT_COMPONENTS,
  defaultCatalog,
} from "./catalog-defaults.js";
import {
  CATALOG_BRICK_TYPES,
  type CatalogBrick,
  type CatalogComponent,
  type CatalogCompositionsPolicy,
  type CatalogThemePolicy,
  type CatalogUsageOrder,
  type CatalogUsagePolicy,
  type CatalogValidationResult,
} from "./catalog-types.js";

const MAX_CATALOG_ITEMS = 128;
const MAX_CATALOG_POLICY_COUNT = 32;
const MAX_SCREEN_SECTIONS = 20;

const CANONICAL_USAGE_ORDER = ["composition", "component", "primitive"] as const;

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
