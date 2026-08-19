/**
 * Author validation — the single point where authored markup meets the active
 * catalog.
 *
 * `parseMarkup` decides whether markup is *shaped* like markup. This module
 * decides whether it is *true*: whether every tag is registered, every prop is
 * declared, every value inhabits its declared domain, every binding is
 * authorized by a bindable prop and resolves against the Data Model, and every
 * action names something that exists. Invariant 4 — Facet owns UI-OUT and UI-IN
 * and nothing else — is only as strong as this one gate, so the gate is closed
 * in both directions: an unknown tag is a rejection, and so is an *extra* prop
 * a component never declared.
 *
 * Three properties define the contract:
 *
 * 1. **Atomic.** A rejection produces exactly one structured error and no
 *    document. There is no partially validated tree, no "accepted except", and
 *    no list to triage, so a caller that refuses the result leaves the prior
 *    revision untouched by construction.
 * 2. **First in document order.** The walk is a single pre-order pass over the
 *    screens, and within an element over the props as authored, so the fault
 *    reported is the earliest one and the same input always names the same
 *    fault.
 * 3. **Total.** It never throws, for any ast, catalog or model, including
 *    values with throwing getters. Its walk is iterative and node-budgeted.
 *
 * **One failure vocabulary, shared with the grammar.** A rejection here is an
 * `AuthorError` built by the one shared builder in `markup-errors.ts`, carrying
 * the same code vocabulary, the same `location`, and the same two `B-24`-clamped
 * copy fields a lexer or parser fault carries. Nothing about the shape says
 * which layer refused the call. That is deliberate: the agent repairs one thing
 * and retries, and a second rejection shape would give it two ways to be told it
 * was wrong, two names for the same location, and two rank orders that could
 * disagree about which fault comes first.
 *
 * **`Facet` and `Screen` name positions in the grammar.** One `Facet` is the
 * root and `Screen` declares its screens; either one anywhere else is refused as
 * misplaced *before* the catalog is consulted, so the answer never depends on
 * what a registration happens to contain.
 *
 * That ordering is what lets `Screen` hold **two** roles at once. It is a
 * grammar position here and a registered component in the catalog — the renderer
 * mounts a stored screen root like any other node, and bootstrap demands exact
 * catalog/registry equality, so a `Screen` no host could register would leave
 * that root unmountable. Registering it reopens nothing: a nested `<Screen>` is
 * misplaced before any lookup happens, so no registration can make one legal.
 * `Facet` has no second role — it mounts nothing, and the catalog refuses it.
 *
 * A screen root that *is* in its position is then checked against the registered
 * `Screen` spec exactly like every other mounted component: its required `name`,
 * its declared presentation props, its value domains, and the refusal of a prop
 * the spec never declared. Registration is not a bypass, and the screen root is
 * not a second, hand-written form that could drift from the catalog's.
 *
 * **A collection request list is resolved here, not deferred.** A prop named
 * `collect` names the collectable fields whose values an `agent:` event carries.
 * Every name in it is resolved against the collectable components the *same
 * screen* declares, so a list this document cannot possibly honour is refused
 * while the agent can still repair it.
 *
 * That placement is the point. `collect_source_unavailable` is the **runtime**
 * fail-safe — for a validly authored field that is not live or registered yet,
 * and for corrupt persisted state. It is not the acceptance path for an
 * author-time unknown name: accepting one would turn a typo into a structured
 * absence the agent learns about one event later, in a payload otherwise
 * indistinguishable from a field the visitor simply never reached.
 *
 * **Both halves of that channel must be literal.** A request list is a scalar
 * literal and so is the `name` a collectable node registers as its address:
 * every reference is refused, of every scheme, before ordinary reference
 * dispatch. `data:` is the case that decides it — a bound list or a bound
 * address arrives from the Data Model, where there is nothing to check at author
 * time, so the rules above would hold for every input except the one that can
 * carry anything. The address is checked on **every** collectable node, whether
 * or not a list names it today, because an accepted collectable may never carry
 * an address nothing can ever resolve.
 *
 * **So must the argument.** `arg` is the third framework convention, the one
 * explicit value an `agent:` event sends, and it is a scalar literal for the
 * same reasons: every reference is refused, of every scheme, before ordinary
 * dispatch. It is bounded by `B-23` and it is never truncated and never coerced
 * — a shortened argument is a different argument, and the agent would act on
 * something the author never wrote. Its declared domain, the one keyword a spec
 * keeps here, is enforced by the ordinary scalar rule every other prop takes
 * rather than by a second one of its own, and it answers first. The argument is
 * **not** gated on an action: Facet reserves no action-prop name at all, so a
 * rule about the action beside it would have to hard-code one catalog's
 * spelling, and an argument the renderer ignores is inert rather than unsafe.
 *
 * **`id` is the framework's, not the catalog's.** It is Facet's node identity —
 * the author reads it back and never writes it — and it is refused before the
 * declared-prop lookup, so a registration declaring a prop of that exact name
 * cannot hand the agent a way to author it. That single exact lowercase name is
 * the whole reservation: a prop that differs in case, or that merely begins with
 * `id` or with `facet`, is an ordinary case-sensitive custom prop the catalog
 * declares and the author writes like any other. The framework's own neutral
 * copy needs no name reservation to stay the framework's, because it has no
 * author, data, or component-prop input path at all (DC-015).
 */

