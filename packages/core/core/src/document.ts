/**
 * The stored component document.
 *
 * A document is the `Facet` envelope — one `entry` screen and an ordered set of
 * named `Screen` roots — over a **flat node map keyed by a Facet-generated
 * stable id**. Children are recorded as ids rather than nested objects for three
 * reasons: `update_node` addresses a node in one lookup, an RFC 6902 operation
 * can name `/document/nodes/n4/props/label` instead of a positional path that
 * shifts whenever a sibling moves, and the whole structure stays plain JSON so
 * the same value travels to the store, over the wire, and into the browser fold.
 *
 * **Ids are Facet's, never the author's.** `id` is a reserved attribute: the
 * author grammar rejects it (WU-13) and the serializer emits it on every
 * element, which is what makes write and read *one* grammar differing only by
 * that attribute. `buildDocument` therefore reads ids when the markup carries
 * them and allocates the rest, so a document rebuilt from its own read-back text
 * keeps every id it had. That is also the whole mechanism behind id **stability
 * across accepted mutations**: a mutation edits the read-back markup, so the ids
 * of untouched nodes travel with the text and only genuinely new nodes are
 * allocated — above the highest id already present, so a fresh id never collides
 * with a live one.
 *
 * `buildDocument` is **total**: it never throws, for any input of any type, and
 * its walk is iterative and node-budgeted, so neither a deep nor a
 * self-referential ast can exhaust the stack or fail to terminate. It answers
 * with a document or `null`; the structured author error for a malformed
 * document belongs to validation, not to the constructor.
 */

import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";
import type { MarkupAst, MarkupNode } from "./markup-parser.js";

/**
 * The parser's prop value, derived from `MarkupNode` rather than imported: the
 * ast's value, prop and scheme aliases are internal to the grammar and stay off
 * the package barrel, so no consumer — this module included — may name one.
 *
 * The implementation deliberately keeps working in the *parser's* type while
 * `ComponentNode` writes the union out for itself. That is what holds the two in
 * step: `buildProps` produces this value and `build` stores it as a
 * `ComponentNode`, so a grammar that grew a value the document does not restate
 * would stop compiling here rather than drift silently. The other direction is
 * pinned by a mutual-assignability check in `document.test.ts`.
 */
type MarkupValue = MarkupNode["props"][number]["value"];

/** The envelope tag. It is grammar, not a catalog component: it mounts nothing. */
const ENVELOPE_TAG = "Facet";

/** The one tag a document's roots may take. */
const SCREEN_TAG = "Screen";

const ENTRY_PROP = "entry";
const NAME_PROP = "name";

/** The reserved read-only attribute. */
const ID_PROP = "id";

/** Generated ids are `n` followed by a positive decimal with no leading zero. */
const ID_PATTERN = /^n[1-9][0-9]*$/;

const ID_PREFIX = "n";

/**
 * One element of the document: its tag, its authored props, and its children by
 * id. The node's own id is the key it is stored under — recording it twice would
 * create a disagreement a corrupt document could exploit.
 *
 * `props` spells its value union out in full rather than naming a type from the
 * parser. The set is closed and small — a literal quoted scalar, or a reference
 * under one of the three explicit schemes — and writing it here keeps the public
 * declaration standalone: a consumer reads the whole contract without following
 * an alias into the ast, and the grammar stays free to rename its internals.
 */
export interface ComponentNode {
  readonly tag: string;
  /** The named region this node fills in its parent, when present. */
  readonly slot?: string;
  readonly props: Readonly<
    Record<
      string,
      | { readonly kind: "scalar"; readonly value: string }
      | {
          readonly kind: "reference";
          readonly scheme: "data" | "nav" | "agent" | "asset";
          readonly target: string;
        }
    >
  >;
  readonly children: readonly string[];
}

/** The stored document: the `Facet` envelope over a flat, id-keyed node map. */
export interface ComponentDocument {
  /** The screen a visitor lands on. Always the name of one of `screens`. */
  readonly entry: string;
  /** Screen root node ids, in authored order. */
  readonly screens: readonly string[];
  /** Every node in the document, keyed by its stable id. */
  readonly nodes: Readonly<Record<string, ComponentNode>>;
}

