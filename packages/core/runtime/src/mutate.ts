import {
  buildDocument,
  nextRevision,
  parseMarkup,
  serializeDocument,
  validateAuthorMarkup,
  type AuthorError,
  type ComponentDocument,
  type JsonPatchOperation,
  type MarkupAst,
  type MarkupNode,
  type StageRevision,
} from "@facet/core";

import type { Session } from "./session.js";
import type { WriteAuthority } from "./turn-gate.js";
import { TurnGate } from "./turn-gate.js";

export type AuthorMutationKind =
  "render_page" | "insert_subtree" | "replace_subtree" | "update_node" | "remove_subtree";

export type AuthorMutationInput = Readonly<Record<string, unknown>>;

type TargetedMutationKind = Exclude<AuthorMutationKind, "render_page">;
type MarkupProp = MarkupNode["props"][number];

export type AuthorMutationResult =
  | {
      readonly ok: true;
      readonly session: Session;
      readonly document: ComponentDocument;
      readonly patches: readonly JsonPatchOperation[];
      readonly stageRevision: StageRevision;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
      readonly currentRevision?: StageRevision;
      readonly error?: AuthorError;
    };

const MUTATION_KINDS: Readonly<Record<AuthorMutationKind, true>> = Object.freeze({
  render_page: true,
  insert_subtree: true,
  replace_subtree: true,
  update_node: true,
  remove_subtree: true,
});

const ID_PROP = "id";
const SCREEN_TAG = "Screen";
const NAME_PROP = "name";
const GENERATED_ID = /^n([1-9]\d*)$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMutationKind(value: unknown): value is AuthorMutationKind {
  return typeof value === "string" && Object.hasOwn(MUTATION_KINDS, value);
}