import { parseAction } from "./actions.js";
import { resolveFacetAsset, type FacetAssetRegistry } from "./asset-registry.js";
import { parseAuthoredNumber } from "./author-scalar.js";
import { BOUNDS } from "./bounds.js";
import { buildCatalogIndex, type FacetCatalog } from "./catalog.js";
import type { ComponentSpec, PropSchema } from "./component-spec.js";
import { resolveBinding } from "./data-binding.js";
import type { DataModel } from "./data-model.js";
import { buildDocument, type ComponentDocument } from "./document.js";
import { isFacetIdentifier } from "./identifiers.js";
import { authorError, truncate, type AuthorError, type SourceLocation } from "./markup-errors.js";
import type { MarkupAst, MarkupNode } from "./markup-parser.js";

/**
 * The ast shapes this module reads, derived from `MarkupNode` by indexed access
 * rather than imported by name. The grammar's prop, value and scheme aliases are
 * internal to that module and stay off the package barrel, so naming one here
 * would reach a name no consumer can import; deriving them keeps this module
 * working in the parser's own types without depending on their spelling.
 */
type MarkupProp = MarkupNode["props"][number];
type MarkupValue = MarkupProp["value"];
type ReferenceScheme = Extract<MarkupValue, { readonly kind: "reference" }>["scheme"];

/**
 * What `validateAuthorMarkup` answers: the built document, or the one first
 * failure.
 *
 * Exported because the function is: a caller that stores a result, passes it on,
 * or narrows it in a helper of its own has to be able to **name** it. Both
 * branches are spelled out here rather than assembled from private halves, so
 * every part of the emitted signature is reachable — and the failure branch
 * carries `AuthorError` itself, the same type the grammar layer returns, rather
 * than a parallel rejection this module would own.
 */
export type AuthorValidationResult =
  | { readonly ok: true; readonly document: ComponentDocument }
  | { readonly ok: false; readonly error: AuthorError };

/** Facet's own node identity. The author reads it back; the author never writes it. */
const RESERVED_ID = "id";

/**
 * The retired local-action scheme, refused by name. The parser turns only
 * `data:`, `nav:` and `agent:` into references, so browser-local action text reaches this
 * layer as an ordinary scalar and would otherwise render as literal text — a
 * quiet acceptance of the one scheme the vocabulary exists to exclude.
 */
const LOCAL_SCHEME_PREFIX = ["local", ":"].join("");

/**
 * The prop that carries a collection request list. Like `id`, the exact
 * lowercase name is the framework's convention rather than one registration's
 * choice: a catalog cannot rename it or redeclare it into something else, so one
 * list is written the same way against every catalog.
 */
const COLLECT_PROP = "collect";

/**
 * The prop a collectable component carries its collection address in. The same
 * exact lowercase name `validateComponentSpec` obliges every collectable spec to
 * declare, read here as the authored value a list resolves against. Whether a
 * node carries an address is the **catalog's** answer — `collect.collectable` —
 * so an ordinary prop of that name on any other component stays ordinary.
 */
const COLLECT_NAME_PROP = "name";

/**
 * The prop that carries the one explicit argument an `agent:` event sends.
 * Reserved by the same convention as the two collection props and read the same
 * way — by its exact lowercase name, whatever a registration says about it.
 *
 * Unlike the collection address, this one is **not** gated on anything the
 * catalog declares. `validateComponentSpec` reserves `arg` unconditionally, so
 * gating the authored value on a block, on a type, or on the presence of an
 * action would leave a legally declared argument with no literal check at all.
 * Nothing obliges a spec to declare it; the reservation only says what it means
 * once declared.
 */
const EVENT_ARG_PROP = "arg";

/**
 * The one character that separates names in a list. A single space, and nothing
 * else: a tab or a newline lands *inside* a name, where the identifier grammar
 * refuses it and says so, rather than being silently accepted as a second
 * spelling of the same list.
 */
const COLLECT_SEPARATOR = " ";

/** The envelope tag. It is grammar, never a catalog component: it mounts nothing. */
const ENVELOPE_TAG = "Facet";

/** The one tag a screen root may take. It is grammar *and* a registered component. */
const SCREEN_TAG = "Screen";

/**
 * The two tags that name a position in the grammar. Each has exactly one place
 * it may appear — `Facet` as the single root, `Screen` as that root's direct
 * children — and `buildDocument` has already proven both of those places by the
 * time the walk starts. So every occurrence the walk meets *below* a screen root
 * is by definition somewhere else, and is refused as misplaced.
 */
const STRUCTURAL_TAGS: readonly string[] = [ENVELOPE_TAG, SCREEN_TAG];

const BOOLEAN_LITERALS: readonly string[] = ["true", "false"];

const ORIGIN: SourceLocation = Object.freeze({ offset: 0, line: 1, column: 1 });

/** How much of an offending value is quoted back in a message. */
const EXCERPT_CHARS = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A single-line, bounded quotation of an offending value. */
function excerpt(text: string): string {
  return truncate(text.trim().replace(/\s+/g, " "), EXCERPT_CHARS);
}

/** Reads a location defensively: a synthesised ast may carry none. */
function locationOf(candidate: unknown): SourceLocation {
  if (!isRecord(candidate)) {
    return ORIGIN;
  }
  const { offset, line, column } = candidate;
  if (typeof offset !== "number" || typeof line !== "number" || typeof column !== "number") {
    return ORIGIN;
  }
  return { offset, line, column };
}

/**
 * Whether an authored scalar is an attempt to write structure inline. It mirrors
 * the parser's own test, so the two layers agree on what "inline JSON" means.
 */
function looksStructured(text: string): boolean {
  const lead = text.trimStart();
  return lead.startsWith("[") || lead.startsWith("{");
}

/** The three schemes the parser produces; anything else is not a reference. */
const REFERENCE_SCHEMES: readonly ReferenceScheme[] = Object.freeze([
  "data",
  "nav",
  "agent",
  "asset",
]);
const EMPTY_ASSET_REGISTRY: FacetAssetRegistry = Object.freeze({});

