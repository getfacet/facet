import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import {
  evaluateCandidateModel,
  BOUNDS,
  parseMarkup,
  validateAuthorMarkup,
  validateCatalog,
  validateTheme,
  validateThemeExtensionDeclarations,
} from "@facet/core";
import type {
  ComponentDocument,
  ComponentSpec,
  DataModel,
  FacetCatalog,
  FacetTheme,
  FacetThemeExtensionDeclaration,
  MountedComponent,
} from "@facet/core";
import type { ReactNode } from "react";

export type QuickstartReadonlyDeepPartial<T> = T extends (...args: readonly never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly QuickstartReadonlyDeepPartial<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]?: QuickstartReadonlyDeepPartial<T[Key]> }
      : T;

export type QuickstartThemeOverlay = QuickstartReadonlyDeepPartial<FacetTheme>;

export type QuickstartDesignRegistryEntry = MountedComponent<ReactNode, ReactNode>;

export type QuickstartDesignRegistry = Readonly<Record<string, QuickstartDesignRegistryEntry>>;

export type QuickstartDesignExampleKind = "component" | "screen";

export interface QuickstartDesignExample {
  readonly id: string;
  readonly kind: QuickstartDesignExampleKind;
  readonly label: string;
  readonly markup: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly data?: DataModel;
}

export interface QuickstartResolvedDesignExample {
  readonly id: string;
  readonly kind: QuickstartDesignExampleKind;
  readonly label: string;
  readonly markup: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly data: DataModel;
  readonly document: ComponentDocument;
}

export interface QuickstartDesignNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface QuickstartDesignOverlay {
  readonly theme?: QuickstartThemeOverlay;
  readonly themeExtensions?: readonly FacetThemeExtensionDeclaration[];
  readonly components?: readonly ComponentSpec[];
  readonly registry?: QuickstartDesignRegistry;
  readonly examples?: readonly QuickstartDesignExample[];
  readonly notes?: readonly QuickstartDesignNote[];
}

export interface QuickstartResolvedDesign {
  readonly catalog: FacetCatalog;
  readonly theme: FacetTheme;
  readonly themeExtensions: readonly FacetThemeExtensionDeclaration[];
  readonly defaultRegistryTags: readonly string[];
  readonly customRegistry: QuickstartDesignRegistry;
  readonly customRegistryTags: readonly string[];
  readonly registryTags: readonly string[];
  readonly examples: readonly QuickstartResolvedDesignExample[];
  readonly notes: readonly QuickstartDesignNote[];
}

export interface QuickstartDesignOverlayError {
  readonly code: string;
  readonly at: string;
  readonly detail: string;
}

export type QuickstartDesignOverlayValidationResult =
  | { readonly ok: true; readonly design: QuickstartResolvedDesign }
  | { readonly ok: false; readonly error: QuickstartDesignOverlayError };

type ValidationFailure = Extract<QuickstartDesignOverlayValidationResult, { readonly ok: false }>;

type ComponentListResult =
  | {
      readonly ok: true;
      readonly components: readonly ComponentSpec[];
      readonly catalog: FacetCatalog;
      readonly customTags: readonly string[];
    }
  | ValidationFailure;

type RegistryResult =
  | {
      readonly ok: true;
      readonly registry: QuickstartDesignRegistry;
      readonly tags: readonly string[];
    }
  | ValidationFailure;

type ThemeResult =
  | {
      readonly ok: true;
      readonly theme: FacetTheme;
      readonly extensions: readonly FacetThemeExtensionDeclaration[];
    }
  | ValidationFailure;

type ExamplesResult =
  | { readonly ok: true; readonly examples: readonly QuickstartResolvedDesignExample[] }
  | ValidationFailure;

type NotesResult =
  { readonly ok: true; readonly notes: readonly QuickstartDesignNote[] } | ValidationFailure;

type MergeResult = { readonly ok: true; readonly value: unknown } | ValidationFailure;