/** A node discovered by the walk, with the index of the parent that holds it. */
interface Visit {
  readonly node: MarkupNode;
  readonly parentIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A markup node, checked structurally because the ast may be synthesised. */
function isMarkupNode(value: unknown): value is MarkupNode {
  return (
    isRecord(value) &&
    typeof value["tag"] === "string" &&
    (!("slot" in value) ||
      (typeof value["slot"] === "string" && isFacetIdentifier(value["slot"]))) &&
    Array.isArray(value["props"]) &&
    Array.isArray(value["children"])
  );
}

/** Reads one authored prop by name, or `null` when it is absent or repeated. */
function readProp(node: MarkupNode, name: string): MarkupValue | null {
  let found: MarkupValue | null = null;
  for (const prop of node.props) {
    if (!isRecord(prop) || prop["name"] !== name) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    const value: unknown = prop["value"];
    if (!isRecord(value)) {
      return null;
    }
    found = value as unknown as MarkupValue;
  }
  return found;
}

/** Reads one authored prop that must be a literal scalar. */
function readScalarProp(node: MarkupNode, name: string): string | null {
  const value = readProp(node, name);
  if (value === null || value.kind !== "scalar") {
    return null;
  }
  return value.value;
}

/**
 * Collects every node under the screens in document pre-order.
 *
 * The walk is an explicit stack rather than recursion, and it stops the moment
 * it has seen more nodes than a document may hold, so a synthesised ast that
 * points back at itself terminates instead of running forever.
 */
function collect(screens: readonly MarkupNode[]): readonly Visit[] | null {
  const visits: Visit[] = [];
  const stack: Visit[] = [];
  for (let index = screens.length - 1; index >= 0; index -= 1) {
    const screen = screens[index];
    if (screen === undefined) {
      return null;
    }
    stack.push({ node: screen, parentIndex: -1 });
  }
  while (stack.length > 0) {
    const visit = stack.pop();
    if (visit === undefined) {
      break;
    }
    if (visits.length >= BOUNDS.nodesPerDocument) {
      return null;
    }
    const parentIndex = visits.length;
    visits.push(visit);
    const children = visit.node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!isMarkupNode(child)) {
        return null;
      }
      stack.push({ node: child, parentIndex });
    }
  }
  return visits;
}

/**
 * Reads the id each visited node already carries, rejecting a malformed or
 * repeated one, and reports the highest so fresh allocation starts above it.
 */
function readReservedIds(
  visits: readonly Visit[],
): { readonly reserved: readonly (string | null)[]; readonly highest: number } | null {
  const reserved: (string | null)[] = [];
  const seen = new Set<string>();
  let highest = 0;
  for (const visit of visits) {
    const carried = readProp(visit.node, ID_PROP);
    if (carried === null) {
      reserved.push(null);
      continue;
    }
    if (carried.kind !== "scalar" || !ID_PATTERN.test(carried.value) || seen.has(carried.value)) {
      return null;
    }
    seen.add(carried.value);
    reserved.push(carried.value);
    const ordinal = Number.parseInt(carried.value.slice(ID_PREFIX.length), 10);
    highest = Math.max(highest, ordinal);
  }
  return { reserved, highest };
}

/** Builds one node's prop record, dropping the reserved id attribute. */
function buildProps(node: MarkupNode): Readonly<Record<string, MarkupValue>> | null {
  const props: Record<string, MarkupValue> = {};
  for (const prop of node.props) {
    if (!isRecord(prop)) {
      return null;
    }
    const name = prop["name"];
    if (typeof name !== "string" || !isFacetIdentifier(name)) {
      return null;
    }
    if (name === ID_PROP) {
      continue;
    }
    const value: unknown = prop["value"];
    if (!isRecord(value)) {
      return null;
    }
    props[name] = value as unknown as MarkupValue;
  }
  return Object.freeze(props);
}

/**
 * Builds a document from parsed markup, or returns `null` when the markup is
 * not a well-formed `Facet` envelope.
 *
 * Total: any input of any type yields a document or `null`, never an exception.
 */