function isReferenceScheme(value: unknown): value is ReferenceScheme {
  return typeof value === "string" && REFERENCE_SCHEMES.includes(value as ReferenceScheme);
}

/**
 * The one reserved attribute, refused before the catalog is consulted.
 *
 * Compared exactly, and to that one name only. A prop is reserved because Facet
 * writes it, not because it looks like something Facet might write, so `Id`,
 * `identifier` and `facetPreparing` are ordinary custom props.
 */
function isReservedAttribute(name: string): boolean {
  return name === RESERVED_ID;
}

/**
 * Validates parsed markup against the active catalog and Data Model.
 *
 * Total: any ast, catalog or model yields a document or one `AuthorError`, never
 * an exception.
 */
export function validateAuthorMarkup(
  ast: MarkupAst,
  catalog: FacetCatalog,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry = EMPTY_ASSET_REGISTRY,
): AuthorValidationResult {
  try {
    return validate(ast, catalog, dataModel, assetRegistry);
  } catch {
    return {
      ok: false,
      error: authorError({
        code: "malformed-document",
        location: ORIGIN,
        cause: "This markup could not be read as a document.",
        repair: 'Send one `<Facet entry="...">` envelope containing the screens you want.',
      }),
    };
  }
}

function validate(
  ast: MarkupAst,
  catalog: FacetCatalog,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
): AuthorValidationResult {
  const document = buildDocument(ast);
  if (document === null) {
    return {
      ok: false,
      error: authorError({
        code: "malformed-document",
        location: rootLocation(ast),
        cause: "This markup is not a well-formed `Facet` envelope of named screens.",
        repair:
          'Wrap the screens in one `<Facet entry="...">` root, name each `<Screen>` and let Facet own every `id`.',
      }),
    };
  }
  if (document.screens.length > BOUNDS.screensPerDocument) {
    return {
      ok: false,
      error: authorError({
        code: "too-many-screens",
        location: rootLocation(ast),
        cause: `This document declares ${document.screens.length} screens; the limit is ${BOUNDS.screensPerDocument}.`,
        repair: `Keep at most ${BOUNDS.screensPerDocument} screens, and remove the ones the page no longer reaches.`,
      }),
    };
  }

  const index = buildCatalogIndex(catalog);
  const screens = envelopeScreens(ast);
  const fault = walk(
    screens,
    index,
    document,
    dataModel,
    assetRegistry,
    collectScopes(screens, index),
  );
  if (fault !== null) {
    return { ok: false, error: fault };
  }
  return { ok: true, document };
}

/** The envelope's own location, for a fault the document as a whole carries. */
function rootLocation(ast: MarkupAst): SourceLocation {
  if (!isRecord(ast) || !Array.isArray(ast.roots)) {
    return ORIGIN;
  }
  const root: unknown = ast.roots[0];
  return isRecord(root) ? locationOf(root["location"]) : ORIGIN;
}

/** The screen roots under the envelope, read defensively. */
function envelopeScreens(ast: MarkupAst): readonly MarkupNode[] {
  if (!isRecord(ast) || !Array.isArray(ast.roots)) {
    return [];
  }
  const root: unknown = ast.roots[0];
  if (!isRecord(root) || !Array.isArray(root["children"])) {
    return [];
  }
  return root["children"] as readonly MarkupNode[];
}

/**
 * What one node's collection request list is resolved against.
 *
 * Two lookups, because the two answers are different faults. `inScreen` counts
 * the collectable names this node's **own** screen declares — the only ones a
 * control here can reach, and counted rather than merely present so a name two
 * fields answer to is ambiguous rather than arbitrarily resolved. `inDocument`
 * is every collectable name anywhere, which turns "you cannot reach that from
 * here" into a different message from "that does not exist".
 */
interface CollectScope {
  readonly inScreen: ReadonlyMap<string, number>;
  readonly inDocument: ReadonlySet<string>;
}

/**
 * An ast value read as a node, or `null` when it is not one. The ast may be
 * synthesised, so every element position is a value of unknown shape until it
 * has been looked at; the checks that follow read each field defensively in the
 * same way the walk does.
 */
function asNode(value: unknown): MarkupNode | null {
  return isRecord(value) ? (value as unknown as MarkupNode) : null;
}

const NO_COLLECTABLES: CollectScope = Object.freeze({
  inScreen: new Map<string, number>(),
  inDocument: new Set<string>(),
});

/**
 * Indexes the collectable names each screen declares, before any list is read.
 *
 * A whole-screen pre-pass rather than a set the walk accumulates: a control may
 * name a field the screen declares *after* it, and a set built as the walk goes
 * would answer "unknown" for exactly the documents an author writes top-down.
 *
 * Read defensively and bounded by the same node budget the walk is, so a
 * synthesised ast produces a partial index rather than an exception or a
 * non-terminating scan. A document past the budget is refused by the walk on the
 * same input, so an index cut short here never decides an accepted call.
 */
function collectScopes(
  screens: readonly MarkupNode[],
  index: ReadonlyMap<string, ComponentSpec>,
): readonly CollectScope[] {
  const perScreen: Map<string, number>[] = [];
  const inDocument = new Set<string>();
  let visited = 0;
  for (const screen of screens) {
    const inScreen = new Map<string, number>();
    perScreen.push(inScreen);
    const root = asNode(screen);
    const stack: MarkupNode[] = root === null ? [] : [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) {
        break;
      }
      visited += 1;
      if (visited > BOUNDS.nodesPerDocument) {
        return perScreen.map((counts) => ({ inScreen: counts, inDocument }));
      }
      const name = collectableName(node, index);
      if (name !== null) {
        inScreen.set(name, (inScreen.get(name) ?? 0) + 1);
        inDocument.add(name);
      }
      const children = node.children;
      if (!Array.isArray(children)) {
        continue;
      }
      for (const child of children) {
        const next = asNode(child);
        if (next !== null) {
          stack.push(next);
        }
      }
    }
  }
  return perScreen.map((counts) => ({ inScreen: counts, inDocument }));
}