const EMPTY_DATA: DataModel = Object.freeze({});
const EMPTY_REGISTRY: QuickstartDesignRegistry = Object.freeze({});
export const QUICKSTART_DESIGN_OVERLAY_KEYS = Object.freeze([
  "components",
  "examples",
  "notes",
  "registry",
  "theme",
  "themeExtensions",
] satisfies readonly (keyof QuickstartDesignOverlay)[]);
const EXAMPLE_KEYS: readonly string[] = [
  "data",
  "description",
  "id",
  "kind",
  "label",
  "markup",
  "tags",
];
const NOTE_KEYS: readonly string[] = ["body", "id", "title"];
const MAX_DESIGN_EXAMPLES = 64;
const MAX_DESIGN_NOTES = 32;
const MAX_DESIGN_DISPLAY_CHARS = BOUNDS.frameworkCopyChars;
const UNSAFE_OBJECT_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const DEFAULT_TAGS: readonly string[] = Object.freeze(
  DEFAULT_CATALOG.components.map((component) => component.tag),
);
const DEFAULT_TAG_SET: ReadonlySet<string> = new Set(DEFAULT_TAGS);

export function resolveQuickstartDesignOverlay(
  overlay: unknown,
): QuickstartDesignOverlayValidationResult {
  try {
    return resolveOverlay(overlay);
  } catch {
    return failure(
      "overlay_read_failed",
      "",
      "Reading the design module threw; it must be plain data plus callable registry entries.",
    );
  }
}

function resolveOverlay(overlay: unknown): QuickstartDesignOverlayValidationResult {
  if (!isRecord(overlay)) {
    return failure("overlay_not_an_object", "", "A design module must be a plain object.");
  }
  const unknownKey = firstUnknownKey(overlay, QUICKSTART_DESIGN_OVERLAY_KEYS);
  if (unknownKey !== undefined) {
    return failure("unknown_overlay_key", unknownKey, "The design module form is closed.");
  }

  const componentResult = resolveComponents(readOwn(overlay, "components"));
  if (!componentResult.ok) return componentResult;

  const registryResult = resolveRegistry(
    readOwn(overlay, "registry"),
    componentResult.customTags,
    DEFAULT_TAG_SET,
  );
  if (!registryResult.ok) return registryResult;

  const themeResult = resolveTheme(
    readOwn(overlay, "theme"),
    readOwn(overlay, "themeExtensions"),
    componentResult.catalog,
  );
  if (!themeResult.ok) return themeResult;

  const examplesResult = resolveExamples(readOwn(overlay, "examples"), componentResult.catalog);
  if (!examplesResult.ok) return examplesResult;

  const notesResult = resolveNotes(readOwn(overlay, "notes"));
  if (!notesResult.ok) return notesResult;

  return {
    ok: true,
    design: Object.freeze({
      catalog: componentResult.catalog,
      theme: themeResult.theme,
      themeExtensions: themeResult.extensions,
      defaultRegistryTags: DEFAULT_TAGS,
      customRegistry: registryResult.registry,
      customRegistryTags: registryResult.tags,
      registryTags: Object.freeze([...DEFAULT_TAGS, ...registryResult.tags]),
      examples: examplesResult.examples,
      notes: notesResult.notes,
    }),
  };
}

function resolveComponents(raw: unknown): ComponentListResult {
  if (raw === undefined) {
    return {
      ok: true,
      components: Object.freeze([]),
      catalog: DEFAULT_CATALOG,
      customTags: Object.freeze([]),
    };
  }
  if (!Array.isArray(raw)) {
    return failure("components_not_an_array", "components", "Components must be an array.");
  }

  const tags = new Set<string>();
  const customTags: string[] = [];
  const components: ComponentSpec[] = [];
  for (const [index, component] of raw.entries()) {
    if (isRecord(component)) {
      const tag = component["tag"];
      if (typeof tag === "string") {
        if (DEFAULT_TAG_SET.has(tag)) {
          return failure(
            "default_component_replacement",
            `components[${String(index)}].tag`,
            "Design modules may not replace default component tags in v1.",
          );
        }
        if (tags.has(tag)) {
          return failure(
            "duplicate_custom_component",
            `components[${String(index)}].tag`,
            "Design modules may declare each custom tag only once.",
          );
        }
        tags.add(tag);
        customTags.push(tag);
      }
    }
    components.push(component as ComponentSpec);
  }

  const catalogResult = validateCatalog({
    components: [...DEFAULT_CATALOG.components, ...components],
  });
  if (!catalogResult.ok) {
    return failure(
      "catalog_invalid",
      overlayCatalogLocation(catalogResult.at),
      `${catalogResult.code}: ${catalogResult.detail}`,
    );
  }

  return {
    ok: true,
    components: Object.freeze(components),
    catalog: catalogResult.catalog,
    customTags: Object.freeze(customTags),
  };
}

