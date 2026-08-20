import {
  BOUNDS,
  buildCatalogIndex,
  evaluateCandidateModel,
  FACET_THEME_CONTRACT,
  facetThemeToKebabCase,
  isFacetIdentifier,
  NEUTRAL_COPY_DEFAULTS,
  parseAuthoredNumber,
  parseDataPath,
  resolveNeutralCopy,
  validateCatalog,
  validateFacetAssetRegistry,
  validateTheme,
  validateThemeExtensionDeclarations,
} from "@facet/core";
import type {
  CasOutcome,
  ComponentDocument,
  ComponentNode,
  ComponentSpec,
  DataModel,
  FacetAssetRegistry,
  FacetCatalog,
  FacetTheme,
  FacetThemeExtensionDeclaration,
  FacetThemeTokenValues,
  NeutralCopy,
  PropSchema,
  StageRevision,
} from "@facet/core";

import type { Session } from "./session.js";

export interface SessionIssue {
  readonly code: string;
  readonly at: string;
  readonly detail: string;
}

export interface StageStore {
  get(key: string): Promise<unknown | null>;
  save(
    key: string,
    session: Session,
    expectedRevision: StageRevision,
    guard?: () => boolean,
  ): Promise<CasOutcome>;
}

type StoredProp = ComponentNode["props"][string];

/** The exact lowercase framework event-argument convention (D-07). */
const ARG_PROP = "arg";

const EMPTY_ASSET_REGISTRY: FacetAssetRegistry = Object.freeze(Object.create(null));

interface DocumentContext {
  readonly index: ReadonlyMap<string, ComponentSpec>;
  readonly sourceNodes: Readonly<Record<string, unknown>>;
  readonly outputNodes: Record<string, ComponentNode>;
  readonly emitted: Set<string>;
  readonly issues: SessionIssue[];
  attemptedNodes: number;
  nodeBudgetReported: boolean;
}

function fallbackThemeLayer(
  groups: readonly {
    readonly name: string;
    readonly tokens: readonly { readonly name: string }[];
  }[],
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.freeze(
    Object.fromEntries(
      groups.map((group) => [
        group.name,
        Object.freeze(Object.fromEntries(group.tokens.map((token) => [token.name, "initial"]))),
      ]),
    ),
  );
}

const FALLBACK_CATALOG_INPUT = Object.freeze({
  components: Object.freeze([
    Object.freeze({
      tag: "Screen",
      whenToUse: "Root screen used for a safe empty restored session.",
      props: Object.freeze({
        name: Object.freeze({
          type: "string",
          required: true,
          guidance: "The screen name the document entry selects.",
        }),
      }),
      content: Object.freeze({ mode: "children" }),
    }),
  ]),
});

const FALLBACK_THEME_INPUT = Object.freeze({
  foundation: fallbackThemeLayer(FACET_THEME_CONTRACT.foundation),
  semantic: fallbackThemeLayer(FACET_THEME_CONTRACT.semantic),
});