/**
 * The collection address this node registers, or `null` when it registers none.
 *
 * A node is collectable because the **catalog** says so, never because of how it
 * is written, and the address is the authored value of the framework's `name`
 * prop. A collectable node whose address is bound, missing or unreadable
 * registers nothing: such a node is refused by the ordinary prop checks on the
 * same input, so leaving it out of the index cannot make a rejected document
 * accepted.
 */
function collectableName(
  node: MarkupNode,
  index: ReadonlyMap<string, ComponentSpec>,
): string | null {
  if (typeof node.tag !== "string" || index.get(node.tag)?.collect?.collectable !== true) {
    return null;
  }
  for (const prop of authoredProps(node)) {
    if (prop.name !== COLLECT_NAME_PROP) {
      continue;
    }
    const value: unknown = prop.value;
    if (isRecord(value) && value["kind"] === "scalar" && typeof value["value"] === "string") {
      return value["value"];
    }
    return null;
  }
  return null;
}

/**
 * A node discovered by the walk, whether it sits in the screen-root position,
 * and what a list written on it resolves against. That flag decides one thing
 * only: whether a structural tag here is where it belongs. Everything after it
 * is the same check for every node.
 *
 * The scope is carried on the visit rather than looked up per node: a child is
 * on the same screen as its parent by construction, so it simply inherits it.
 */
interface Visit {
  readonly node: MarkupNode;
  readonly isScreen: boolean;
  readonly collect: CollectScope;
}

/**
 * Walks the screens in document pre-order and returns the first fault, or `null`
 * when everything checks out.
 *
 * The walk is an explicit stack rather than recursion, and it is bounded by the
 * same node budget the document itself is, so it terminates for any ast — even
 * one no parser would produce.
 */
function walk(
  screens: readonly MarkupNode[],
  index: ReadonlyMap<string, ComponentSpec>,
  document: ComponentDocument,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
  scopes: readonly CollectScope[],
): AuthorError | null {
  const stack: Visit[] = [];
  for (let position = screens.length - 1; position >= 0; position -= 1) {
    const screen = screens[position];
    if (screen !== undefined) {
      stack.push({ node: screen, isScreen: true, collect: scopes[position] ?? NO_COLLECTABLES });
    }
  }
  let visited = 0;
  while (stack.length > 0) {
    const visit = stack.pop();
    if (visit === undefined) {
      break;
    }
    visited += 1;
    if (visited > BOUNDS.nodesPerDocument) {
      return authorError({
        code: "malformed-document",
        location: locationOf(visit.node.location),
        cause: `This document holds more than ${BOUNDS.nodesPerDocument} nodes.`,
        repair: `Build the page across screens of at most ${BOUNDS.nodesPerDocument} nodes in total.`,
      });
    }
    const fault = checkNode(visit, index, document, dataModel, assetRegistry);
    if (fault !== null) {
      return fault;
    }
    const children = visit.node.children;
    if (!Array.isArray(children)) {
      continue;
    }
    for (let position = children.length - 1; position >= 0; position -= 1) {
      const child = children[position];
      if (child !== undefined) {
        stack.push({ node: child, isScreen: false, collect: visit.collect });
      }
    }
  }
  return null;
}

function checkNode(
  visit: Visit,
  index: ReadonlyMap<string, ComponentSpec>,
  document: ComponentDocument,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
): AuthorError | null {
  const node = visit.node;
  // Placement first, before the catalog is consulted at all. That order is the
  // whole reason `Screen` can be a registered component without reopening the
  // nesting hole: a misplaced grammar position is refused on where it sits, so
  // the answer cannot depend on whether — or how — the tag happens to be
  // registered. It also names what is actually wrong, rather than reporting a
  // position as a merely unregistered tag.
  if (!visit.isScreen && STRUCTURAL_TAGS.includes(node.tag)) {
    return authorError({
      code: "misplaced-structural-tag",
      location: locationOf(node.location),
      cause: `\`<${excerpt(String(node.tag))}>\` is a grammar position, not a component, and this is not that position.`,
      repair: `Write one \`<${ENVELOPE_TAG}>\` root whose direct children are the \`<${SCREEN_TAG}>\` declarations, and use registered components inside them.`,
    });
  }
  // A screen root reaches this lookup too: it is `Screen`, and `Screen` is a
  // registered component, so it is checked against its spec like anything else
  // the renderer mounts. An absent spec is out of contract — `validateCatalog`
  // requires exactly one — so it is reported as the unregistered tag it is
  // rather than being waved through on the strength of its position.
  const spec = index.get(node.tag);
  if (spec === undefined) {
    return authorError({
      code: "unknown-tag",
      location: locationOf(node.location),
      cause: `\`${excerpt(String(node.tag))}\` is not a component in the active catalog.`,
      repair: "Use a registered tag; the component index lists every one this session admits.",
    });
  }
  return checkComponent(node, spec, document, dataModel, assetRegistry, visit.collect);
}

