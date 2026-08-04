import { DEFAULT_CATALOG } from "@facet/assets";
import type {
  ComponentSpec,
  FacetCatalog,
  FacetThemeTokenValueKind,
  PropSchema,
} from "@facet/core";

export type ComponentPresentationSection =
  "layout" | "surface" | "expression" | "content" | "interactive" | "other";

export interface ComponentPresentation {
  readonly section: ComponentPresentationSection;
  readonly label: string;
  readonly order: number;
}

export interface ComponentPropMetadata {
  readonly name: string;
  readonly type: PropSchema["type"];
  readonly guidance: string;
  readonly required: boolean;
  readonly bindable: boolean;
  readonly defaultValue: string | null;
  readonly enumValues: readonly string[];
  readonly rangeLabel: string | null;
}

export interface ComponentCollectMetadata {
  readonly valueProp: string;
  readonly sensitiveProp: string | null;
}

export interface ComponentThemeRecipeTokenMetadata {
  readonly name: string;
  readonly kind: FacetThemeTokenValueKind;
}

export interface ComponentThemeRecipeMetadata {
  readonly tokens: readonly ComponentThemeRecipeTokenMetadata[];
}

export interface ComponentInspectorRow {
  readonly tag: string;
  readonly presentation: ComponentPresentation;
  readonly whenToUse: string;
  readonly acceptsChildren: boolean;
  readonly props: readonly ComponentPropMetadata[];
  readonly collect: ComponentCollectMetadata | null;
  readonly themeRecipe: ComponentThemeRecipeMetadata | null;
}

function presentation(
  section: ComponentPresentationSection,
  label: string,
  order: number,
): ComponentPresentation {
  return Object.freeze({ section, label, order });
}

export const DEFAULT_COMPONENT_PRESENTATION_BY_TAG: Readonly<
  Record<string, ComponentPresentation>
> = Object.freeze({
  Screen: presentation("layout", "Layout", 0),
  AppShell: presentation("layout", "Layout", 1),
  Stack: presentation("layout", "Layout", 2),
  Row: presentation("layout", "Layout", 3),
  Split: presentation("layout", "Layout", 4),
  Grid: presentation("layout", "Layout", 5),
  Modal: presentation("surface", "Surfaces", 6),
  Card: presentation("surface", "Surfaces", 7),
  Empty: presentation("surface", "Surfaces", 8),
  LogoMark: presentation("expression", "Expression", 9),
  Nav: presentation("expression", "Expression", 10),
  SideNav: presentation("expression", "Expression", 11),
  SideNavItem: presentation("expression", "Expression", 12),
  Section: presentation("expression", "Expression", 13),
  Divider: presentation("expression", "Expression", 14),
  Hero: presentation("expression", "Expression", 15),
  Avatar: presentation("expression", "Expression", 16),
  ProfileHeader: presentation("expression", "Expression", 17),
  ProductShowcase: presentation("expression", "Expression", 18),
  VisualPanel: presentation("expression", "Expression", 19),
  MediaCard: presentation("expression", "Expression", 20),
  LinkList: presentation("expression", "Expression", 21),
  SocialLinks: presentation("expression", "Expression", 22),
  FeatureList: presentation("expression", "Expression", 23),
  StatStrip: presentation("expression", "Expression", 24),
  Gallery: presentation("expression", "Expression", 25),
  Testimonial: presentation("expression", "Expression", 26),
  Timeline: presentation("expression", "Expression", 27),
  CTA: presentation("expression", "Expression", 28),
  Alert: presentation("expression", "Expression", 29),
  Progress: presentation("expression", "Expression", 30),
  Footer: presentation("expression", "Expression", 31),
  Text: presentation("content", "Content", 32),
  Metric: presentation("content", "Content", 33),
  Badge: presentation("content", "Content", 34),
  Table: presentation("content", "Content", 35),
  Button: presentation("interactive", "Interactive", 36),
  Field: presentation("interactive", "Interactive", 37),
});

const OTHER_PRESENTATION = presentation("other", "Other", Number.MAX_SAFE_INTEGER);

function presentationForTag(tag: string): ComponentPresentation {
  return DEFAULT_COMPONENT_PRESENTATION_BY_TAG[tag] ?? OTHER_PRESENTATION;
}

function enumValuesFor(schema: PropSchema): readonly string[] {
  if (!("enum" in schema) || schema.enum === undefined) {
    return [];
  }
  return Object.freeze(schema.enum.map((value) => String(value)));
}

function defaultValueFor(schema: PropSchema): string | null {
  if (!("default" in schema) || schema.default === undefined) {
    return null;
  }
  return String(schema.default);
}

function rangeLabelFor(schema: PropSchema): string | null {
  if (schema.type !== "number") {
    return null;
  }
  if (schema.minimum === undefined && schema.maximum === undefined) {
    return null;
  }
  if (schema.minimum !== undefined && schema.maximum !== undefined) {
    return `${schema.minimum}-${schema.maximum}`;
  }
  if (schema.minimum !== undefined) {
    return `>= ${schema.minimum}`;
  }
  return `<= ${schema.maximum}`;
}

function propMetadata(name: string, schema: PropSchema): ComponentPropMetadata {
  return Object.freeze({
    name,
    type: schema.type,
    guidance: schema.guidance,
    required: schema.required === true,
    bindable: schema.bindable === true,
    defaultValue: defaultValueFor(schema),
    enumValues: enumValuesFor(schema),
    rangeLabel: rangeLabelFor(schema),
  });
}

function collectMetadata(spec: ComponentSpec): ComponentCollectMetadata | null {
  if (spec.collect === undefined) {
    return null;
  }
  return Object.freeze({
    valueProp: spec.collect.valueProp,
    sensitiveProp: spec.collect.sensitiveProp ?? null,
  });
}

function themeRecipeMetadata(spec: ComponentSpec): ComponentThemeRecipeMetadata | null {
  if (spec.themeRecipe === undefined) {
    return null;
  }
  return Object.freeze({
    tokens: Object.freeze(
      Object.entries(spec.themeRecipe.tokens).map(([name, kind]) => {
        return Object.freeze({ name, kind });
      }),
    ),
  });
}

function rowForSpec(spec: ComponentSpec): ComponentInspectorRow {
  return Object.freeze({
    tag: spec.tag,
    presentation: presentationForTag(spec.tag),
    whenToUse: spec.whenToUse,
    acceptsChildren: spec.acceptsChildren,
    props: Object.freeze(
      Object.entries(spec.props).map(([name, schema]) => propMetadata(name, schema)),
    ),
    collect: collectMetadata(spec),
    themeRecipe: themeRecipeMetadata(spec),
  });
}

export function deriveComponentInspectorRows(
  catalog: FacetCatalog = DEFAULT_CATALOG,
): readonly ComponentInspectorRow[] {
  return Object.freeze(catalog.components.map((spec) => rowForSpec(spec)));
}
