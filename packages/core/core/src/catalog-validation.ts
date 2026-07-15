import type { BrickType } from "./nodes.js";
import { boundedDescription, BoundedIssues, isPlainObject, printableValue } from "./issues.js";
import { isValidThemeName, MAX_DESCRIPTION_LENGTH } from "./theme.js";
import {
  cloneCatalogBricks,
  cloneCompositionsPolicy,
  cloneThemePolicy,
  cloneUsagePolicy,
  DEFAULT_CATALOG,
  defaultCatalog,
} from "./catalog-defaults.js";
import {
  CATALOG_BRICK_TYPES,
  type CatalogBrick,
  type CatalogCompositionsPolicy,
  type CatalogThemePolicy,
  type CatalogUsagePolicy,
  type CatalogValidationResult,
} from "./catalog-types.js";

const MAX_CATALOG_ITEMS = 128;
const MAX_CATALOG_POLICY_COUNT = 32;
const MAX_SCREEN_SECTIONS = 20;

function isBrickType(value: unknown): value is BrickType {
  return typeof value === "string" && (CATALOG_BRICK_TYPES as readonly string[]).includes(value);
}

function boundedNameList(
  raw: unknown,
  field: string,
  label: "name" | "variant",
  issues: BoundedIssues,
): readonly string[] | undefined {
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
  if (out.length === 0) {
    issues.push(`catalog ${field}: no valid entries — restriction kept empty`);
    return [];
  }
  return out;
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
  const allowed = boundedNameList(raw.allowed, "theme.allowed", "name", issues);
  if (allowed !== undefined) policy.allowed = allowed;
  return policy;
}

function validateCatalogBricks(
  raw: readonly unknown[],
  issues: BoundedIssues,
): readonly CatalogBrick[] {
  const bricks: CatalogBrick[] = [];
  for (const item of raw.slice(0, MAX_CATALOG_ITEMS)) {
    if (!isPlainObject(item) || !isBrickType(item.type)) {
      issues.push(
        `catalog bricks: unknown type ${printableValue(isPlainObject(item) ? item.type : item)} dropped`,
      );
      continue;
    }
    const brick: { type: BrickType; variants?: readonly string[]; guidance?: string } = {
      type: item.type,
    };
    const variants = boundedNameList(
      item.variants,
      `bricks.${item.type}.variants`,
      "variant",
      issues,
    );
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
  if (bricks.length === 0) {
    issues.push(
      "catalog bricks: provided restriction list validated to empty; no catalog bricks allowed",
    );
  }
  return bricks;
}

function validateCatalogCompositions(
  raw: unknown,
  issues: BoundedIssues,
): CatalogCompositionsPolicy {
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
  const names = boundedNameList(raw.names, "compositions.names", "name", issues);
  if (names === undefined) {
    issues.push("catalog compositions.names: no valid entries — restriction kept empty");
    return { mode: "allow", names: [] };
  }
  return { mode: "allow", names };
}

function validateUsagePolicy(raw: unknown, issues: BoundedIssues): CatalogUsagePolicy {
  if (!isPlainObject(raw)) {
    if (raw !== undefined) issues.push("catalog policy: expected an edit policy object; defaulted");
    return cloneUsagePolicy(DEFAULT_CATALOG.policy);
  }
  const policy: {
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
    editBeforeAppend:
      typeof raw.editBeforeAppend === "boolean"
        ? raw.editBeforeAppend
        : DEFAULT_CATALOG.policy.editBeforeAppend,
    compactScreens:
      typeof raw.compactScreens === "boolean"
        ? raw.compactScreens
        : DEFAULT_CATALOG.policy.compactScreens,
  };
  if (raw.editBeforeAppend !== undefined && typeof raw.editBeforeAppend !== "boolean") {
    issues.push("catalog policy: invalid editBeforeAppend defaulted");
  }
  if (raw.compactScreens !== undefined && typeof raw.compactScreens !== "boolean") {
    issues.push("catalog policy: invalid compactScreens defaulted");
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

function validateBrickRestriction(
  input: Readonly<Record<string, unknown>>,
  issues: BoundedIssues,
): readonly CatalogBrick[] {
  const bricksProvided = input.bricks !== undefined;
  let bricks: readonly CatalogBrick[];
  if (Array.isArray(input.bricks)) {
    bricks = validateCatalogBricks(input.bricks, issues);
  } else if (bricksProvided) {
    issues.push("catalog bricks: expected an array; restriction kept empty");
    bricks = [];
  } else {
    bricks = cloneCatalogBricks(DEFAULT_CATALOG.bricks);
  }
  return bricks;
}

function validateCatalogUnsafe(input: unknown, issues: BoundedIssues): CatalogValidationResult {
  if (input === undefined) return { catalog: defaultCatalog(), issues: issues.list };
  if (!isPlainObject(input)) {
    issues.push("catalog is not an object; default catalog used");
    return { catalog: defaultCatalog(), issues: issues.list };
  }

  const bricks = validateBrickRestriction(input, issues);
  const catalog: {
    name: string;
    description?: string;
    theme: CatalogThemePolicy;
    bricks: readonly CatalogBrick[];
    compositions: CatalogCompositionsPolicy;
    policy: CatalogUsagePolicy;
  } = {
    name:
      typeof input.name === "string" && isValidThemeName(input.name)
        ? input.name
        : DEFAULT_CATALOG.name,
    theme: validateCatalogTheme(input.theme, issues),
    bricks,
    compositions: validateCatalogCompositions(input.compositions, issues),
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