function checkComponent(
  node: MarkupNode,
  spec: ComponentSpec,
  document: ComponentDocument,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
  collect: CollectScope,
): AuthorError | null {
  const present = new Set<string>();
  for (const prop of authoredProps(node)) {
    const reserved = checkReserved(prop);
    if (reserved !== null) {
      return reserved;
    }
    // An own-key test, not a direct read: a prop named for a prototype member
    // must read as undeclared rather than as an inherited function.
    const schema = Object.hasOwn(spec.props, prop.name) ? spec.props[prop.name] : undefined;
    if (schema === undefined) {
      return authorError({
        code: "undeclared-prop",
        location: locationOf(prop.location),
        cause: `\`<${spec.tag}>\` declares no \`${excerpt(prop.name)}\` prop.`,
        repair: "Read the component's spec for the props it does declare, and drop the rest.",
      });
    }
    const fault = checkValue(prop, schema, spec, document, dataModel, assetRegistry, collect);
    if (fault !== null) {
      return fault;
    }
    present.add(prop.name);
  }

  const missing = requiredProps(spec).find((name) => !present.has(name));
  if (missing !== undefined) {
    return authorError({
      code: "missing-required-prop",
      location: locationOf(node.location),
      cause: `\`<${spec.tag}>\` requires the \`${missing}\` prop.`,
      repair: `Write \`${missing}\` on this element; the component's spec says what it takes.`,
    });
  }

  const children = Array.isArray(node.children) ? node.children : [];
  if (spec.content.mode === "none" && children.length > 0) {
    return authorError({
      code: "children-not-accepted",
      location: locationOf(children[0]?.location),
      cause: `\`<${spec.tag}>\` takes no children.`,
      repair: `Self-close it as \`<${spec.tag} ... />\` and put the content in a component that accepts children.`,
    });
  }
  if (spec.content.mode === "children") {
    const assigned = children.find((child) => child.slot !== undefined);
    if (assigned !== undefined) {
      return authorError({
        code: "slot-not-accepted",
        location: locationOf(assigned.location),
        cause: `\`<${spec.tag}>\` accepts ordinary children, not named slots.`,
        repair:
          "Remove the slot attribute or choose a structured component that declares that slot.",
      });
    }
    return null;
  }
  if (spec.content.mode === "slots") {
    const counts = new Map<string, number>();
    for (const child of children) {
      const slotName = child.slot;
      if (slotName === undefined) {
        return authorError({
          code: "missing-child-slot",
          location: locationOf(child.location),
          cause: `Every direct child of \`<${spec.tag}>\` must name one declared slot.`,
          repair: "Add a literal slot attribute named by the parent component spec.",
        });
      }
      if (!Object.hasOwn(spec.content.slots, slotName)) {
        return authorError({
          code: "unknown-slot",
          location: locationOf(child.location),
          cause: `\`<${spec.tag}>\` declares no \`${slotName}\` slot.`,
          repair: "Read the parent component spec and use one of its named slots.",
        });
      }
      const slot = spec.content.slots[slotName];
      if (slot === undefined) {
        return authorError({
          code: "unknown-slot",
          location: locationOf(child.location),
          cause: `\`<${spec.tag}>\` declares no \`${slotName}\` slot.`,
          repair: "Read the parent component spec and use one of its named slots.",
        });
      }
      if (slot.allowedTags !== undefined && !slot.allowedTags.includes(child.tag)) {
        return authorError({
          code: "slot-tag-not-allowed",
          location: locationOf(child.location),
          cause: `\`<${child.tag}>\` is not allowed in \`${spec.tag}.${slotName}\`.`,
          repair: "Use one of the slot's allowed component tags.",
        });
      }
      const count = (counts.get(slotName) ?? 0) + 1;
      if (count > slot.maxChildren) {
        return authorError({
          code: "too-many-slot-children",
          location: locationOf(child.location),
          cause: `\`${spec.tag}.${slotName}\` accepts at most ${String(slot.maxChildren)} children.`,
          repair: "Remove the excess child or move it to another declared slot.",
        });
      }
      counts.set(slotName, count);
    }
    for (const slotName of Object.keys(spec.content.slots).sort()) {
      const slot = spec.content.slots[slotName];
      if (slot !== undefined && (counts.get(slotName) ?? 0) < slot.minChildren) {
        return authorError({
          code: "missing-slot-children",
          location: locationOf(node.location),
          cause: `\`${spec.tag}.${slotName}\` requires at least ${String(slot.minChildren)} children.`,
          repair: `Add a direct child with \`slot="${slotName}"\`.`,
        });
      }
    }
  }
  return null;
}

/** Required prop names in a fixed order, so the reported one never varies. */
function requiredProps(spec: ComponentSpec): readonly string[] {
  return Object.keys(spec.props)
    .sort()
    .filter((name) => spec.props[name]?.required === true);
}

/** The authored props, read defensively: a synthesised ast may carry anything. */
function authoredProps(node: MarkupNode): readonly MarkupProp[] {
  if (!isRecord(node) || !Array.isArray(node.props)) {
    return [];
  }
  return node.props.filter(
    (prop): prop is MarkupProp => isRecord(prop) && typeof prop["name"] === "string",
  );
}

function checkReserved(prop: MarkupProp): AuthorError | null {
  if (!isReservedAttribute(prop.name)) {
    return null;
  }
  return authorError({
    code: "reserved-attribute",
    location: locationOf(prop.location),
    cause: `\`${excerpt(prop.name)}\` is reserved to Facet; markup may read it back but never author it.`,
    repair: "Remove the attribute. Facet owns every node `id`, and allocates it itself.",
  });
}