function readString(input: AuthorMutationInput, key: string): string | null {
  try {
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function reject(
  code: string,
  at: string,
  detail: string,
): Extract<AuthorMutationResult, { ok: false }> {
  return { ok: false, code, at, detail };
}

function stale(
  expectedRevision: StageRevision,
  currentRevision: StageRevision,
): AuthorMutationResult {
  return {
    ok: false,
    code: "stale_revision",
    at: "expectedRevision",
    detail: `The mutation expected revision ${expectedRevision}, but the session is at revision ${currentRevision}.`,
    currentRevision,
  };
}

function authorReject(error: AuthorError): Extract<AuthorMutationResult, { ok: false }> {
  return {
    ok: false,
    code: error.code,
    at: `line ${error.location.line}, column ${error.location.column}`,
    detail: error.cause,
    error,
  };
}

function invalidDocument(detail: string): Extract<AuthorMutationResult, { ok: false }> {
  return reject("invalid_document", "document", detail);
}

function invalidFragment(detail: string): Extract<AuthorMutationResult, { ok: false }> {
  return reject("invalid_fragment", "markup", detail);
}

function readMarkup(
  input: AuthorMutationInput,
): string | Extract<AuthorMutationResult, { ok: false }> {
  const markup = readString(input, "markup");
  if (markup === null) {
    return reject(
      "invalid_markup_input",
      "markup",
      "Authored mutation input must include a markup string.",
    );
  }
  return markup;
}

function validateNextDocument(
  session: Session,
  markup: string,
):
  | { readonly ok: true; readonly document: ComponentDocument }
  | Extract<AuthorMutationResult, { ok: false }> {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    return authorReject(parsed.error);
  }
  const validated = validateAuthorMarkup(parsed.ast, session.catalog, session.data);
  if (!validated.ok) {
    return authorReject(validated.error);
  }
  return { ok: true, document: validated.document };
}

function scalarIdProp(targetId: string, node: MarkupNode): MarkupProp {
  return Object.freeze({
    name: ID_PROP,
    value: Object.freeze({ kind: "scalar" as const, value: targetId }),
    location: node.location,
    valueLocation: node.location,
  });
}

function documentHighWaterMark(document: ComponentDocument): number {
  let highWaterMark = 0;
  for (const id of Object.keys(document.nodes)) {
    const match = GENERATED_ID.exec(id);
    const ordinal = match?.[1] === undefined ? NaN : Number.parseInt(match[1], 10);
    if (Number.isFinite(ordinal)) {
      highWaterMark = Math.max(highWaterMark, ordinal);
    }
  }
  return highWaterMark;
}

function withFreshIds(
  node: MarkupNode,
  nextOrdinal: number,
): { readonly node: MarkupNode; readonly nextOrdinal: number } {
  let next = nextOrdinal + 1;
  const children: MarkupNode[] = [];
  for (const child of node.children) {
    const assigned = withFreshIds(child, next);
    children.push(assigned.node);
    next = assigned.nextOrdinal;
  }
  const assignedNode = cloneNode(
    node,
    [...node.props, scalarIdProp(`n${nextOrdinal}`, node)],
    children,
  );
  return { node: assignedNode, nextOrdinal: next };
}

function cloneNode(
  node: MarkupNode,
  props: readonly MarkupProp[] = node.props,
  children: readonly MarkupNode[] = node.children,
): MarkupNode {
  return Object.freeze({
    ...node,
    props: Object.freeze([...props]),
    children: Object.freeze([...children]),
  });
}

function withSlot(node: MarkupNode, slot: string | undefined): MarkupNode {
  return Object.freeze({
    tag: node.tag,
    ...(slot === undefined ? {} : { slot }),
    props: node.props,
    children: node.children,
    location: node.location,
  });
}

function propScalar(node: MarkupNode, name: string): string | null {
  for (const prop of node.props) {
    if (prop.name !== name) {
      continue;
    }
    const value = prop.value;
    return value.kind === "scalar" ? value.value : null;
  }
  return null;
}

function stripIdProps(node: MarkupNode): MarkupNode {
  return cloneNode(
    node,
    node.props.filter((prop) => prop.name !== ID_PROP),
    node.children.map(stripIdProps),
  );
}

function astWithRoots(roots: readonly MarkupNode[]): MarkupAst {
  return Object.freeze({ roots: Object.freeze([...roots]), nodeCount: countNodes(roots) });
}

function stripIds(ast: MarkupAst): MarkupAst {
  return astWithRoots(ast.roots.map(stripIdProps));
}

function countNodes(roots: readonly MarkupNode[]): number {
  const stack = [...roots];
  let count = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    count += 1;
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return count;
}

function parseCurrentDocument(
  document: ComponentDocument,
): { readonly ok: true; readonly ast: MarkupAst } | Extract<AuthorMutationResult, { ok: false }> {
  const serialized = serializeDocument(document);
  if (serialized.issues.length > 0 || serialized.text.length === 0) {
    return invalidDocument("The current document could not be serialized for mutation.");
  }
  const parsed = parseMarkup(serialized.text);
  if (!parsed.ok) {
    return authorReject(parsed.error);
  }
  return { ok: true, ast: parsed.ast };
}

function parseFragment(
  input: AuthorMutationInput,
): { readonly ok: true; readonly node: MarkupNode } | Extract<AuthorMutationResult, { ok: false }> {
  const markup = readMarkup(input);
  if (typeof markup !== "string") {
    return markup;
  }
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    return authorReject(parsed.error);
  }
  if (parsed.ast.roots.length !== 1) {
    return invalidFragment("A targeted mutation markup value must contain exactly one subtree.");
  }
  const node = parsed.ast.roots[0];
  if (node === undefined) {
    return invalidFragment("A targeted mutation markup value must contain exactly one subtree.");
  }
  if (containsAuthoredId(node)) {
    return reject("reserved-attribute", ID_PROP, "A targeted fragment may not author an id.");
  }
  return { ok: true, node };
}

