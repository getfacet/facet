import type { ComponentNodeType, FacetNode } from "./nodes.js";
import type {
  CatalogBrick,
  CatalogComponent,
  CatalogCompositionsPolicy,
  CatalogThemePolicy,
  CatalogUsageOrder,
  CatalogUsagePolicy,
  FacetCatalog,
} from "./catalog-types.js";
import { CANONICAL_CATALOG_USAGE_ORDER } from "./catalog-policy.js";

export const DEFAULT_COMPONENTS: readonly CatalogComponent[] = [
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
    order: CANONICAL_CATALOG_USAGE_ORDER,
    editBeforeAppend: true,
    compactScreens: true,
    maxScreenSections: 6,
  },
};

export function cloneThemePolicy(theme: CatalogThemePolicy): CatalogThemePolicy {
  const cloned: {
    active?: string;
    switchPolicy: "locked" | "allowed";
    allowed?: readonly string[];
  } = { switchPolicy: theme.switchPolicy };
  if (theme.active !== undefined) cloned.active = theme.active;
  if (theme.allowed !== undefined) cloned.allowed = [...theme.allowed];
  return cloned;
}

export function cloneCatalogBrick(brick: CatalogBrick): CatalogBrick {
  const cloned: { type: FacetNode["type"]; variants?: readonly string[]; guidance?: string } = {
    type: brick.type,
  };
  if (brick.variants !== undefined) cloned.variants = [...brick.variants];
  if (brick.guidance !== undefined) cloned.guidance = brick.guidance;
  return cloned;
}

export function cloneCatalogBricks(bricks: readonly CatalogBrick[]): readonly CatalogBrick[] {
  return bricks.map(cloneCatalogBrick);
}

export function cloneCatalogComponent(component: CatalogComponent): CatalogComponent {
  const cloned: { type: ComponentNodeType; variants?: readonly string[]; guidance?: string } = {
    type: component.type,
  };
  if (component.variants !== undefined) cloned.variants = [...component.variants];
  if (component.guidance !== undefined) cloned.guidance = component.guidance;
  return cloned;
}

export function cloneCatalogComponents(
  components: readonly CatalogComponent[],
): readonly CatalogComponent[] {
  return components.map(cloneCatalogComponent);
}

export function cloneCompositionsPolicy(
  compositions: CatalogCompositionsPolicy,
): CatalogCompositionsPolicy {
  return compositions.mode === "all"
    ? { mode: "all" }
    : { mode: "allow", names: [...compositions.names] };
}

export function cloneUsagePolicy(policy: CatalogUsagePolicy): CatalogUsagePolicy {
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

export function cloneCatalog(catalog: FacetCatalog): FacetCatalog {
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

export function defaultCatalog(): FacetCatalog {
  return cloneCatalog(DEFAULT_CATALOG);
}