function checkValue(
  prop: MarkupProp,
  schema: PropSchema,
  spec: ComponentSpec,
  document: ComponentDocument,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
  collect: CollectScope,
): AuthorError | null {
  const location = locationOf(prop.valueLocation);
  // Both framework conventions are recognised by **name**, never by what the
  // registration says about them. `validateComponentSpec` reserves the exact
  // lowercase `collect` whatever type a spec gives it, and obliges every
  // collectable spec to declare the exact lowercase `name` as a plain required
  // string — so a declaration that disagrees never reaches a bootstrapped
  // session. Dispatching on the declaration here would nonetheless leave both
  // rules one nonconforming registration away from being switched off, which is
  // a strange place to put the safety of a collection channel.
  const isCollectList = prop.name === COLLECT_PROP;
  const isCollectAddress = prop.name === COLLECT_NAME_PROP && spec.collect?.collectable === true;
  const isEventArg = prop.name === EVENT_ARG_PROP;
  const unreadable = (): AuthorError =>
    authorError({
      code: "invalid-value",
      location,
      cause: `\`${prop.name}\` carries no readable value.`,
      repair: `Write \`${prop.name}="..."\` with a quoted value or a \`data:\` reference.`,
    });
  const value: unknown = prop.value;
  if (!isRecord(value)) {
    return unreadable();
  }
  if (value["kind"] === "reference") {
    const scheme = value["scheme"];
    const target = value["target"];
    if (!isReferenceScheme(scheme) || typeof target !== "string") {
      return unreadable();
    }
    // Neither convention admits a reference of any scheme, and both are refused
    // *before* ordinary dispatch, because otherwise each has a scheme that slips
    // through. `data:` is the one that matters: a bound list or a bound address
    // arrives from the Data Model, where there is no author-time check to make
    // at all — the rule would be inert for exactly the input that needs it, and
    // inert quietly. `nav:` and `agent:` are the other half: the grammar turns
    // them into references before this layer sees them, so a *resolvable*
    // action reads as a perfectly ordinary string value and would be accepted
    // as a list naming nothing, or as an address nothing can name.
    if (isCollectList) {
      return invalidValue(
        `\`${spec.tag}.${prop.name}\` names the fields to collect; \`${scheme}:${excerpt(target)}\` is a reference.`,
        "Write the field names themselves, separated by spaces; a request list is authored, never bound or navigated.",
        location,
      );
    }
    if (isCollectAddress) {
      return invalidValue(
        `\`${spec.tag}.${prop.name}\` is this field's collection address; \`${scheme}:${excerpt(target)}\` is a reference.`,
        "Write the address itself as one plain name; a collection address is authored, never bound or navigated.",
        location,
      );
    }
    // The third framework convention, refused for the third time on the same
    // reasoning. `data:` decides it again — a bound argument arrives from the
    // Data Model, where there is nothing to check at author time, so the rule
    // would be inert for exactly the input that can carry anything — and `nav:`
    // and `agent:` are the other half: the grammar turns them into references
    // first, so a *resolvable* `nav:` would read as a perfectly ordinary
    // argument string and be forwarded as one.
    if (isEventArg) {
      return invalidValue(
        `\`${spec.tag}.${prop.name}\` is this event's argument; \`${scheme}:${excerpt(target)}\` is a reference.`,
        "Write the argument itself as one quoted value; an event argument is authored, never bound or navigated.",
        location,
      );
    }
    return checkReference(
      scheme,
      target,
      prop,
      schema,
      spec,
      document,
      dataModel,
      assetRegistry,
      location,
    );
  }
  const scalar = value["value"];
  if (value["kind"] !== "scalar" || typeof scalar !== "string") {
    return unreadable();
  }
  // The scalar's own domain first — the vocabulary, inline structure and the
  // declared enum are all reasons the text is not a list or an address at all —
  // and only then what the text names.
  const fault = checkScalar(scalar, prop, schema, spec, location);
  if (fault !== null) {
    return fault;
  }
  if (isCollectList) {
    return checkCollectList(scalar, prop, spec, location, collect);
  }
  if (isCollectAddress) {
    return checkCollectAddress(scalar, prop, spec, location);
  }
  if (isEventArg) {
    return checkEventArg(scalar, prop, spec, location);
  }
  return null;
}

/**
 * Checks the one explicit argument an `agent:` event carries.
 *
 * `B-23`, the bound an argument shares with a collected value, and enforced as a
 * **rejection**. A shortened argument is a different argument: the agent would
 * act on something the author never wrote, and nothing anywhere would say so.
 * Nor is it coerced — whatever the text is, it is forwarded as that text or
 * refused, so what the payload carries is what the markup said.
 *
 * It runs after `checkScalar`, so a declared domain answers first. `enum` is the
 * one keyword the spec layer leaves to a component here, and a value outside its
 * declared set is not a long argument — it is the wrong argument, and saying
 * which set it should have come from is the more useful of the two answers.
 *
 * For an argument written in source, `B-05` bounds the attribute value at the
 * same count and the lexer answers first; this is the bound for a document that
 * did not come from this session's parser, and the one that governs outright if
 * `B-05` is ever raised above `B-23`.
 */
function checkEventArg(
  text: string,
  prop: MarkupProp,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  if (text.length <= BOUNDS.collectedValueChars) {
    return null;
  }
  return invalidValue(
    `\`${spec.tag}.${prop.name}\` carries ${text.length} characters; one event argument holds at most ${BOUNDS.collectedValueChars}.`,
    `Send an argument of at most ${BOUNDS.collectedValueChars} characters, and publish anything longer as data the agent reads back itself.`,
    location,
  );
}

/** One `invalid-value` at the offending value, for a text that is not a literal one. */
function invalidValue(cause: string, repair: string, location: SourceLocation): AuthorError {
  return authorError({ code: "invalid-value", location, cause, repair });
}