function resolveRegistry(
  raw: unknown,
  customTags: readonly string[],
  defaultTags: ReadonlySet<string>,
): RegistryResult {
  if (raw === undefined) {
    if (customTags.length === 0) {
      return { ok: true, registry: EMPTY_REGISTRY, tags: Object.freeze([]) };
    }
    return failure(
      "missing_registry_entry",
      `registry.${customTags[0]}`,
      "Every additive component spec must have a callable registry entry.",
    );
  }
  if (!isRecord(raw)) {
    return failure("registry_not_an_object", "registry", "The registry must be a plain object.");
  }

  const customTagSet = new Set(customTags);
  const registry: Record<string, QuickstartDesignRegistryEntry> = {};
  for (const tag of Object.keys(raw).sort()) {
    if (defaultTags.has(tag)) {
      return failure(
        "default_registry_replacement",
        `registry.${tag}`,
        "Design modules may not replace default registry entries in v1.",
      );
    }
    if (!customTagSet.has(tag)) {
      return failure(
        "unknown_registry_entry",
        `registry.${tag}`,
        "Every design module registry entry must match an additive component spec.",
      );
    }
    const entry = raw[tag];
    if (typeof entry !== "function") {
      return failure(
        "registry_entry_not_callable",
        `registry.${tag}`,
        "Registry entries must be callable trusted component implementations.",
      );
    }
    registry[tag] = entry as QuickstartDesignRegistryEntry;
  }

  for (const tag of customTags) {
    if (registry[tag] === undefined) {
      return failure(
        "missing_registry_entry",
        `registry.${tag}`,
        "Every additive component spec must have a callable registry entry.",
      );
    }
  }

  return { ok: true, registry: Object.freeze(registry), tags: Object.freeze([...customTags]) };
}

function resolveTheme(
  rawTheme: unknown,
  rawExtensions: unknown,
  catalog: FacetCatalog,
): ThemeResult {
  const extensionsResult =
    rawExtensions === undefined
      ? { ok: true as const, extensions: Object.freeze([]) }
      : validateThemeExtensionDeclarations(rawExtensions);
  if (!extensionsResult.ok) {
    return failure(
      "theme_extensions_invalid",
      extensionsResult.at,
      `${extensionsResult.code}: ${extensionsResult.detail}`,
    );
  }

  const mergeResult =
    rawTheme === undefined
      ? { ok: true as const, value: DEFAULT_THEME }
      : mergeThemeOverlay(DEFAULT_THEME, rawTheme, "theme", new WeakSet<object>());
  if (!mergeResult.ok) return mergeResult;

  const themeResult = validateTheme(mergeResult.value, {
    catalog,
    extensions: extensionsResult.extensions,
  });
  if (!themeResult.ok) {
    return failure(
      "theme_invalid",
      prefixLocation("theme", themeResult.at),
      `${themeResult.code}: ${themeResult.detail}`,
    );
  }

  return {
    ok: true,
    theme:
      rawTheme === undefined && catalog === DEFAULT_CATALOG ? DEFAULT_THEME : themeResult.theme,
    extensions: extensionsResult.extensions,
  };
}

function resolveExamples(raw: unknown, catalog: FacetCatalog): ExamplesResult {
  if (raw === undefined) return { ok: true, examples: Object.freeze([]) };
  if (!Array.isArray(raw)) {
    return failure("examples_not_an_array", "examples", "Examples must be an array.");
  }
  if (raw.length > MAX_DESIGN_EXAMPLES) {
    return failure(
      "too_many_examples",
      "examples",
      `Design modules may declare at most ${String(MAX_DESIGN_EXAMPLES)} examples.`,
    );
  }

  const examples: QuickstartResolvedDesignExample[] = [];
  const ids = new Set<string>();
  const catalogTags = new Set(catalog.components.map((component) => component.tag));
  for (const [index, value] of raw.entries()) {
    const at = `examples[${String(index)}]`;
    const example = resolveExample(value, at, catalog, catalogTags);
    if (!example.ok) return example;
    if (ids.has(example.example.id)) {
      return failure("duplicate_example_id", `${at}.id`, "Design example ids must be unique.");
    }
    ids.add(example.example.id);
    examples.push(example.example);
  }
  return { ok: true, examples: Object.freeze(examples) };
}

