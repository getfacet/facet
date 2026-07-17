import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  INPUT_KINDS,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
  type InputKind,
} from "./brick-contract.js";
import {
  FIXED_STYLE_VALUE_CONTRACT,
  TOKEN_STYLE_VALUE_CONTRACT,
  type StyleValue,
  type StyleValueDomain,
} from "./style-value-contract.js";
import { isControlChar, isForbiddenKey, isPlainObject, printableKey } from "./issues.js";
import { sanitizeNode } from "./primitive-node-validation.js";
import { SLOT_NAME_RE } from "./slot-marker.js";
import type { FacetTheme } from "./theme-types.js";
import type { FacetNode } from "./nodes.js";
import type { FacetTree } from "./tree.js";
import { validateTree } from "./tree-validation.js";

/** Maximum repair entries returned to an agent for one rejected authoring call. */
export const MAX_AUTHOR_ISSUES = 16;

const MAX_AUTHOR_MESSAGE_CHARS = 240;
const MAX_COMPARE_DEPTH = 64;
const TREE_FIELDS = ["root", "nodes", "screens", "entry", "data"] as const;

export interface AuthorIssue {
  /** RFC-6901-like path into the rejected document. */
  readonly path: string;
  /** Bounded, control-free repair guidance. */
  readonly message: string;
  /** Closed choices at this exact path, when useful. */
  readonly allowed?: readonly string[];
}

export interface AuthorValidationResult<T> {
  /** Present only when the complete input is valid. Invalid input is never partially returned. */
  readonly value?: T;
  readonly issues: readonly AuthorIssue[];
  readonly omittedErrorCount: number;
}

class AuthorIssues {
  private readonly entries: AuthorIssue[] = [];
  private omitted = 0;

  add(path: string, message: string, allowed?: readonly StyleValue[]): void {
    if (this.entries.length >= MAX_AUTHOR_ISSUES) {
      this.omitted += 1;
      return;
    }
    const issue: { path: string; message: string; allowed?: readonly string[] } = {
      path: safeMessage(path),
      message: safeMessage(message),
    };
    if (allowed !== undefined) issue.allowed = allowed.map((value) => String(value));
    this.entries.push(issue);
  }

  get size(): number {
    return this.entries.length;
  }

  result<T>(value: T | undefined): AuthorValidationResult<T> {
    if (value !== undefined && this.entries.length === 0 && this.omitted === 0) {
      return { value, issues: this.entries, omittedErrorCount: 0 };
    }
    return { issues: this.entries, omittedErrorCount: this.omitted };
  }
}

function safeMessage(value: string): string {
  const output: string[] = [];
  const limit = Math.min(value.length, MAX_AUTHOR_MESSAGE_CHARS * 4);
  for (let index = 0; index < limit && output.length < MAX_AUTHOR_MESSAGE_CHARS; index += 1) {
    const code = value.charCodeAt(index);
    if (!isControlChar(code)) output.push(value[index] ?? "");
  }
  return output.join("");
}