/**
 * Checks the collection address a collectable node registers.
 *
 * On **every** collectable node, whether or not a list on this screen names it.
 * An address a list could never resolve is not a fault that waits for a request
 * to expose it: a field carrying one can never be collected by anything, for its
 * whole life, and nothing about the page says so. The event simply carries less
 * than the agent asked for, one exchange later, in a payload indistinguishable
 * from a field the visitor never reached.
 *
 * Refusing it here costs the author one repair now instead of a silent dead end
 * later, and it is the same grammar a request list is parsed against, so an
 * address that is accepted is by construction an address a list can name.
 *
 * This is deliberately **not** a uniqueness rule. Two fields may share an
 * address; that is refused only where it is actually ambiguous — when a list on
 * their own screen names it — and is left alone everywhere else.
 */
function checkCollectAddress(
  text: string,
  prop: MarkupProp,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  if (isFacetIdentifier(text)) {
    return null;
  }
  return invalidValue(
    `\`${spec.tag}.${prop.name}\` is this field's collection address; \`${excerpt(text)}\` is not a field name.`,
    `Write one name of at most ${BOUNDS.identifierChars} characters, beginning with a letter and continuing with letters, digits, \`_\` or \`-\`.`,
    location,
  );
}

/**
 * Resolves one collection request list against the collectable fields its own
 * screen declares.
 *
 * Five faults, in one fixed order — the shape of the list before what it names,
 * and within each, the first offending name as written. (The sixth cause a
 * request list has, a reference where a literal belongs, is answered before the
 * text is a text at all, so it never reaches here.) Every one of them reports at
 * the list's value, so source order alone would not separate them; the order here
 * is the one that makes the later question meaningful rather than the one a check
 * happens to run first.
 */
function checkCollectList(
  text: string,
  prop: MarkupProp,
  spec: ComponentSpec,
  location: SourceLocation,
  collect: CollectScope,
): AuthorError | null {
  const invalid = (cause: string, repair: string): AuthorError =>
    invalidValue(cause, repair, location);
  const named = `\`${spec.tag}.${prop.name}\``;
  const names = text.split(COLLECT_SEPARATOR).filter((name) => name.length > 0);

  const malformed = names.find((name) => !isFacetIdentifier(name));
  if (malformed !== undefined) {
    return invalid(
      `${named} names the fields to collect; \`${excerpt(malformed)}\` is not a field name.`,
      `Separate names with single spaces, each at most ${BOUNDS.identifierChars} characters of letters, digits, \`_\` or \`-\`.`,
    );
  }
  const distinct = new Set(names);
  if (distinct.size > BOUNDS.collectFieldsPerEvent) {
    return invalid(
      `${named} names ${distinct.size} fields; one event carries at most ${BOUNDS.collectFieldsPerEvent}.`,
      `Name at most ${BOUNDS.collectFieldsPerEvent} fields here, and ask for the rest on a further exchange.`,
    );
  }
  for (const name of names) {
    const declared = collect.inScreen.get(name) ?? 0;
    if (declared === 1) {
      continue;
    }
    if (declared > 1) {
      return invalid(
        `${declared} fields on this screen are named \`${excerpt(name)}\`, so collecting it selects no one field.`,
        "Give every collectable field on a screen its own name, and collect that name.",
      );
    }
    if (collect.inDocument.has(name)) {
      return invalid(
        `\`${excerpt(name)}\` is declared on another screen, and a control collects only from its own.`,
        "Collect a field this screen declares, or declare that field on this screen too.",
      );
    }
    return invalid(
      `\`${excerpt(name)}\` names no collectable field this document declares.`,
      "Name a collectable component's `name` from this same screen, or add that field in the same call.",
    );
  }
  return null;
}

function checkReference(
  scheme: ReferenceScheme,
  target: string,
  prop: MarkupProp,
  schema: PropSchema,
  spec: ComponentSpec,
  document: ComponentDocument,
  dataModel: DataModel,
  assetRegistry: FacetAssetRegistry,
  location: SourceLocation,
): AuthorError | null {
  if (scheme === "asset") {
    if (schema.type !== "string" || schema.assetKind !== "image") {
      return authorError({
        code: "invalid-value",
        location,
        cause: `\`${spec.tag}.${prop.name}\` does not declare an image asset, so it cannot use \`asset:${excerpt(target)}\`.`,
        repair: "Use asset:key only on a prop whose component spec declares assetKind image.",
      });
    }
    const resolved = resolveFacetAsset(assetRegistry, target, schema.assetKind);
    return resolved === null
      ? authorError({
          code: "invalid-value",
          location,
          cause: `\`asset:${excerpt(target)}\` names no compatible host-pinned image asset.`,
          repair: "Use an image key present in this session's asset registry.",
        })
      : null;
  }
  if (schema.type === "string" && schema.assetKind === "image") {
    return authorError({
      code: "invalid-value",
      location,
      cause: `\`${spec.tag}.${prop.name}\` accepts only a host-pinned \`asset:<key>\` reference, not \`${scheme}:${excerpt(target)}\`.`,
      repair: "Use an image key present in this session's asset registry.",
    });
  }
  if (scheme === "data") {
    return checkBinding(target, prop, schema, location, dataModel);
  }
  if (schema.type !== "string") {
    return authorError({
      code: "invalid-value",
      location,
      cause: `\`${spec.tag}.${prop.name}\` is declared ${schema.type}, so it cannot carry a \`${scheme}:\` action.`,
      repair:
        "Put the action on a prop the component declares for one, and bind data with a `data:` reference.",
    });
  }
  const action = parseAction(`${scheme}:${target}`, document);
  if (action.ok) {
    return null;
  }
  if (action.reason === "unknown_screen") {
    return authorError({
      code: "unknown-screen",
      location,
      cause: `\`nav:${excerpt(target)}\` names no screen this document declares.`,
      repair:
        "Navigate to a `<Screen>` in this same document, or add that screen in the same call.",
    });
  }
  return authorError({
    code: "invalid-action",
    location,
    cause: `\`${scheme}:${excerpt(target)}\` is not an action. An action is \`nav:<screen>\` or \`agent:<event>\`.`,
    repair: `Name one screen or one event, at most ${BOUNDS.identifierChars} characters, using letters, digits, \`_\` or \`-\`.`,
  });
}