function resolveExample(
  value: unknown,
  at: string,
  catalog: FacetCatalog,
  catalogTags: ReadonlySet<string>,
): { readonly ok: true; readonly example: QuickstartResolvedDesignExample } | ValidationFailure {
  if (!isRecord(value)) {
    return failure("example_not_an_object", at, "Each design example must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, EXAMPLE_KEYS);
  if (unknownKey !== undefined) {
    return failure(
      "unknown_example_key",
      `${at}.${unknownKey}`,
      "The design example form is closed.",
    );
  }

  const id = requiredString(
    readOwn(value, "id"),
    `${at}.id`,
    "invalid_design_string",
    BOUNDS.identifierChars,
  );
  if (!id.ok) return id;
  const kind = exampleKind(readOwn(value, "kind"), `${at}.kind`);
  if (!kind.ok) return kind;
  const label = requiredString(
    readOwn(value, "label"),
    `${at}.label`,
    "invalid_design_string",
    MAX_DESIGN_DISPLAY_CHARS,
  );
  if (!label.ok) return label;
  const markup = requiredString(
    readOwn(value, "markup"),
    `${at}.markup`,
    "invalid_example_markup",
    BOUNDS.markupSourceChars,
  );
  if (!markup.ok) return markup;
  const description = optionalString(readOwn(value, "description"), `${at}.description`);
  if (!description.ok) return description;
  const tags = exampleTags(readOwn(value, "tags"), `${at}.tags`, catalogTags);
  if (!tags.ok) return tags;
  const data = exampleData(readOwn(value, "data"), `${at}.data`);
  if (!data.ok) return data;

  const parsed = parseMarkup(markup.value);
  if (!parsed.ok) {
    return failure(
      "example_markup_invalid",
      `${at}.markup`,
      `${parsed.error.code}: ${parsed.error.cause}`,
    );
  }
  const validated = validateAuthorMarkup(parsed.ast, catalog, data.model);
  if (!validated.ok) {
    return failure(
      "example_markup_invalid",
      `${at}.markup`,
      `${validated.error.code}: ${validated.error.cause}`,
    );
  }

  return {
    ok: true,
    example: Object.freeze({
      id: id.value,
      kind: kind.value,
      label: label.value,
      markup: markup.value,
      ...(description.value === undefined ? {} : { description: description.value }),
      tags: tags.tags,
      data: data.model,
      document: validated.document,
    }),
  };
}

function resolveNotes(raw: unknown): NotesResult {
  if (raw === undefined) return { ok: true, notes: Object.freeze([]) };
  if (!Array.isArray(raw)) return failure("notes_not_an_array", "notes", "Notes must be an array.");
  if (raw.length > MAX_DESIGN_NOTES) {
    return failure(
      "too_many_notes",
      "notes",
      `Design modules may declare at most ${String(MAX_DESIGN_NOTES)} notes.`,
    );
  }

  const notes: QuickstartDesignNote[] = [];
  const ids = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const at = `notes[${String(index)}]`;
    if (!isRecord(value)) {
      return failure("note_not_an_object", at, "Each design note must be a plain object.");
    }
    const unknownKey = firstUnknownKey(value, NOTE_KEYS);
    if (unknownKey !== undefined) {
      return failure("unknown_note_key", `${at}.${unknownKey}`, "The design note form is closed.");
    }
    const id = requiredString(
      readOwn(value, "id"),
      `${at}.id`,
      "invalid_design_string",
      BOUNDS.identifierChars,
    );
    if (!id.ok) return id;
    if (ids.has(id.value)) {
      return failure("duplicate_note_id", `${at}.id`, "Design note ids must be unique.");
    }
    ids.add(id.value);
    const title = requiredString(
      readOwn(value, "title"),
      `${at}.title`,
      "invalid_design_string",
      MAX_DESIGN_DISPLAY_CHARS,
    );
    if (!title.ok) return title;
    const body = requiredString(
      readOwn(value, "body"),
      `${at}.body`,
      "invalid_design_string",
      MAX_DESIGN_DISPLAY_CHARS,
    );
    if (!body.ok) return body;
    notes.push(Object.freeze({ id: id.value, title: title.value, body: body.value }));
  }
  return { ok: true, notes: Object.freeze(notes) };
}

function mergeThemeOverlay(
  base: unknown,
  overlay: unknown,
  at: string,
  seen: WeakSet<object>,
): MergeResult {
  if (!isRecord(base) || !isRecord(overlay)) {
    return { ok: true, value: overlay };
  }
  if (seen.has(overlay)) {
    return failure("overlay_cycle", at, "Design values must be acyclic plain data.");
  }
  seen.add(overlay);
  const merged: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    merged[key] = readOwn(base, key);
  }
  for (const key of Object.keys(overlay)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      return failure(
        "unsafe_design_key",
        `${at}.${key}`,
        "Design values may not use object prototype keys.",
      );
    }
    const value = mergeThemeOverlay(
      readOwn(base, key),
      readOwn(overlay, key),
      `${at}.${key}`,
      seen,
    );
    if (!value.ok) return value;
    merged[key] = value.value;
  }
  seen.delete(overlay);
  return { ok: true, value: Object.freeze(merged) };
}