function issue(code: string, at: string, detail: string): SessionIssue {
  return Object.freeze({ code, at, detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(
  source: Readonly<Record<string, unknown>>,
  key: string,
  issues: SessionIssue[],
  at: string,
): unknown {
  try {
    return Object.hasOwn(source, key) ? source[key] : undefined;
  } catch {
    const code = /^document\.nodes\.[^.]+$/.test(at) ? "node_read_failed" : "read_failed";
    issues.push(issue(code, at, "A persisted property threw while being read."));
    return undefined;
  }
}

function ownKeys(
  source: Readonly<Record<string, unknown>>,
  issues: SessionIssue[],
  at: string,
): readonly string[] {
  try {
    return Object.getOwnPropertyNames(source).sort();
  } catch {
    issues.push(issue("read_failed", at, "Persisted property names could not be read."));
    return [];
  }
}

function fallbackCatalog(): FacetCatalog {
  const result = validateCatalog(FALLBACK_CATALOG_INPUT);
  if (!result.ok) {
    throw new Error("runtime fallback catalog is invalid");
  }
  return result.catalog;
}

function fallbackThemeDeclaredLayer(
  declarations: readonly {
    readonly namespace: string;
    readonly tokens: Readonly<Record<string, unknown>>;
  }[],
): FacetThemeTokenValues | undefined {
  if (declarations.length === 0) {
    return undefined;
  }
  return Object.freeze(
    Object.fromEntries(
      declarations.map((declaration) => [
        declaration.namespace,
        Object.freeze(
          Object.fromEntries(Object.keys(declaration.tokens).map((token) => [token, "initial"])),
        ),
      ]),
    ),
  );
}

function fallbackTheme(
  catalog: FacetCatalog,
  themeExtensions: readonly FacetThemeExtensionDeclaration[],
): FacetTheme {
  const recipes = fallbackThemeDeclaredLayer(
    catalog.components.flatMap((spec) =>
      spec.themeRecipe === undefined
        ? []
        : [{ namespace: facetThemeToKebabCase(spec.tag), tokens: spec.themeRecipe.tokens }],
    ),
  );
  const extensions = fallbackThemeDeclaredLayer(themeExtensions);
  const input = Object.freeze({
    ...FALLBACK_THEME_INPUT,
    ...(recipes === undefined ? {} : { recipes }),
    ...(extensions === undefined ? {} : { extensions }),
  });
  const result = validateTheme(input, { catalog, extensions: themeExtensions });
  if (!result.ok) {
    throw new Error("runtime fallback theme is invalid");
  }
  return result.theme;
}

function fallbackThemeExtensions(): readonly FacetThemeExtensionDeclaration[] {
  return Object.freeze([]);
}

function sessionFrom(
  catalog: FacetCatalog,
  assetRegistry: FacetAssetRegistry,
  theme: FacetTheme,
  themeExtensions: readonly FacetThemeExtensionDeclaration[],
  copy: NeutralCopy,
  document: ComponentDocument | null,
  data: DataModel,
  stageRevision: StageRevision,
): Session {
  return Object.freeze({
    catalog,
    assetRegistry,
    theme,
    themeExtensions,
    copy,
    document,
    data,
    stageRevision,
    phase: document === null ? "preparing" : "live",
  });
}

function safeEmpty(issues: readonly SessionIssue[]): {
  readonly session: Session;
  readonly issues: readonly SessionIssue[];
} {
  const catalog = fallbackCatalog();
  const themeExtensions = fallbackThemeExtensions();
  return Object.freeze({
    session: sessionFrom(
      catalog,
      EMPTY_ASSET_REGISTRY,
      fallbackTheme(catalog, themeExtensions),
      themeExtensions,
      NEUTRAL_COPY_DEFAULTS,
      null,
      {},
      0,
    ),
    issues: Object.freeze([...issues]),
  });
}

function normalizeCatalog(source: unknown, issues: SessionIssue[]): FacetCatalog {
  const result = validateCatalog(source);
  if (result.ok) {
    return result.catalog;
  }
  issues.push(issue(result.code, result.at, result.detail));
  return fallbackCatalog();
}

function normalizeAssetRegistry(source: unknown, issues: SessionIssue[]): FacetAssetRegistry {
  const result = validateFacetAssetRegistry(source);
  if (result.ok) {
    return result.registry;
  }
  issues.push(issue(result.code, result.at, result.detail));
  return EMPTY_ASSET_REGISTRY;
}

function normalizeTheme(
  source: unknown,
  catalog: FacetCatalog,
  themeExtensions: readonly FacetThemeExtensionDeclaration[],
  issues: SessionIssue[],
): FacetTheme {
  const result = validateTheme(source, { catalog, extensions: themeExtensions });
  if (result.ok) {
    return result.theme;
  }
  issues.push(issue(result.code, result.at, result.detail));
  return fallbackTheme(catalog, themeExtensions);
}

function normalizeThemeExtensions(
  source: unknown,
  issues: SessionIssue[],
): readonly FacetThemeExtensionDeclaration[] {
  const result = validateThemeExtensionDeclarations(source);
  if (result.ok) {
    return result.extensions;
  }
  issues.push(issue(result.code, result.at, result.detail));
  return fallbackThemeExtensions();
}

function normalizeCopy(source: unknown, issues: SessionIssue[]): NeutralCopy {
  const result = resolveNeutralCopy(source);
  if (result.ok) {
    return result.copy;
  }
  issues.push(issue(result.code, result.at, result.detail));
  return NEUTRAL_COPY_DEFAULTS;
}

function normalizeData(source: unknown, issues: SessionIssue[]): DataModel {
  const result = evaluateCandidateModel(source);
  if (result.ok) {
    return result.model;
  }
  issues.push(issue(result.reason, "data", "Persisted data exceeded the bounded data model."));
  return {};
}

function normalizeRevision(source: unknown, issues: SessionIssue[]): StageRevision {
  if (typeof source === "number" && Number.isSafeInteger(source) && source >= 0) {
    return source;
  }
  issues.push(
    issue("invalid_stage_revision", "stageRevision", "Persisted stageRevision is not usable."),
  );
  return 0;
}

function normalizeProp(source: unknown): StoredProp | null {
  if (!isRecord(source)) {
    return null;
  }
  const kind = source["kind"];
  if (kind === "scalar") {
    const value = source["value"];
    return typeof value === "string" ? Object.freeze({ kind, value }) : null;
  }
  if (kind === "reference") {
    const scheme = source["scheme"];
    const target = source["target"];
    if (
      (scheme === "data" || scheme === "nav" || scheme === "agent" || scheme === "asset") &&
      typeof target === "string" &&
      target.length > 0 &&
      `${scheme}:${target}`.length <= BOUNDS.attributeValueChars
    ) {
      return Object.freeze({ kind, scheme, target });
    }
  }
  return null;
}

function referenceMatchesSchema(
  prop: Extract<StoredProp, { readonly kind: "reference" }>,
  schema: PropSchema,
): boolean {
  if (prop.scheme === "data") {
    return (
      schema.bindable === true &&
      !(schema.type === "string" && schema.action === true) &&
      parseDataPath(prop.target) !== null
    );
  }
  if (!isFacetIdentifier(prop.target) || schema.type !== "string") {
    return false;
  }
  if (prop.scheme === "asset") {
    return schema.assetKind === "image";
  }
  return schema.action === true && schema.assetKind === undefined;
}

function scalarMatchesSchema(value: string, schema: PropSchema): boolean {
  switch (schema.type) {
    case "array":
    case "object":
      return false;
    case "boolean":
      return value === "true" || value === "false";
    case "number": {
      const amount = parseAuthoredNumber(value);
      return (
        amount !== null &&
        (schema.enum === undefined || schema.enum.includes(amount)) &&
        (schema.minimum === undefined || amount >= schema.minimum) &&
        (schema.maximum === undefined || amount <= schema.maximum)
      );
    }
    case "string":
      return (
        schema.action !== true &&
        schema.assetKind === undefined &&
        (schema.enum === undefined || schema.enum.includes(value))
      );
  }
}

function propMatchesSchema(prop: StoredProp, schema: PropSchema): boolean {
  return prop.kind === "reference"
    ? referenceMatchesSchema(prop, schema)
    : scalarMatchesSchema(prop.value, schema);
}

function normalizeProps(
  propsSource: unknown,
  spec: ComponentSpec,
  id: string,
  context: DocumentContext,
): Readonly<Record<string, StoredProp>> | null {
  if (!isRecord(propsSource)) {
    context.issues.push(
      issue("invalid_props", `document.nodes.${id}.props`, "Node props are invalid."),
    );
    return null;
  }

  const props: Record<string, StoredProp> = Object.create(null) as Record<string, StoredProp>;
  for (const name of ownKeys(propsSource, context.issues, `document.nodes.${id}.props`)) {
    const schema = Object.hasOwn(spec.props, name) ? spec.props[name] : undefined;
    if (schema === undefined) {
      context.issues.push(
        issue(
          "undeclared_prop",
          `document.nodes.${id}.props.${name}`,
          "The catalog does not declare this prop.",
        ),
      );
      return null;
    }
    const prop = normalizeProp(
      readOwn(propsSource, name, context.issues, `document.nodes.${id}.props.${name}`),
    );
    if (prop === null) {
      context.issues.push(
        issue(
          "invalid_prop",
          `document.nodes.${id}.props.${name}`,
          "The persisted prop value is invalid.",
        ),
      );
      return null;
    }
    if (name === ARG_PROP) {
      if (prop.kind !== "scalar") {
        context.issues.push(
          issue(
            "event_arg_not_literal",
            `document.nodes.${id}.props.${name}`,
            "A persisted event argument must be a scalar literal.",
          ),
        );
        return null;
      }
      if (prop.value.length > BOUNDS.collectedValueChars) {
        context.issues.push(
          issue(
            "event_arg_too_long",
            `document.nodes.${id}.props.${name}`,
            "The persisted event argument exceeds B-23.",
          ),
        );
        return null;
      }
    }
    if (!propMatchesSchema(prop, schema)) {
      context.issues.push(
        issue(
          "invalid_prop_value",
          `document.nodes.${id}.props.${name}`,
          "The persisted prop value contradicts its catalog schema.",
        ),
      );
      return null;
    }
    if (prop.kind === "scalar" && prop.value.length > BOUNDS.attributeValueChars) {
      context.issues.push(
        issue(
          "attribute_value_too_long",
          `document.nodes.${id}.props.${name}`,
          "The persisted attribute value exceeds B-05.",
        ),
      );
      return null;
    }
    props[name] = prop;
  }

  for (const name of ownKeys(spec.props, context.issues, `catalog.${spec.tag}.props`)) {
    if (spec.props[name]?.required === true && props[name] === undefined) {
      context.issues.push(
        issue(
          "missing_required_prop",
          `document.nodes.${id}.props.${name}`,
          "A required prop is missing.",
        ),
      );
      return null;
    }
  }

  return Object.freeze(props);
}

function normalizeNode(
  id: string,
  depth: number,
  isScreenRoot: boolean,
  path: ReadonlySet<string>,
  context: DocumentContext,
): string | null {
  if (context.attemptedNodes >= BOUNDS.nodesPerDocument) {
    if (!context.nodeBudgetReported) {
      context.nodeBudgetReported = true;
      context.issues.push(
        issue("too_many_nodes", "document.nodes", "The restored document exceeds B-07."),
      );
    }
    return null;
  }
  context.attemptedNodes += 1;
  if (path.has(id)) {
    context.issues.push(
      issue("cycle", `document.nodes.${id}`, "A restored node points back to an ancestor."),
    );
    return null;
  }
  if (depth > BOUNDS.elementDepth) {
    context.issues.push(issue("depth", `document.nodes.${id}`, "A restored subtree exceeds B-03."));
    return null;
  }
  if (context.emitted.has(id)) {
    context.issues.push(
      issue(
        "duplicate_node_parent",
        `document.nodes.${id}`,
        "A restored node is referenced from more than one parent.",
      ),
    );
    return null;
  }

  const rawNode = readOwn(context.sourceNodes, id, context.issues, `document.nodes.${id}`);
  if (rawNode === undefined) {
    context.issues.push(
      issue("missing_node", `document.nodes.${id}`, "A restored child id has no node."),
    );
    return null;
  }
  if (!isRecord(rawNode)) {
    context.issues.push(
      issue("invalid_node", `document.nodes.${id}`, "A restored node is not an object."),
    );
    return null;
  }

  const tag = readOwn(rawNode, "tag", context.issues, `document.nodes.${id}.tag`);
  if (typeof tag !== "string") {
    context.issues.push(
      issue("invalid_tag", `document.nodes.${id}.tag`, "A restored node tag is invalid."),
    );
    return null;
  }
  const spec = context.index.get(tag);
  if (spec === undefined) {
    context.issues.push(
      issue(
        "unknown_tag",
        `document.nodes.${id}.tag`,
        "The session catalog does not contain this tag.",
      ),
    );
    return null;
  }
  if (tag === "Screen" && !isScreenRoot) {
    context.issues.push(
      issue("misplaced_screen", `document.nodes.${id}`, "Screen can only be a document root."),
    );
    return null;
  }
  if (isScreenRoot && tag !== "Screen") {
    context.issues.push(
      issue("invalid_screen", `document.screens.${id}`, "A document screen root must be Screen."),
    );
    return null;
  }

  const slot = readOwn(rawNode, "slot", context.issues, `document.nodes.${id}.slot`);
  if (slot !== undefined && (typeof slot !== "string" || !isFacetIdentifier(slot))) {
    context.issues.push(
      issue("invalid_slot", `document.nodes.${id}.slot`, "A restored node slot is invalid."),
    );
    return null;
  }
  if (isScreenRoot && slot !== undefined) {
    context.issues.push(
      issue(
        "invalid_screen_slot",
        `document.nodes.${id}.slot`,
        "A screen root cannot fill a slot.",
      ),
    );
    return null;
  }

  const props = normalizeProps(
    readOwn(rawNode, "props", context.issues, `document.nodes.${id}.props`),
    spec,
    id,
    context,
  );
  if (props === null) {
    return null;
  }

  const rawChildren = readOwn(rawNode, "children", context.issues, `document.nodes.${id}.children`);
  if (!Array.isArray(rawChildren)) {
    context.issues.push(
      issue("invalid_children", `document.nodes.${id}.children`, "Node children are invalid."),
    );
    return null;
  }
  if (spec.content.mode === "none" && rawChildren.length > 0) {
    context.issues.push(
      issue(
        "children_not_allowed",
        `document.nodes.${id}.children`,
        "This component cannot contain children.",
      ),
    );
    return null;
  }

  const nextPath = new Set(path);
  nextPath.add(id);
  const children: string[] = [];
  const slotCounts = new Map<string, number>();
  const additionsBeforeChildren = new Set(context.emitted);
  for (const child of rawChildren) {
    if (context.attemptedNodes >= BOUNDS.nodesPerDocument) {
      if (!context.nodeBudgetReported) {
        context.nodeBudgetReported = true;
        context.issues.push(
          issue("too_many_nodes", "document.nodes", "The restored document exceeds B-07."),
        );
      }
      break;
    }
    if (typeof child !== "string") {
      context.attemptedNodes += 1;
      context.issues.push(
        issue("invalid_child_id", `document.nodes.${id}.children`, "A child id is invalid."),
      );
      continue;
    }
    const additionsBeforeChild = new Set(context.emitted);
    const normalized = normalizeNode(child, depth + 1, false, nextPath, context);
    if (normalized === null) {
      continue;
    }
    const childNode = context.outputNodes[normalized];
    if (childNode === undefined) {
      rollbackAdditions(context, additionsBeforeChild);
      continue;
    }
    if (spec.content.mode === "children" && childNode.slot !== undefined) {
      context.issues.push(
        issue(
          "slot_not_accepted",
          `document.nodes.${normalized}.slot`,
          "This parent accepts ordinary children, not named slots.",
        ),
      );
      rollbackAdditions(context, additionsBeforeChild);
      continue;
    }
    if (spec.content.mode === "slots") {
      const slotName = childNode.slot;
      if (slotName === undefined) {
        context.issues.push(
          issue(
            "missing_child_slot",
            `document.nodes.${normalized}.slot`,
            "Every direct child of this structured component must name a slot.",
          ),
        );
        rollbackAdditions(context, additionsBeforeChild);
        continue;
      }
      const slotSpec = Object.hasOwn(spec.content.slots, slotName)
        ? spec.content.slots[slotName]
        : undefined;
      if (slotSpec === undefined) {
        context.issues.push(
          issue(
            "unknown_slot",
            `document.nodes.${normalized}.slot`,
            "The parent component does not declare this slot.",
          ),
        );
        rollbackAdditions(context, additionsBeforeChild);
        continue;
      }
      if (slotSpec.allowedTags !== undefined && !slotSpec.allowedTags.includes(childNode.tag)) {
        context.issues.push(
          issue(
            "slot_tag_not_allowed",
            `document.nodes.${normalized}.tag`,
            "This component tag is not allowed in the assigned slot.",
          ),
        );
        rollbackAdditions(context, additionsBeforeChild);
        continue;
      }
      const count = (slotCounts.get(slotName) ?? 0) + 1;
      if (count > slotSpec.maxChildren) {
        context.issues.push(
          issue(
            "too_many_slot_children",
            `document.nodes.${id}.children`,
            "The restored slot contains more children than its contract allows.",
          ),
        );
        rollbackAdditions(context, additionsBeforeChild);
        continue;
      }
      slotCounts.set(slotName, count);
    }
    children.push(normalized);
  }

  if (spec.content.mode === "slots") {
    for (const slotName of Object.keys(spec.content.slots).sort()) {
      const slotSpec = spec.content.slots[slotName];
      if (slotSpec !== undefined && (slotCounts.get(slotName) ?? 0) < slotSpec.minChildren) {
        context.issues.push(
          issue(
            "missing_slot_children",
            `document.nodes.${id}.children`,
            "A required slot does not contain enough valid restored children.",
          ),
        );
        rollbackAdditions(context, additionsBeforeChildren);
        return null;
      }
    }
  }

  if (Object.keys(context.outputNodes).length >= BOUNDS.nodesPerDocument) {
    context.issues.push(
      issue("too_many_nodes", "document.nodes", "The restored document exceeds B-07."),
    );
    return null;
  }

  context.outputNodes[id] = Object.freeze({
    tag,
    ...(typeof slot === "string" ? { slot } : {}),
    props,
    children: Object.freeze(children),
  });
  context.emitted.add(id);
  return id;
}

function rollbackAdditions(context: DocumentContext, before: ReadonlySet<string>): void {
  for (const emitted of [...context.emitted]) {
    if (before.has(emitted)) {
      continue;
    }
    context.emitted.delete(emitted);
    delete context.outputNodes[emitted];
  }
}

function screenName(node: ComponentNode | undefined): string | null {
  const value = node?.props["name"];
  return value?.kind === "scalar" ? value.value : null;
}

function normalizeDocument(
  source: unknown,
  catalog: FacetCatalog,
  issues: SessionIssue[],
): ComponentDocument | null {
  if (source === null) {
    return null;
  }
  if (!isRecord(source)) {
    issues.push(issue("invalid_document", "document", "Persisted document is not usable."));
    return null;
  }

  const entry = readOwn(source, "entry", issues, "document.entry");
  const screens = readOwn(source, "screens", issues, "document.screens");
  const nodes = readOwn(source, "nodes", issues, "document.nodes");
  if (typeof entry !== "string" || !Array.isArray(screens) || !isRecord(nodes)) {
    issues.push(
      issue("invalid_document", "document", "Persisted document envelope is not usable."),
    );
    return null;
  }

  const context: DocumentContext = {
    index: buildCatalogIndex(catalog),
    sourceNodes: nodes,
    outputNodes: Object.create(null) as Record<string, ComponentNode>,
    emitted: new Set<string>(),
    issues,
    attemptedNodes: 0,
    nodeBudgetReported: false,
  };
  const screenIds: string[] = [];
  if (screens.length > BOUNDS.screensPerDocument) {
    issues.push(
      issue("too_many_screens", "document.screens", "The restored document exceeds B-08."),
    );
  }
  for (const id of screens.slice(0, BOUNDS.screensPerDocument)) {
    if (context.attemptedNodes >= BOUNDS.nodesPerDocument) {
      break;
    }
    if (typeof id !== "string") {
      issues.push(issue("invalid_screen_id", "document.screens", "A screen id is invalid."));
      continue;
    }
    const normalized = normalizeNode(id, 2, true, new Set<string>(), context);
    if (normalized !== null) {
      screenIds.push(normalized);
    }
  }

  const matchesEntry = screenIds.some((id) => screenName(context.outputNodes[id]) === entry);
  if (screenIds.length === 0 || !matchesEntry) {
    issues.push(
      issue(
        "unusable_document",
        "document.entry",
        "No restored screen matches the document entry.",
      ),
    );
    return null;
  }

  return Object.freeze({
    entry,
    screens: Object.freeze(screenIds),
    nodes: Object.freeze(context.outputNodes),
  });
}

export function validatePersistedSession(stored: unknown): {
  readonly session: Session;
  readonly issues: readonly SessionIssue[];
} {
  const issues: SessionIssue[] = [];
  try {
    if (!isRecord(stored)) {
      issues.push(issue("invalid_session", "", "Persisted session is not an object."));
      return safeEmpty(issues);
    }

    const catalog = normalizeCatalog(readOwn(stored, "catalog", issues, "catalog"), issues);
    const assetRegistry = normalizeAssetRegistry(
      readOwn(stored, "assetRegistry", issues, "assetRegistry"),
      issues,
    );
    const themeExtensions = normalizeThemeExtensions(
      readOwn(stored, "themeExtensions", issues, "themeExtensions"),
      issues,
    );
    const theme = normalizeTheme(
      readOwn(stored, "theme", issues, "theme"),
      catalog,
      themeExtensions,
      issues,
    );
    const copy = normalizeCopy(readOwn(stored, "copy", issues, "copy"), issues);
    const data = normalizeData(readOwn(stored, "data", issues, "data"), issues);
    const stageRevision = normalizeRevision(
      readOwn(stored, "stageRevision", issues, "stageRevision"),
      issues,
    );
    const document = normalizeDocument(
      readOwn(stored, "document", issues, "document"),
      catalog,
      issues,
    );

    return Object.freeze({
      session: sessionFrom(
        catalog,
        assetRegistry,
        theme,
        themeExtensions,
        copy,
        document,
        data,
        stageRevision,
      ),
      issues: Object.freeze([...issues]),
    });
  } catch {
    issues.push(issue("session_restore_failed", "", "Persisted session restore failed safely."));
    return safeEmpty(issues);
  }
}

export async function loadSession(
  store: StageStore,
  key: string,
): Promise<{ readonly session: Session; readonly issues: readonly SessionIssue[] }> {
  try {
    return validatePersistedSession(await store.get(key));
  } catch {
    return safeEmpty([
      issue("store_get_failed", key, "StageStore.get failed before normalization."),
    ]);
  }
}

function detachSession(session: Session): Session {
  return validatePersistedSession(session).session;
}

export class MemoryStageStore implements StageStore {
  readonly #sessions = new Map<string, Session>();

  async get(key: string): Promise<unknown | null> {
    const session = this.#sessions.get(key);
    return session === undefined ? null : detachSession(session);
  }

  async save(
    key: string,
    session: Session,
    expectedRevision: StageRevision,
    guard?: () => boolean,
  ): Promise<CasOutcome> {
    const currentRevision = this.#sessions.get(key)?.stageRevision ?? 0;
    if (currentRevision !== expectedRevision) {
      return { ok: false, reason: "conflict", currentRevision };
    }
    try {
      if (guard !== undefined && !guard()) {
        return { ok: false, reason: "conflict", currentRevision };
      }
    } catch {
      return { ok: false, reason: "conflict", currentRevision };
    }
    this.#sessions.set(key, detachSession(session));
    return { ok: true, revision: session.stageRevision };
  }
}