function checkBinding(
  target: string,
  prop: MarkupProp,
  schema: PropSchema,
  location: SourceLocation,
  dataModel: DataModel,
): AuthorError | null {
  const resolved = resolveBinding(target, dataModel, schema);
  if (resolved.ok) {
    return null;
  }
  if (resolved.reason === "prop_not_bindable" || resolved.reason === "invalid_prop_schema") {
    return authorError({
      code: "binding-not-allowed",
      location,
      cause: `\`${prop.name}\` is not declared bindable, so it reads no data.`,
      repair: "Write the value inline, or use a prop whose spec declares `bindable`.",
    });
  }
  if (resolved.reason === "invalid_reference") {
    return authorError({
      code: "invalid-value",
      location,
      cause: `\`data:${excerpt(target)}\` is not a data path. A path is dotted named keys.`,
      repair: `Write named keys only, at most ${BOUNDS.dataPathDepth} deep, such as \`data:sales.total\`.`,
    });
  }
  if (resolved.reason === "path_not_found") {
    return authorError({
      code: "unresolved-binding",
      location,
      cause: `\`data:${excerpt(target)}\` selects nothing in the Data Model.`,
      repair: "Publish that path first, or bind a path the Data Model summary already lists.",
    });
  }
  return authorError({
    code: "unresolved-binding",
    location,
    cause: `\`data:${excerpt(target)}\` holds a value that is not a ${schema.type}.`,
    repair: `Bind a path whose value is a ${schema.type}, or publish the value in that shape.`,
  });
}

function checkScalar(
  text: string,
  prop: MarkupProp,
  schema: PropSchema,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  if (text.startsWith(LOCAL_SCHEME_PREFIX)) {
    return authorError({
      code: "unknown-scheme",
      location,
      cause: `\`${excerpt(text)}\` uses the \`${LOCAL_SCHEME_PREFIX}\` scheme. The vocabulary is \`nav:\` and \`agent:\` only.`,
      repair:
        "Move the visitor with `nav:<screen>`, or send the interaction to the agent with `agent:<event>`.",
    });
  }
  if (looksStructured(text)) {
    return authorError({
      code: "inline-structure",
      location,
      cause: `\`${excerpt(text)}\` is inline structured JSON. A prop takes one scalar, not a payload.`,
      repair: "Publish the structure as data and bind it with a `data:` reference.",
    });
  }
  switch (schema.type) {
    case "array":
    case "object":
      return authorError({
        code: "invalid-value",
        location,
        cause: `\`${spec.tag}.${prop.name}\` is declared ${schema.type}, which only a \`data:\` reference can fill.`,
        repair: `Publish the ${schema.type} and write \`${prop.name}="data:<path>"\`.`,
      });
    case "boolean":
      return BOOLEAN_LITERALS.includes(text)
        ? null
        : authorError({
            code: "invalid-value",
            location,
            cause: `\`${spec.tag}.${prop.name}\` is a boolean; \`${excerpt(text)}\` is not \`true\` or \`false\`.`,
            repair: `Write \`${prop.name}="true"\` or \`${prop.name}="false"\`.`,
          });
    case "number":
      return checkNumber(text, prop, schema, spec, location);
    case "string":
      if (schema.assetKind === "image") {
        return authorError({
          code: "invalid-value",
          location,
          cause: `\`${spec.tag}.${prop.name}\` accepts a host-pinned image asset, not a URL or literal string.`,
          repair: `Write \`${prop.name}="asset:<key>"\` using a key from this session's asset registry.`,
        });
      }
      return schema.enum === undefined || schema.enum.includes(text)
        ? null
        : authorError({
            code: "invalid-value",
            location,
            cause: `\`${excerpt(text)}\` is not a value \`${spec.tag}.${prop.name}\` admits.`,
            repair: `Use one of: ${excerpt(schema.enum.join(", "))}.`,
          });
  }
}

function checkNumber(
  text: string,
  prop: MarkupProp,
  schema: Extract<PropSchema, { readonly type: "number" }>,
  spec: ComponentSpec,
  location: SourceLocation,
): AuthorError | null {
  const invalid = (cause: string, repair: string): AuthorError =>
    authorError({ code: "invalid-value", location, cause, repair });
  const amount = parseAuthoredNumber(text);
  if (amount === null) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` is a number; \`${excerpt(text)}\` is not one.`,
      `Write a plain decimal, such as \`${prop.name}="42"\`.`,
    );
  }
  if (schema.enum !== undefined && !schema.enum.includes(amount)) {
    return invalid(
      `\`${excerpt(text)}\` is not a value \`${spec.tag}.${prop.name}\` admits.`,
      `Use one of: ${excerpt(schema.enum.join(", "))}.`,
    );
  }
  if (schema.minimum !== undefined && amount < schema.minimum) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` starts at ${schema.minimum}; \`${excerpt(text)}\` is below it.`,
      `Write a value of at least ${schema.minimum}.`,
    );
  }
  if (schema.maximum !== undefined && amount > schema.maximum) {
    return invalid(
      `\`${spec.tag}.${prop.name}\` stops at ${schema.maximum}; \`${excerpt(text)}\` is above it.`,
      `Write a value of at most ${schema.maximum}.`,
    );
  }
  return null;
}
