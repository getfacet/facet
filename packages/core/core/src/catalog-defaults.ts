import type { BrickType } from "./nodes.js";
import type {
  CatalogBrick,
  CatalogCompositionsPolicy,
  CatalogThemePolicy,
  CatalogUsagePolicy,
  FacetCatalog,
} from "./catalog-types.js";

const DEFAULT_BRICKS: readonly CatalogBrick[] = [
  { type: "box", guidance: "Compose safe flow layout, containers, and pressable controls." },
  { type: "text", guidance: "Render copy or a single bound dataset cell." },
  {
    type: "media",
    variants: ["default", "hero"],
    guidance: "Render bounded image or video media.",
  },
  {
    type: "input",
    variants: ["default"],
    guidance: "Collect visitor values inside a containing box.",
  },
  { type: "richtext", guidance: "Render formatted prose with safe inline marks and links." },
  { type: "table", variants: ["default"], guidance: "Render display-only tabular data." },
  { type: "chart", variants: ["default"], guidance: "Render display-only chart data." },
  {
    type: "list",
    variants: ["default", "compact"],
    guidance: "Render capped task or summary lists.",
  },
  {
    type: "keyValue",
    variants: ["default"],
    guidance: "Render compact label and value details.",
  },
  {
    type: "progress",
    variants: ["default", "success"],
    guidance: "Render bounded percentage progress.",
  },
  { type: "loading", variants: ["default"], guidance: "Render pending and busy states." },
];

export const DEFAULT_CATALOG: FacetCatalog = {
  name: "default",
  description: "Default Facet catalog for compact product and app UI.",
  theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
  bricks: DEFAULT_BRICKS,
  compositions: { mode: "all" },
  policy: {
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
  const cloned: { type: BrickType; variants?: readonly string[]; guidance?: string } = {
    type: brick.type,
  };
  if (brick.variants !== undefined) cloned.variants = [...brick.variants];
  if (brick.guidance !== undefined) cloned.guidance = brick.guidance;
  return cloned;
}

export function cloneCatalogBricks(bricks: readonly CatalogBrick[]): readonly CatalogBrick[] {
  return bricks.map(cloneCatalogBrick);
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
    editBeforeAppend: boolean;
    compactScreens: boolean;
    maxScreenSections?: number;
  } = {
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
    compositions: CatalogCompositionsPolicy;
    policy: CatalogUsagePolicy;
  } = {
    name: catalog.name,
    theme: cloneThemePolicy(catalog.theme),
    bricks: cloneCatalogBricks(catalog.bricks),
    compositions: cloneCompositionsPolicy(catalog.compositions),
    policy: cloneUsagePolicy(catalog.policy),
  };
  if (catalog.description !== undefined) cloned.description = catalog.description;
  return cloned;
}

export function defaultCatalog(): FacetCatalog {
  return cloneCatalog(DEFAULT_CATALOG);
}