function exampleData(
  value: unknown,
  at: string,
): { readonly ok: true; readonly model: DataModel } | ValidationFailure {
  if (value === undefined) return { ok: true, model: EMPTY_DATA };
  const result = evaluateCandidateModel(value);
  if (!result.ok) {
    return failure(
      "example_data_invalid",
      at,
      `${result.reason}${result.bound === null ? "" : ` (${result.bound})`} at ${result.path}`,
    );
  }
  return { ok: true, model: result.model };
}

function exampleTags(
  value: unknown,
  at: string,
  catalogTags: ReadonlySet<string>,
): { readonly ok: true; readonly tags: readonly string[] } | ValidationFailure {
  if (value === undefined) return { ok: true, tags: Object.freeze([]) };
  if (!Array.isArray(value)) {
    return failure("invalid_example_tags", at, "Example tags must be an array of strings.");
  }
  const tags: string[] = [];
  for (const [index, tag] of value.entries()) {
    if (typeof tag !== "string") {
      return failure(
        "invalid_example_tags",
        `${at}[${String(index)}]`,
        "Example tags must be strings.",
      );
    }
    if (!catalogTags.has(tag)) {
      return failure(
        "unknown_example_tag",
        `${at}[${String(index)}]`,
        "Example tags must be registered in the active catalog.",
      );
    }
    tags.push(tag);
  }
  return { ok: true, tags: Object.freeze(tags) };
}

function exampleKind(
  value: unknown,
  at: string,
): { readonly ok: true; readonly value: QuickstartDesignExampleKind } | ValidationFailure {
  if (value === "component" || value === "screen") return { ok: true, value };
  return failure("invalid_example_kind", at, "Example kind must be `component` or `screen`.");
}

function requiredString(
  value: unknown,
  at: string,
  code = "invalid_design_string",
  maxChars: number = MAX_DESIGN_DISPLAY_CHARS,
): { readonly ok: true; readonly value: string } | ValidationFailure {
  if (typeof value === "string" && value.length > 0 && value.length <= maxChars) {
    return { ok: true, value };
  }
  if (typeof value === "string" && value.length > maxChars) {
    return failure(
      "design_string_too_long",
      at,
      `Expected a string at most ${String(maxChars)} characters long.`,
    );
  }
  return failure(code, at, "Expected a non-empty string.");
}

function optionalString(
  value: unknown,
  at: string,
): { readonly ok: true; readonly value: string | undefined } | ValidationFailure {
  if (value === undefined) return { ok: true, value };
  if (typeof value === "string" && value.length <= MAX_DESIGN_DISPLAY_CHARS) {
    return { ok: true, value };
  }
  if (typeof value === "string") {
    return failure(
      "design_string_too_long",
      at,
      `Expected a string at most ${String(MAX_DESIGN_DISPLAY_CHARS)} characters long.`,
    );
  }
  return failure("invalid_design_string", at, "Expected a string when present.");
}

function overlayCatalogLocation(at: string): string {
  const match = /^components\[(\d+)\](.*)$/u.exec(at);
  if (match === null) return prefixLocation("components", at);
  const rawIndex = Number(match[1]);
  const overlayIndex = rawIndex - DEFAULT_CATALOG.components.length;
  if (!Number.isInteger(overlayIndex) || overlayIndex < 0) return prefixLocation("components", at);
  return `components[${String(overlayIndex)}]${match[2] ?? ""}`;
}

function prefixLocation(prefix: string, at: string): string {
  return at.length === 0 ? prefix : `${prefix}.${at}`;
}

function firstUnknownKey(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(value)
    .sort()
    .find((key) => !allowed.includes(key));
}

function failure(code: string, at: string, detail: string): ValidationFailure {
  return { ok: false, error: { code, at, detail } };
}

function readOwn(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
