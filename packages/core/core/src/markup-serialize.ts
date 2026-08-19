/**
 * The document serializer — the read half of one grammar.
 *
 * `serializeDocument` writes the whole `Facet` envelope; `serializeScreen`
 * writes one screen on its own, which is what `read_screen` hands the agent.
 * Both emit exactly the grammar an author writes, plus the reserved read-only
 * `id` on every element, so `buildDocument(parseMarkup(serializeDocument(doc)))`
 * reproduces the same document — ids included.
 *
 * **Totality is the point of this module.** The renderer can degrade a corrupt
 * node in the browser (WU-33), but the *server* is the first consumer of an
 * untrusted persisted document, and there an unbounded walk inside the single
 * write lane would hang the process. So both walks are iterative and thread a
 * **visited-node-id set for the current path** and a **`B-03` depth counter**,
 * exactly as `mountOrFallback` does. A node already on the path, a subtree past
 * `B-03`, a dangling child id, a node that cannot be read as an element, and a
 * document past the `B-07` node budget are each emitted as one bounded
 * placeholder element for that subtree root and recorded as a structured issue —
 * **and every valid sibling still serializes**. Neither function recurses, and
 * neither throws, for any input of any type.
 *
 * A second, quieter guarantee holds the read-back honest: **whatever is emitted
 * parses back to what it looks like.** A tag that is not a component tag, a prop
 * name that is not an identifier, a value longer than `B-05`, a value containing
 * both quote characters, and a stored scalar that would re-read as a `data:`
 * reference or as inline JSON are each dropped with an issue rather than written
 * out. A corrupt persisted document therefore cannot smuggle structure into the
 * snapshot an agent reads back.
 *
 * The one degrade that does not re-parse is the `B-03` cut: the placeholder
 * stands where the cut subtree stood, so it occupies the first level *past* the
 * bound. A document that deep has no legal markup at all, so the output names
 * the fault deterministically instead of inventing a shallower shape it does not
 * have.
 */

import { BOUNDS } from "./bounds.js";
import type { ComponentDocument } from "./document.js";
import { isFacetIdentifier } from "./identifiers.js";

const ENVELOPE_TAG = "Facet";

const ENTRY_PROP = "entry";

const NAME_PROP = "name";

/** The reserved read-only attribute this module adds and never reads back in. */
const ID_PROP = "id";

/** The bounded stand-in for a subtree that could not be written out. */
const PLACEHOLDER_TAG = "Unavailable";

const INDENT_UNIT = " ".repeat(2);

/** The envelope itself occupies the first level of `B-03`. */
const ENVELOPE_DEPTH = 1;

/** The four schemes the grammar admits; a stored value outside them is corrupt. */
const REFERENCE_SCHEMES: readonly string[] = ["data", "nav", "agent", "asset"];

/** The two characters that open inline structured JSON, which the grammar rejects. */
const JSON_OPENERS: readonly string[] = ["{", "["];

const QUOTE_CHARACTERS = { double: '"', single: "'" } as const;

/**
 * Why part of a document could not be written as markup. Closed and structured:
 * a reader decides what a degraded snapshot means in its own layer, and never
 * has to parse prose to find out what happened.
 */
export interface SerializeIssue {
  readonly reason:
    | "cycle"
    | "depth"
    | "missing-node"
    | "missing-screen"
    | "invalid-node"
    | "invalid-document"
    | "unrepresentable-prop"
    | "too-many-nodes";
  /** The node id concerned — or the requested screen name for `missing-screen`. */
  readonly at: string;
  /** The prop concerned, for `unrepresentable-prop`. */
  readonly prop?: string;
}

/** The markup, plus everything that had to be degraded to produce it. */
export interface SerializeResult {
  readonly text: string;
  readonly issues: readonly SerializeIssue[];
}

/** The document fields a walk needs, read defensively because storage is untrusted. */
interface ReadDocument {
  readonly entry: string;
  readonly screens: readonly string[];
  readonly nodes: Readonly<Record<string, unknown>>;
}

/** One element, already rendered down to the two strings a line needs. */
type ElementRead =
  | {
      readonly kind: "element";
      readonly tag: string;
      readonly attributes: string;
      readonly children: readonly string[];
      readonly issues: readonly SerializeIssue[];
    }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" };