function containsAuthoredId(root: MarkupNode): boolean {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (node.props.some((prop) => prop.name === ID_PROP)) {
      return true;
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return false;
}

function targetFrom(
  input: AuthorMutationInput,
  kind: TargetedMutationKind,
): { readonly ok: true; readonly targetId: string } | Extract<AuthorMutationResult, { ok: false }> {
  const targetId = readString(input, "targetId");
  if (targetId === null) {
    return reject("invalid_target_id", "targetId", `${kind} requires a targetId string.`);
  }
  return { ok: true, targetId };
}

interface LocatedTarget {
  readonly node: MarkupNode;
}

function nodeId(node: MarkupNode): string | null {
  return propScalar(node, ID_PROP);
}

function findTarget(ast: MarkupAst, targetId: string): LocatedTarget | null {
  const stack = [...ast.roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      break;
    }
    if (nodeId(node) === targetId) {
      return { node };
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return null;
}

function replaceInTree(
  node: MarkupNode,
  targetId: string,
  replacement: MarkupNode | null,
): MarkupNode | null {
  if (nodeId(node) === targetId) {
    return replacement;
  }
  const children: MarkupNode[] = [];
  let changed = false;
  for (const child of node.children) {
    const next = replaceInTree(child, targetId, replacement);
    if (next === null) {
      changed = true;
      continue;
    }
    if (next !== child) {
      changed = true;
    }
    children.push(next);
  }
  return changed ? cloneNode(node, node.props, children) : node;
}

function rewriteTarget(
  ast: MarkupAst,
  targetId: string,
  replacement: MarkupNode | null,
): MarkupAst {
  return astWithRoots(
    ast.roots.flatMap((root) => {
      const next = replaceInTree(root, targetId, replacement);
      return next === null ? [] : [next];
    }),
  );
}

function screenName(node: MarkupNode): string | null {
  return propScalar(node, NAME_PROP);
}

function isScreenRoot(document: ComponentDocument, targetId: string): boolean {
  return document.screens.includes(targetId);
}

function screenBoundaryReject(detail: string): Extract<AuthorMutationResult, { ok: false }> {
  return reject("screen_boundary_violation", "targetId", detail);
}

function screenNameReject(detail: string): Extract<AuthorMutationResult, { ok: false }> {
  return reject("screen_name_changed", NAME_PROP, detail);
}

function checkReplaceBoundary(
  document: ComponentDocument,
  targetId: string,
  target: MarkupNode,
  replacement: MarkupNode,
): Extract<AuthorMutationResult, { ok: false }> | null {
  const targetIsScreen = isScreenRoot(document, targetId);
  if (targetIsScreen && replacement.tag !== SCREEN_TAG) {
    return screenBoundaryReject("A screen root may only be replaced by a Screen subtree.");
  }
  if (!targetIsScreen && replacement.tag === SCREEN_TAG) {
    return screenBoundaryReject("A non-screen subtree may not be replaced by a Screen.");
  }
  if (targetIsScreen && screenName(target) === document.entry) {
    const replacementName = screenName(replacement);
    if (replacementName !== document.entry) {
      return screenNameReject("Replacing the entry Screen must preserve its name.");
    }
  }
  return null;
}

function checkUpdateBoundary(
  document: ComponentDocument,
  targetId: string,
  target: MarkupNode,
  replacement: MarkupNode,
): Extract<AuthorMutationResult, { ok: false }> | null {
  const targetIsScreen = isScreenRoot(document, targetId);
  if (targetIsScreen && replacement.tag !== SCREEN_TAG) {
    return screenBoundaryReject("A screen root may only be updated as a Screen.");
  }
  if (!targetIsScreen && replacement.tag === SCREEN_TAG) {
    return screenBoundaryReject("A non-screen node may not be updated into a Screen.");
  }
  if (targetIsScreen && screenName(replacement) !== screenName(target)) {
    return screenNameReject("Updating a Screen must preserve its name.");
  }
  return null;
}

function validateCandidate(
  session: Session,
  candidateAst: MarkupAst,
):
  | { readonly ok: true; readonly document: ComponentDocument }
  | Extract<AuthorMutationResult, { ok: false }> {
  const validated = validateAuthorMarkup(stripIds(candidateAst), session.catalog, session.data);
  if (!validated.ok) {
    return authorReject(validated.error);
  }
  const document = buildDocument(candidateAst);
  if (document === null) {
    return invalidDocument("The candidate document could not preserve stable ids.");
  }
  return { ok: true, document };
}

function targetedDocument(
  session: Session,
  kind: TargetedMutationKind,
  input: AuthorMutationInput,
):
  | { readonly ok: true; readonly document: ComponentDocument }
  | Extract<AuthorMutationResult, { ok: false }> {
  const document = session.document;
  if (document === null) {
    return reject(
      "page_not_rendered",
      "document",
      `${kind} requires an existing page. Use render_page first.`,
    );
  }
  const target = targetFrom(input, kind);
  if (!target.ok) {
    return target;
  }
  if (!Object.hasOwn(document.nodes, target.targetId)) {
    return reject(
      "unknown_target_id",
      "targetId",
      `Mutation target "${target.targetId}" does not exist.`,
    );
  }
  if (kind === "remove_subtree" && document.screens.includes(target.targetId)) {
    const node = document.nodes[target.targetId];
    const name = node?.props[NAME_PROP];
    if (name?.kind === "scalar" && name.value === document.entry) {
      return reject(
        "entry_screen_root_removal",
        "targetId",
        `Mutation target "${target.targetId}" is the entry screen root; use render_page instead.`,
      );
    }
  }

  const current = parseCurrentDocument(document);
  if (!current.ok) {
    return current;
  }
  const located = findTarget(current.ast, target.targetId);
  if (located === null) {
    return invalidDocument("The current document does not contain the requested target id.");
  }

  if (kind === "remove_subtree") {
    return validateCandidate(session, rewriteTarget(current.ast, target.targetId, null));
  }

  const fragment = parseFragment(input);
  if (!fragment.ok) {
    return fragment;
  }
  const freshFragment = withFreshIds(fragment.node, documentHighWaterMark(document) + 1).node;

  if (kind === "insert_subtree") {
    if (freshFragment.tag === SCREEN_TAG) {
      return screenBoundaryReject("A Screen cannot be inserted inside another node.");
    }
    const inserted = cloneNode(located.node, located.node.props, [
      ...located.node.children,
      freshFragment,
    ]);
    return validateCandidate(session, rewriteTarget(current.ast, target.targetId, inserted));
  }

  if (kind === "replace_subtree") {
    const replacement =
      freshFragment.slot === undefined ? withSlot(freshFragment, located.node.slot) : freshFragment;
    const boundary = checkReplaceBoundary(document, target.targetId, located.node, replacement);
    if (boundary !== null) {
      return boundary;
    }
    return validateCandidate(session, rewriteTarget(current.ast, target.targetId, replacement));
  }

  if (freshFragment.children.length > 0) {
    return invalidFragment("update_node markup must be one childless component declaration.");
  }
  if (freshFragment.slot !== undefined && freshFragment.slot !== located.node.slot) {
    return invalidFragment("update_node markup must preserve the target slot.");
  }
  const boundary = checkUpdateBoundary(document, target.targetId, located.node, freshFragment);
  if (boundary !== null) {
    return boundary;
  }
  const updated = cloneNode(
    withSlot(freshFragment, located.node.slot),
    [
      ...freshFragment.props.filter((prop) => prop.name !== ID_PROP),
      scalarIdProp(target.targetId, located.node),
    ],
    located.node.children,
  );
  return validateCandidate(session, rewriteTarget(current.ast, target.targetId, updated));
}

function nextFromMarkup(
  session: Session,
  kind: AuthorMutationKind,
  input: AuthorMutationInput,
):
  | { readonly ok: true; readonly document: ComponentDocument }
  | Extract<AuthorMutationResult, { ok: false }> {
  if (kind !== "render_page") {
    return targetedDocument(session, kind, input);
  }

  const markup = readMarkup(input);
  if (typeof markup !== "string") {
    return markup;
  }
  return validateNextDocument(session, markup);
}

function commit(
  session: Session,
  document: ComponentDocument,
): Extract<AuthorMutationResult, { ok: true }> {
  const stageRevision = nextRevision(session.stageRevision);
  const nextSession = Object.freeze({
    ...session,
    document,
    stageRevision,
    phase: "live" as const,
  });
  const patches = Object.freeze([
    Object.freeze({ op: "replace" as const, path: "/document", value: document }),
  ]);
  return {
    ok: true,
    session: nextSession,
    document,
    patches,
    stageRevision,
  };
}

export function applyAuthorMutation(
  session: Session,
  kind: AuthorMutationKind,
  input: AuthorMutationInput,
  expectedRevision: StageRevision,
  authority: WriteAuthority,
  gate: TurnGate,
): AuthorMutationResult {
  if (!gate.present(authority)) {
    return reject("mutation_authority_rejected", "authority", "The write authority is not active.");
  }
  if (expectedRevision !== session.stageRevision) {
    return stale(expectedRevision, session.stageRevision);
  }
  if (!isMutationKind(kind)) {
    return reject("unknown_mutation_kind", "kind", "The mutation kind is not registered.");
  }
  if (!isRecord(input)) {
    return reject("invalid_mutation_input", "input", "Authored mutation input must be an object.");
  }

  const document = session.document;
  if (kind !== "render_page") {
    if (document === null) {
      return reject(
        "page_not_rendered",
        "document",
        `${kind} requires an existing page. Use render_page first.`,
      );
    }
    const targetId = readString(input, "targetId");
    if (targetId === null) {
      return reject("invalid_target_id", "targetId", `${kind} requires a targetId string.`);
    }
    if (!Object.hasOwn(document.nodes, targetId)) {
      return reject(
        "unknown_target_id",
        "targetId",
        `Mutation target "${targetId}" does not exist.`,
      );
    }
  }

  const next = nextFromMarkup(session, kind, input);
  if (!next.ok) {
    return next;
  }
  return commit(session, next.document);
}