export function buildDocument(ast: MarkupAst): ComponentDocument | null {
  try {
    return build(ast);
  } catch {
    return null;
  }
}

function build(ast: MarkupAst): ComponentDocument | null {
  const envelope = readEnvelope(ast);
  if (envelope === null) {
    return null;
  }
  const visits = collect(envelope.screens);
  if (visits === null) {
    return null;
  }
  const reserved = readReservedIds(visits);
  if (reserved === null) {
    return null;
  }

  const ids = allocateIds(reserved.reserved, reserved.highest);
  const childIds = linkChildren(visits, ids);
  if (childIds === null) {
    return null;
  }

  const screenNames = new Set<string>();
  const screens: string[] = [];
  const nodes: Record<string, ComponentNode> = {};
  for (const [index, visit] of visits.entries()) {
    const id = ids[index];
    const children = childIds[index];
    if (id === undefined || children === undefined) {
      return null;
    }
    if (visit.parentIndex < 0) {
      const name = screenName(visit.node);
      if (name === null || screenNames.has(name)) {
        return null;
      }
      screenNames.add(name);
      screens.push(id);
    }
    const props = buildProps(visit.node);
    if (props === null) {
      return null;
    }
    nodes[id] = Object.freeze({
      tag: visit.node.tag,
      ...(visit.node.slot === undefined ? {} : { slot: visit.node.slot }),
      props,
      children: Object.freeze(children),
    });
  }
  if (!screenNames.has(envelope.entry)) {
    return null;
  }

  return Object.freeze({
    entry: envelope.entry,
    screens: Object.freeze(screens),
    nodes: Object.freeze(nodes),
  });
}

/**
 * Fills in the ids the markup did not carry, in document pre-order and above the
 * highest id already present — so a fresh id can never collide with a live one,
 * and re-running the same markup allocates the same ids.
 */
function allocateIds(reserved: readonly (string | null)[], highest: number): readonly string[] {
  const ids: string[] = [];
  let next = highest + 1;
  for (const carried of reserved) {
    if (carried !== null) {
      ids.push(carried);
      continue;
    }
    ids.push(`${ID_PREFIX}${next}`);
    next += 1;
  }
  return ids;
}

/** Turns the parent links the walk recorded into each node's ordered child ids. */
function linkChildren(
  visits: readonly Visit[],
  ids: readonly string[],
): readonly string[][] | null {
  const childIds: string[][] = visits.map(() => []);
  for (const [index, visit] of visits.entries()) {
    const id = ids[index];
    if (id === undefined) {
      return null;
    }
    if (visit.parentIndex >= 0) {
      childIds[visit.parentIndex]?.push(id);
    }
  }
  return childIds;
}

/** A screen root: the reserved tag plus a name that is a Facet identifier. */
function screenName(node: MarkupNode): string | null {
  if (node.tag !== SCREEN_TAG || node.slot !== undefined) {
    return null;
  }
  const name = readScalarProp(node, NAME_PROP);
  if (name === null || !isFacetIdentifier(name)) {
    return null;
  }
  return name;
}

/**
 * Reads the envelope: exactly one root, tagged `Facet`, carrying exactly the
 * `entry` attribute and at least one screen. The form is closed — an unknown
 * envelope attribute is a rejection, never an ignored extra.
 */
function readEnvelope(
  ast: MarkupAst,
): { readonly entry: string; readonly screens: readonly MarkupNode[] } | null {
  if (!isRecord(ast) || !Array.isArray(ast.roots) || ast.roots.length !== 1) {
    return null;
  }
  const root: unknown = ast.roots[0];
  if (
    !isMarkupNode(root) ||
    root.tag !== ENVELOPE_TAG ||
    root.slot !== undefined ||
    root.props.length !== 1
  ) {
    return null;
  }
  const entry = readScalarProp(root, ENTRY_PROP);
  if (entry === null || !isFacetIdentifier(entry)) {
    return null;
  }
  if (root.children.length === 0) {
    return null;
  }
  const screens: MarkupNode[] = [];
  for (const child of root.children) {
    if (!isMarkupNode(child)) {
      return null;
    }
    screens.push(child);
  }
  return { entry, screens: Object.freeze(screens) };
}