function pointerToken(value: string): string {
  return printableKey(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function childPath(path: string, key: string): string {
  return `${path}/${pointerToken(key)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function ownKeys(value: Record<string, unknown>): readonly string[] | undefined {
  try {
    return Object.keys(value);
  } catch {
    return undefined;
  }
}

type SafeRead =
  | { readonly ok: true; readonly present: boolean; readonly value: unknown }
  | { readonly ok: false; readonly present: false; readonly value?: undefined };

function readOwn(value: Record<string, unknown>, key: string): SafeRead {
  try {
    const present = Object.prototype.hasOwnProperty.call(value, key);
    return { ok: true, present, value: present ? Reflect.get(value, key) : undefined };
  } catch {
    return { ok: false, present: false };
  }
}

function domainFor(property: BrickStylePropertyContract): StyleValueDomain | undefined {
  const token: Readonly<Record<string, StyleValueDomain>> = TOKEN_STYLE_VALUE_CONTRACT;
  const fixed: Readonly<Record<string, StyleValueDomain>> = FIXED_STYLE_VALUE_CONTRACT;
  return property.source === "token" ? token[property.domain] : fixed[property.domain];
}

function allowedValues(
  propertyName: string,
  property: BrickStylePropertyContract,
): readonly StyleValue[] {
  return (domainFor(property)?.values ?? [])
    .map(({ name }) => name)
    .filter((name) => name !== "inherit" || propertyName === "color");
}

function validateProperties(
  raw: Record<string, unknown>,
  properties: Readonly<Record<string, BrickStylePropertyContract>>,
  names: readonly string[],
  path: string,
  issues: AuthorIssues,
): void {
  for (const name of names) {
    const read = readOwn(raw, name);
    if (!read.ok) {
      issues.add(childPath(path, name), "Style value could not be read safely.");
      continue;
    }
    if (!read.present) continue;
    const property = properties[name];
    if (property === undefined) continue;
    const allowed = allowedValues(name, property);
    if (!allowed.some((choice) => Object.is(choice, read.value))) {
      issues.add(childPath(path, name), "Choose one allowed style value.", allowed);
    }
  }
}

function validateTarget(
  raw: unknown,
  target: BrickStyleTargetContract,
  path: string,
  issues: AuthorIssues,
  allowStates: boolean,
): void {
  const object = asRecord(raw);
  if (object === undefined) {
    issues.add(path, "Style target must be an object.");
    return;
  }
  const keys = ownKeys(object);
  if (keys === undefined) {
    issues.add(path, "Style target could not be read safely.");
    return;
  }
  const stateNames = allowStates ? Object.keys(target.states ?? {}) : [];
  const known = new Set([...Object.keys(target.properties), ...stateNames]);
  for (const key of keys) {
    if (isForbiddenKey(key) || !known.has(key)) {
      issues.add(childPath(path, key), "Unknown or unavailable style property.", [...known]);
    }
  }
  validateProperties(object, target.properties, Object.keys(target.properties), path, issues);
  for (const [state, propertyNames] of Object.entries(allowStates ? (target.states ?? {}) : {})) {
    const read = readOwn(object, state);
    if (!read.ok) {
      issues.add(childPath(path, state), "State style could not be read safely.");
    } else if (read.present) {
      const stateTarget: BrickStyleTargetContract = {
        properties: target.properties,
      };
      validateState(read.value, stateTarget, propertyNames, childPath(path, state), issues);
    }
  }
}

function validateState(
  raw: unknown,
  target: BrickStyleTargetContract,
  propertyNames: readonly string[],
  path: string,
  issues: AuthorIssues,
): void {
  const object = asRecord(raw);
  if (object === undefined) {
    issues.add(path, "State style must be an object.");
    return;
  }
  const keys = ownKeys(object);
  if (keys === undefined) {
    issues.add(path, "State style could not be read safely.");
    return;
  }
  for (const key of keys) {
    if (isForbiddenKey(key) || !propertyNames.includes(key)) {
      issues.add(childPath(path, key), "Unknown state style property.", propertyNames);
    }
  }
  validateProperties(object, target.properties, propertyNames, path, issues);
}

function presetNames(theme: FacetTheme, brick: BrickType): readonly string[] | undefined {
  try {
    const presets = asRecord(theme.presets);
    if (presets === undefined) return [];
    const groupRead = readOwn(presets, brick);
    if (!groupRead.ok) return undefined;
    if (!groupRead.present) return [];
    const group = asRecord(groupRead.value);
    const keys = group === undefined ? undefined : ownKeys(group);
    if (keys === undefined) return undefined;
    return keys.filter((name) => SLOT_NAME_RE.test(name));
  } catch {
    return undefined;
  }
}

function validatePreset(
  raw: Record<string, unknown>,
  theme: FacetTheme,
  brick: BrickType,
  path: string,
  issues: AuthorIssues,
): void {
  const preset = readOwn(raw, "preset");
  if (!preset.ok) {
    issues.add(path, "Preset could not be read safely.");
    return;
  }
  if (!preset.present) return;
  const names = presetNames(theme, brick);
  if (names === undefined) {
    issues.add(path, "Active Theme Presets could not be read safely.");
    return;
  }
  if (
    typeof preset.value !== "string" ||
    !SLOT_NAME_RE.test(preset.value) ||
    !names.includes(preset.value)
  ) {
    issues.add(path, "Choose an available same-Brick Preset.", names);
  }
}

function validateStyle(
  brick: BrickType,
  raw: unknown,
  theme: FacetTheme,
  inputKind: InputKind | undefined,
  path: string,
  issues: AuthorIssues,
  activeLayer = false,
): void {
  const object = asRecord(raw);
  if (object === undefined) {
    issues.add(path, "Style must be an object.");
    return;
  }
  const keys = ownKeys(object);
  if (keys === undefined) {
    issues.add(path, "Style could not be read safely.");
    return;
  }
  const contract = BRICK_CONTRACT[brick];
  const root: BrickStyleTargetContract = contract.style.root;
  const rootStates = activeLayer ? [] : Object.keys(root.states ?? {});
  const known = new Set([
    "preset",
    ...Object.keys(root.properties),
    ...rootStates,
    ...Object.keys(contract.style.targets),
  ]);
  if (!activeLayer && contract.supportsActiveWhen) known.add("active");
  for (const key of keys) {
    if (isForbiddenKey(key) || !known.has(key)) {
      issues.add(childPath(path, key), "Unknown or unavailable style property.", [...known]);
    }
  }

  validatePreset(object, theme, brick, childPath(path, "preset"), issues);
  validateProperties(object, root.properties, Object.keys(root.properties), path, issues);
  const states: Readonly<Record<string, readonly string[]>> = activeLayer
    ? {}
    : (root.states ?? {});
  for (const [state, propertyNames] of Object.entries(states)) {
    const read = readOwn(object, state);
    if (!read.ok) {
      issues.add(childPath(path, state), "State style could not be read safely.");
    } else if (read.present) {
      validateState(read.value, root, propertyNames, childPath(path, state), issues);
    }
  }

  for (const [targetName, target] of Object.entries(contract.style.targets)) {
    const targetRead = readOwn(object, targetName);
    if (!targetRead.ok) {
      issues.add(childPath(path, targetName), "Style target could not be read safely.");
      continue;
    }
    if (!targetRead.present) continue;
    if (
      inputKind !== undefined &&
      target.applicableTo !== undefined &&
      !target.applicableTo.includes(inputKind)
    ) {
      issues.add(
        childPath(path, targetName),
        `This target is unavailable for input kind ${inputKind}.`,
        target.applicableTo,
      );
      continue;
    }
    validateTarget(targetRead.value, target, childPath(path, targetName), issues, !activeLayer);
  }

  if (!activeLayer && contract.supportsActiveWhen) {
    const active = readOwn(object, "active");
    if (!active.ok) {
      issues.add(childPath(path, "active"), "Active style could not be read safely.");
    } else if (active.present) {
      validateStyle(brick, active.value, theme, inputKind, childPath(path, "active"), issues, true);
    }
  }
}

function firstMismatch(
  raw: unknown,
  normalized: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string | undefined {
  if (Object.is(raw, normalized)) return undefined;
  if (depth > MAX_COMPARE_DEPTH) return path;
  if (typeof raw !== "object" || raw === null) return path;
  if (seen.has(raw)) return path;
  seen.add(raw);
  try {
    if (Array.isArray(raw)) {
      if (!Array.isArray(normalized) || raw.length !== normalized.length) return path;
      for (let index = 0; index < raw.length; index += 1) {
        const mismatch = firstMismatch(
          raw[index],
          normalized[index],
          childPath(path, String(index)),
          depth + 1,
          seen,
        );
        if (mismatch !== undefined) return mismatch;
      }
      return undefined;
    }
    const rawRecord = asRecord(raw);
    const normalizedRecord = asRecord(normalized);
    if (rawRecord === undefined || normalizedRecord === undefined) return path;
    const keys = ownKeys(rawRecord);
    if (keys === undefined) return path;
    for (const key of keys) {
      const rawRead = readOwn(rawRecord, key);
      const normalizedRead = readOwn(normalizedRecord, key);
      if (!rawRead.ok || !normalizedRead.ok || !normalizedRead.present) {
        return childPath(path, key);
      }
      const mismatch = firstMismatch(
        rawRead.value,
        normalizedRead.value,
        childPath(path, key),
        depth + 1,
        seen,
      );
      if (mismatch !== undefined) return mismatch;
    }
    return undefined;
  } catch {
    return path;
  } finally {
    seen.delete(raw);
  }
}

function validateNodeInto(
  input: unknown,
  theme: FacetTheme,
  path: string,
  issues: AuthorIssues,
  expectedId?: string,
): FacetNode | undefined {
  const raw = asRecord(input);
  if (raw === undefined) {
    issues.add(path, "Node must be an object.");
    return undefined;
  }
  const keys = ownKeys(raw);
  if (keys === undefined) {
    issues.add(path, "Node could not be read safely.");
    return undefined;
  }
  const typeRead = readOwn(raw, "type");
  const type =
    typeRead.ok &&
    typeRead.present &&
    typeof typeRead.value === "string" &&
    (BRICK_TYPES as readonly string[]).includes(typeRead.value)
      ? (typeRead.value as BrickType)
      : undefined;
  if (type === undefined) {
    issues.add(childPath(path, "type"), "Choose one native Brick type.", BRICK_TYPES);
    return undefined;
  }
  const contract = BRICK_CONTRACT[type];
  const knownFields = new Set([...Object.keys(contract.fields), "style"]);
  for (const key of keys) {
    if (isForbiddenKey(key) || !knownFields.has(key)) {
      issues.add(childPath(path, key), "Unknown or forbidden Brick field.", [...knownFields]);
    }
  }
  for (const [field, metadata] of Object.entries(contract.fields)) {
    const read = readOwn(raw, field);
    if (!read.ok) {
      issues.add(childPath(path, field), "Brick field could not be read safely.");
    } else if (metadata.required && !read.present) {
      issues.add(childPath(path, field), "Required Brick field is missing.");
    }
  }

  const idRead = readOwn(raw, "id");
  const id = idRead.ok && idRead.present && typeof idRead.value === "string" ? idRead.value : "";
  if (id.length === 0 || isForbiddenKey(id)) {
    issues.add(childPath(path, "id"), "Node id must be a non-empty safe string.");
  } else if (expectedId !== undefined && id !== expectedId) {
    issues.add(childPath(path, "id"), "Node id must match its nodes-map key.");
  }

  const styleRead = readOwn(raw, "style");
  if (!styleRead.ok) {
    issues.add(childPath(path, "style"), "Style could not be read safely.");
  } else if (styleRead.present) {
    const inputRead = readOwn(raw, "input");
    const inputKind =
      inputRead.ok &&
      typeof inputRead.value === "string" &&
      (INPUT_KINDS as readonly string[]).includes(inputRead.value)
        ? (inputRead.value as InputKind)
        : type === "input"
          ? "text"
          : undefined;
    validateStyle(type, styleRead.value, theme, inputKind, childPath(path, "style"), issues);
  }

  if (id.length === 0) return undefined;
  const legacy: string[] = [];
  let normalized: FacetNode | undefined;
  try {
    normalized = sanitizeNode(expectedId ?? id, raw, { push: (issue) => legacy.push(issue) });
  } catch {
    issues.add(path, "Node could not be validated safely.");
    return undefined;
  }
  if (normalized === undefined) {
    if (issues.size === 0) issues.add(path, "Node does not satisfy the closed Brick contract.");
    return undefined;
  }

  for (const field of Object.keys(contract.fields)) {
    const rawRead = readOwn(raw, field);
    if (!rawRead.ok || !rawRead.present) continue;
    const normalizedRead = readOwn(normalized as unknown as Record<string, unknown>, field);
    const mismatch = firstMismatch(
      rawRead.value,
      normalizedRead.ok && normalizedRead.present ? normalizedRead.value : undefined,
      childPath(path, field),
      0,
      new WeakSet(),
    );
    if (mismatch !== undefined) {
      issues.add(mismatch, "Brick field has an invalid or out-of-bounds value.");
    }
  }
  if (legacy.length > 0 && issues.size === 0) {
    for (const message of legacy) issues.add(path, message);
  }
  return normalized;
}

/** Strictly validates one node before a mutation tool constructs any patch. */
export function validateAuthorNode(
  input: unknown,
  theme: FacetTheme,
): AuthorValidationResult<FacetNode> {
  const issues = new AuthorIssues();
  try {
    return issues.result(validateNodeInto(input, theme, "", issues));
  } catch {
    issues.add("", "Node could not be read safely.");
    return issues.result<FacetNode>(undefined);
  }
}

/** Strictly validates a complete author tree; one invalid fragment rejects the whole tree. */
export function validateAuthorTree(
  input: unknown,
  theme: FacetTheme,
): AuthorValidationResult<FacetTree> {
  const issues = new AuthorIssues();
  try {
    const raw = asRecord(input);
    if (raw === undefined) {
      issues.add("", "Tree must be an object.");
      return issues.result<FacetTree>(undefined);
    }
    const keys = ownKeys(raw);
    if (keys === undefined) {
      issues.add("", "Tree could not be read safely.");
      return issues.result<FacetTree>(undefined);
    }
    for (const key of keys) {
      if (isForbiddenKey(key) || !(TREE_FIELDS as readonly string[]).includes(key)) {
        issues.add(childPath("", key), "Unknown or forbidden tree field.", TREE_FIELDS);
      }
    }
    const nodesRead = readOwn(raw, "nodes");
    const nodes = nodesRead.ok && nodesRead.present ? asRecord(nodesRead.value) : undefined;
    if (nodes === undefined) {
      issues.add("/nodes", "Tree nodes must be an object map.");
    } else {
      const nodeIds = ownKeys(nodes);
      if (nodeIds === undefined) {
        issues.add("/nodes", "Tree nodes could not be read safely.");
      } else {
        for (const nodeId of nodeIds) {
          const nodeRead = readOwn(nodes, nodeId);
          if (!nodeRead.ok) {
            issues.add(childPath("/nodes", nodeId), "Node could not be read safely.");
            continue;
          }
          validateNodeInto(nodeRead.value, theme, childPath("/nodes", nodeId), issues, nodeId);
        }
      }
    }

    const validated = validateTree(raw);
    for (const message of validated.issues) issues.add("", message);
    return issues.result(validated.tree);
  } catch {
    issues.add("", "Tree could not be read safely.");
    return issues.result<FacetTree>(undefined);
  }
}
