import { DEFAULT_CATALOG } from "@facet/assets";
import { deriveComponentContentClass } from "@facet/core";
import type {
  ComponentContentClass,
  ComponentContentSpec,
  ComponentSpec,
  CollectedValueKind,
  FacetCatalog,
  FacetThemeTokenValueKind,
  PropSchema,
} from "@facet/core";

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
  readonly valueKind: CollectedValueKind;
  readonly sensitiveProp: string | null;
}

export interface ComponentSlotMetadata {
  readonly name: string;
  readonly guidance: string;
  readonly minChildren: number;
  readonly maxChildren: number;
  readonly allowedTags: readonly string[];
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
  readonly source: "default" | "imported";
  readonly whenToUse: string;
  readonly contentClass: ComponentContentClass;
  readonly contentMode: ComponentContentSpec["mode"];
  readonly slots: readonly ComponentSlotMetadata[];
  readonly props: readonly ComponentPropMetadata[];
  readonly collect: ComponentCollectMetadata | null;
  readonly themeRecipe: ComponentThemeRecipeMetadata | null;
}
const DEFAULT_COMPONENT_TAGS: ReadonlySet<string> = new Set(
  DEFAULT_CATALOG.components.map((component) => component.tag),
);

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
    valueKind: spec.collect.valueKind,
    sensitiveProp: spec.collect.sensitiveProp ?? null,
  });
}

function slotMetadata(spec: ComponentSpec): readonly ComponentSlotMetadata[] {
  if (spec.content.mode !== "slots") {
    return Object.freeze([]);
  }
  return Object.freeze(
    Object.entries(spec.content.slots).map(([name, slot]) =>
      Object.freeze({
        name,
        guidance: slot.guidance,
        minChildren: slot.minChildren,
        maxChildren: slot.maxChildren,
        allowedTags: Object.freeze([...(slot.allowedTags ?? [])]),
      }),
    ),
  );
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
    source: DEFAULT_COMPONENT_TAGS.has(spec.tag) ? "default" : "imported",
    whenToUse: spec.whenToUse,
    contentClass: deriveComponentContentClass(spec.content),
    contentMode: spec.content.mode,
    slots: slotMetadata(spec),
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