/** A pending unit of work. `exit` carries its own closing line, so tags balance. */
type Step =
  | { readonly kind: "enter"; readonly id: string; readonly depth: number }
  | { readonly kind: "exit"; readonly id: string; readonly line: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A component tag is a Facet identifier that starts with a capital. */
function isComponentTag(value: unknown): value is string {
  if (!isFacetIdentifier(value)) {
    return false;
  }
  const first = value.charCodeAt(0);
  return first >= 0x41 && first <= 0x5a;
}

function result(text: string, issues: readonly SerializeIssue[]): SerializeResult {
  return Object.freeze({ text, issues: Object.freeze([...issues]) });
}

function invalidDocument(): SerializeResult {
  return result("", [{ reason: "invalid-document", at: "" }]);
}

function placeholder(pad: string, id: string): string {
  return `${pad}<${PLACEHOLDER_TAG} ${ID_PROP}="${id}" />`;
}

/**
 * Whether a stored scalar still reads back as a scalar. A value that begins with
 * a reference prefix or opens inline JSON would be reclassified by the parser,
 * so writing it out would change the document rather than describe it.
 */
function isPlainScalar(text: string): boolean {
  const lead = text.trimStart();
  if (JSON_OPENERS.some((opener) => lead.startsWith(opener))) {
    return false;
  }
  return !REFERENCE_SCHEMES.some((scheme) => text.startsWith(`${scheme}:`));
}

/** Renders one stored prop value back to its authored text, or `null`. */
function renderValue(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value["kind"];
  if (kind === "scalar") {
    const text = value["value"];
    return typeof text === "string" && isPlainScalar(text) ? text : null;
  }
  if (kind === "reference") {
    const scheme = value["scheme"];
    const target = value["target"];
    if (typeof scheme !== "string" || !REFERENCE_SCHEMES.includes(scheme)) {
      return null;
    }
    if (typeof target !== "string" || target.length === 0) {
      return null;
    }
    return `${scheme}:${target}`;
  }
  return null;
}

/**
 * Quotes a value with the delimiter it does not contain. Values carry no escape
 * sequences, so a value holding both delimiters is unwritable — and a value past
 * `B-05` would be rejected on the way back in, which is the same thing.
 */
function quoteValue(text: string): string | null {
  if (text.length > BOUNDS.attributeValueChars) {
    return null;
  }
  if (!text.includes(QUOTE_CHARACTERS.double)) {
    return `${QUOTE_CHARACTERS.double}${text}${QUOTE_CHARACTERS.double}`;
  }
  if (!text.includes(QUOTE_CHARACTERS.single)) {
    return `${QUOTE_CHARACTERS.single}${text}${QUOTE_CHARACTERS.single}`;
  }
  return null;
}

/** Renders one `name="value"` pair, or `null` when it cannot be written. */
function renderAttribute(name: string, value: unknown): string | null {
  if (name === ID_PROP || !isFacetIdentifier(name)) {
    return null;
  }
  const text = renderValue(value);
  if (text === null) {
    return null;
  }
  const quoted = quoteValue(text);
  return quoted === null ? null : `${name}=${quoted}`;
}

/** Reads one own member without inheriting anything the host did not publish. */
function readOwn(container: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(container, key) ? container[key] : undefined;
}

/**
 * Reads one node into the pieces a line needs. Every read happens inside the
 * one `try`, so even a hostile getter degrades this node to a placeholder rather
 * than unwinding the whole walk.
 */
function readElement(nodes: Readonly<Record<string, unknown>>, id: string): ElementRead {
  try {
    const node = readOwn(nodes, id);
    if (node === undefined) {
      return { kind: "missing" };
    }
    if (!isRecord(node)) {
      return { kind: "invalid" };
    }
    const tag = node["tag"];
    if (!isComponentTag(tag)) {
      return { kind: "invalid" };
    }
    const slot = node["slot"];
    if (slot !== undefined && (typeof slot !== "string" || !isFacetIdentifier(slot))) {
      return { kind: "invalid" };
    }
    const props = node["props"];
    const rawChildren = node["children"];
    if (!isRecord(props) || !Array.isArray(rawChildren)) {
      return { kind: "invalid" };
    }
    const children: string[] = [];
    for (const child of rawChildren) {
      if (typeof child !== "string") {
        return { kind: "invalid" };
      }
      children.push(child);
    }
    const issues: SerializeIssue[] = [];
    const attributes: string[] = [];
    if (typeof slot === "string") {
      attributes.push(`slot="${slot}"`);
    }
    for (const [name, value] of Object.entries(props)) {
      const rendered = renderAttribute(name, value);
      if (rendered === null) {
        issues.push({ reason: "unrepresentable-prop", at: id, prop: name });
        continue;
      }
      attributes.push(rendered);
    }
    attributes.push(`${ID_PROP}="${id}"`);
    return {
      kind: "element",
      tag,
      attributes: attributes.join(" "),
      children,
      issues,
    };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * Writes one subtree, iteratively.
 *
 * `onPath` holds the ids of the ancestors currently open, so a child pointing
 * back at one of them is a cycle; `depth` is checked against `B-03`; and
 * `entered` caps the whole walk at `B-07`, which is what keeps a corrupt
 * persisted graph — where the same node is reachable through many parents —
 * from expanding without bound.
 */
function walk(
  nodes: Readonly<Record<string, unknown>>,
  rootId: string,
  startDepth: number,
  lines: string[],
  issues: SerializeIssue[],
): void {
  const onPath = new Set<string>();
  const stack: Step[] = [{ kind: "enter", id: rootId, depth: startDepth }];
  let entered = 0;
  let exhausted = false;

  while (stack.length > 0) {
    const step = stack.pop();
    if (step === undefined) {
      break;
    }
    if (step.kind === "exit") {
      onPath.delete(step.id);
      lines.push(step.line);
      continue;
    }
    if (entered >= BOUNDS.nodesPerDocument) {
      if (!exhausted) {
        exhausted = true;
        issues.push({ reason: "too-many-nodes", at: step.id });
      }
      continue;
    }
    entered += 1;

    const pad = INDENT_UNIT.repeat(Math.max(0, step.depth - 1));
    if (onPath.has(step.id)) {
      issues.push({ reason: "cycle", at: step.id });
      lines.push(placeholder(pad, step.id));
      continue;
    }
    if (step.depth > BOUNDS.elementDepth) {
      issues.push({ reason: "depth", at: step.id });
      lines.push(placeholder(pad, step.id));
      continue;
    }
    const element = readElement(nodes, step.id);
    if (element.kind !== "element") {
      issues.push({
        reason: element.kind === "missing" ? "missing-node" : "invalid-node",
        at: step.id,
      });
      lines.push(placeholder(pad, step.id));
      continue;
    }

    issues.push(...element.issues);
    const open = `<${element.tag} ${element.attributes}`;
    if (element.children.length === 0) {
      lines.push(`${pad}${open} />`);
      continue;
    }
    onPath.add(step.id);
    lines.push(`${pad}${open}>`);
    stack.push({ kind: "exit", id: step.id, line: `${pad}</${element.tag}>` });
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      const child = element.children[index];
      if (child === undefined) {
        continue;
      }
      stack.push({ kind: "enter", id: child, depth: step.depth + 1 });
    }
  }
}

/** Reads the three document fields defensively; storage is untrusted input. */
function readDocument(document: ComponentDocument): ReadDocument | null {
  if (!isRecord(document)) {
    return null;
  }
  const entry = document["entry"];
  const rawScreens = document["screens"];
  const nodes = document["nodes"];
  if (typeof entry !== "string" || !Array.isArray(rawScreens) || !isRecord(nodes)) {
    return null;
  }
  const screens: string[] = [];
  for (const screen of rawScreens) {
    if (typeof screen !== "string") {
      return null;
    }
    screens.push(screen);
  }
  return { entry, screens, nodes };
}

/** Finds the screen root whose `name` prop matches, or `null`. */
function findScreen(document: ReadDocument, name: unknown): string | null {
  if (typeof name !== "string") {
    return null;
  }
  for (const id of document.screens) {
    if (screenNameOf(document, id) === name) {
      return id;
    }
  }
  return null;
}

/** Reads a screen's declared name straight from the stored node. */
function screenNameOf(document: ReadDocument, id: string): string | null {
  try {
    const node = readOwn(document.nodes, id);
    if (!isRecord(node)) {
      return null;
    }
    const props = node["props"];
    if (!isRecord(props)) {
      return null;
    }
    const value = readOwn(props, NAME_PROP);
    if (!isRecord(value) || value["kind"] !== "scalar") {
      return null;
    }
    const name = value["value"];
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/**
 * Writes the whole document: the `Facet` envelope, then every screen.
 *
 * Total — any input of any type yields a result, never an exception.
 */
export function serializeDocument(document: ComponentDocument): SerializeResult {
  try {
    const read = readDocument(document);
    if (read === null) {
      return invalidDocument();
    }
    const lines: string[] = [];
    const issues: SerializeIssue[] = [];
    const entry = renderAttribute(ENTRY_PROP, { kind: "scalar", value: read.entry });
    if (entry === null) {
      issues.push({ reason: "unrepresentable-prop", at: "", prop: ENTRY_PROP });
    }
    lines.push(entry === null ? `<${ENVELOPE_TAG}>` : `<${ENVELOPE_TAG} ${entry}>`);
    for (const screenId of read.screens) {
      walk(read.nodes, screenId, ENVELOPE_DEPTH + 1, lines, issues);
    }
    lines.push(`</${ENVELOPE_TAG}>`);
    return result(lines.join("\n"), issues);
  } catch {
    return invalidDocument();
  }
}

/**
 * Writes one declared screen, unwrapped — the snapshot `read_screen` returns.
 *
 * Total — any input of any type yields a result, never an exception.
 */
export function serializeScreen(document: ComponentDocument, name: string): SerializeResult {
  try {
    const read = readDocument(document);
    if (read === null) {
      return invalidDocument();
    }
    const rootId = findScreen(read, name);
    if (rootId === null) {
      return result("", [{ reason: "missing-screen", at: typeof name === "string" ? name : "" }]);
    }
    const lines: string[] = [];
    const issues: SerializeIssue[] = [];
    walk(read.nodes, rootId, 1, lines, issues);
    return result(lines.join("\n"), issues);
  } catch {
    return invalidDocument();
  }
}
