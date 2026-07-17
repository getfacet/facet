import { EventType } from "@ag-ui/core";
import type {
  AGUIEvent,
  CustomEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
} from "@ag-ui/core";
import {
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  MAX_DEPTH,
  MAX_PATCH_OPS,
  MAX_RENDER_NODES,
  MAX_SCREENS,
} from "@facet/core";
import type { FacetTree, JsonPatchOperation, ServerMessage } from "@facet/core";
import { isTreeShaped } from "@facet/core";

export const FACET_STAGE_STATE_PATH = "/facet/stage";
export const FACET_RESET_EVENT_NAME = "facet/reset";
const RUN_ERROR_TEXT = "(the agent hit an error - try again)";
const MAX_TEXT_CHARS_PER_MESSAGE = MAX_FIELD_VALUE_CHARS * MAX_FIELDS_KEYS;
const MAX_TEXT_TOTAL_CHARS = MAX_TEXT_CHARS_PER_MESSAGE;
const MAX_STAGE_SNAPSHOT_NODES = MAX_RENDER_NODES + MAX_PATCH_OPS;
const MAX_STAGE_DELTA_TOTAL_ENTRIES = MAX_RENDER_NODES * 12;

type JsonPatchObject = Record<string, unknown>;

export type FacetAgUiStateDeltaEvent = Omit<StateDeltaEvent, "delta"> & {
  readonly type: EventType.STATE_DELTA;
  readonly delta: JsonPatchOperation[];
};
export type FacetAgUiStateSnapshotEvent = Omit<StateSnapshotEvent, "snapshot"> & {
  readonly type: EventType.STATE_SNAPSHOT;
  readonly snapshot: {
    readonly facet: {
      readonly stage: FacetTree;
    };
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown | undefined {
  try {
    const json = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "number" && !Number.isFinite(nested)) {
        throw new Error("non-finite number");
      }
      return nested;
    });
    if (json === undefined) return undefined;
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

function hasOwnValue(object: JsonPatchObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizePatchOperation(value: unknown): JsonPatchOperation | undefined {
  if (!isObject(value)) return undefined;
  const op = value["op"];
  const path = value["path"];
  if (typeof op !== "string" || typeof path !== "string") return undefined;

  switch (op) {
    case "add":
    case "replace":
    case "test": {
      if (!hasOwnValue(value, "value")) return undefined;
      const clonedValue = cloneJsonValue(value["value"]);
      if (clonedValue === undefined) return undefined;
      return { op, path, value: clonedValue };
    }
    case "remove":
      return { op, path };
    case "move":
    case "copy": {
      const from = value["from"];
      if (typeof from !== "string") return undefined;
      return { op, from, path };
    }
    default:
      return undefined;
  }
}

function toAgUiStagePath(path: string): string | undefined {
  if (path === "") return FACET_STAGE_STATE_PATH;
  if (!path.startsWith("/")) return undefined;
  return `${FACET_STAGE_STATE_PATH}${path}`;
}

function fromAgUiStagePath(path: string): string | undefined {
  if (path === FACET_STAGE_STATE_PATH) return "";
  const stageChildPrefix = `${FACET_STAGE_STATE_PATH}/`;
  if (!path.startsWith(stageChildPrefix)) return undefined;
  return path.slice(FACET_STAGE_STATE_PATH.length);
}

function withStagePath(operation: JsonPatchOperation, path: string): JsonPatchOperation {
  switch (operation.op) {
    case "add":
    case "replace":
    case "test":
      return { ...operation, path };
    case "remove":
      return { ...operation, path };
    case "move":
    case "copy":
      return { ...operation, path };
  }
}

function toAgUiStageOperation(operation: JsonPatchOperation): JsonPatchOperation | undefined {
  const path = toAgUiStagePath(operation.path);
  if (path === undefined) return undefined;
  if (operation.op === "move" || operation.op === "copy") {
    const from = toAgUiStagePath(operation.from);
    if (from === undefined) return undefined;
    return { ...operation, from, path };
  }
  return withStagePath(operation, path);
}

function fromAgUiStageOperation(operation: JsonPatchOperation): JsonPatchOperation | undefined {
  const path = fromAgUiStagePath(operation.path);
  if (path === undefined) return undefined;
  if (operation.op === "move" || operation.op === "copy") {
    const from = fromAgUiStagePath(operation.from);
    if (from === undefined) return undefined;
    return { ...operation, from, path };
  }
  return withStagePath(operation, path);
}

export function facetPatchToStateDelta(
  patches: readonly JsonPatchOperation[],
): FacetAgUiStateDeltaEvent | undefined {
  if (patches.length === 0 || patches.length > MAX_PATCH_OPS) return undefined;
  const delta: JsonPatchOperation[] = [];
  for (const patch of patches) {
    const normalized = normalizePatchOperation(patch);
    if (normalized === undefined) return undefined;
    const operation = toAgUiStageOperation(normalized);
    if (operation === undefined) return undefined;
    delta.push(operation);
  }
  return { type: EventType.STATE_DELTA, delta };
}

export function facetStageToStateSnapshot(stage: FacetTree): FacetAgUiStateSnapshotEvent {
  const clonedStage = cloneJsonValue(stage);
  return {
    type: EventType.STATE_SNAPSHOT,
    snapshot: { facet: { stage: isTreeShaped(clonedStage) ? clonedStage : stage } },
  };
}

function messageIdFor(index: number): string {
  return `facet-message-${index + 1}`;
}

let standaloneMessageId = 0;

function nextStandaloneMessageId(): string {
  standaloneMessageId += 1;
  return `facet-message-standalone-${String(standaloneMessageId)}`;
}

export function serverMessageToAgUiEvents(
  message: ServerMessage,
  options: { readonly messageId?: string } = {},
): readonly AGUIEvent[] {
  switch (message.kind) {
    case "patch": {
      const event = facetPatchToStateDelta(message.patches);
      return event === undefined ? [] : [event];
    }
    case "say": {
      const messageId = options.messageId ?? nextStandaloneMessageId();
      return [
        { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: message.text },
        { type: EventType.TEXT_MESSAGE_END, messageId },
      ] satisfies [TextMessageStartEvent, TextMessageContentEvent, TextMessageEndEvent];
    }
    case "reset":
      return [
        { type: EventType.CUSTOM, name: FACET_RESET_EVENT_NAME, value: null } satisfies CustomEvent,
      ];
  }
}

export function serverMessagesToAgUiEvents(
  messages: readonly ServerMessage[],
): readonly AGUIEvent[] {
  const events: AGUIEvent[] = [];
  let textMessageIndex = 0;
  for (const message of messages) {
    if (message.kind === "say") {
      events.push(
        ...serverMessageToAgUiEvents(message, { messageId: messageIdFor(textMessageIndex) }),
      );
      textMessageIndex += 1;
      continue;
    }
    events.push(...serverMessageToAgUiEvents(message));
  }
  return events;
}

function stateDeltaToServerMessages(event: Record<string, unknown>): readonly ServerMessage[] {
  const delta = event["delta"];
  if (!Array.isArray(delta) || delta.length === 0) return [];
  if (delta.length > MAX_PATCH_OPS) return [];

  const patches: JsonPatchOperation[] = [];
  for (const candidate of delta) {
    if (!isObject(candidate)) return [];
    const path = candidate["path"];
    if (typeof path !== "string") return [];
    const stagePath = fromAgUiStagePath(path);
    if (stagePath === undefined) {
      continue;
    }
    if (
      hasOwnValue(candidate, "value") &&
      !isBoundedStageDeltaValue(stagePath, candidate["value"])
    ) {
      return [];
    }
    const normalized = normalizePatchOperation(candidate);
    if (normalized === undefined) {
      return [];
    }
    const patch = fromAgUiStageOperation(normalized);
    if (patch === undefined) return [];
    patches.push(patch);
  }
  return patches.length === 0 ? [] : [{ kind: "patch", patches }];
}

function snapshotStage(value: unknown): FacetTree | undefined {
  if (!isObject(value)) return undefined;
  const facet = value["facet"];
  if (!isObject(facet)) return undefined;
  if (!isBoundedStageSnapshotValue(facet["stage"])) return undefined;
  const clonedStage = cloneJsonValue(facet["stage"]);
  if (!isTreeShaped(clonedStage)) return undefined;
  if (!isBoundedStageSnapshotValue(clonedStage)) return undefined;
  return clonedStage;
}

function isStageWithinNodeCap(value: unknown, maxNodes: number): boolean {
  if (!isTreeShaped(value)) return false;
  try {
    return Object.keys(value.nodes).length <= maxNodes;
  } catch {
    return false;
  }
}

function isBoundedStageSnapshotValue(value: unknown): boolean {
  if (!isStageWithinNodeCap(value, MAX_STAGE_SNAPSHOT_NODES)) return false;
  if (!isBoundedStagePartialValue(value, MAX_STAGE_SNAPSHOT_NODES)) return false;
  const screens = (value as { readonly screens?: unknown }).screens;
  return screens === undefined || isScreenMapWithinCap(screens);
}

function isBoundedStageRootDeltaValue(value: unknown): boolean {
  return isStageWithinNodeCap(value, MAX_RENDER_NODES) && isBoundedStagePartialValue(value);
}

function isBoundedStageDeltaValue(stagePath: string, value: unknown): boolean {
  if (stagePath === "") return isBoundedStageRootDeltaValue(value);
  if (stagePath === "/nodes") return isNodeMapWithinCap(value) && isBoundedStagePartialValue(value);
  if (stagePath === "/screens") return isScreenMapWithinCap(value);
  if (!isBoundedStagePartialValue(value)) return false;
  if (stagePath.endsWith("/children")) return isNodeIdListWithinCap(value);
  return true;
}

function isNodeMapWithinCap(value: unknown): boolean {
  if (!isObject(value)) return false;
  try {
    return Object.keys(value).length <= MAX_RENDER_NODES;
  } catch {
    return false;
  }
}

function isScreenMapWithinCap(value: unknown): boolean {
  if (!isObject(value)) return false;
  try {
    const entries = Object.entries(value);
    return (
      entries.length <= MAX_SCREENS &&
      entries.every(
        ([name, nodeId]) =>
          name.length <= MAX_FIELD_VALUE_CHARS &&
          typeof nodeId === "string" &&
          nodeId.length <= MAX_FIELD_VALUE_CHARS,
      )
    );
  } catch {
    return false;
  }
}

function isNodeIdListWithinCap(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RENDER_NODES &&
    value.every((nodeId) => typeof nodeId === "string" && nodeId.length <= MAX_FIELD_VALUE_CHARS)
  );
}

function isBoundedStagePartialValue(
  value: unknown,
  maxEntriesPerContainer: number = MAX_RENDER_NODES,
): boolean {
  const seen = new Set<object>();
  let remainingEntries = MAX_STAGE_DELTA_TOTAL_ENTRIES;
  let remainingChars = MAX_TEXT_TOTAL_CHARS;

  const visit = (candidate: unknown, depth: number): boolean => {
    if (candidate === null) return true;
    if (typeof candidate === "string") {
      if (candidate.length > MAX_TEXT_CHARS_PER_MESSAGE) return false;
      remainingChars -= candidate.length;
      return remainingChars >= 0;
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "boolean") return true;
    if (typeof candidate !== "object") return false;
    if (depth > MAX_DEPTH) return false;

    const object = candidate;
    if (seen.has(object)) return false;
    seen.add(object);

    if (Array.isArray(candidate)) {
      if (candidate.length > maxEntriesPerContainer) return false;
      remainingEntries -= candidate.length;
      if (remainingEntries < 0) return false;

      for (let index = 0; index < candidate.length; index += 1) {
        if (!visit(candidate[index], depth + 1)) return false;
      }
      return true;
    }

    const entries = Object.entries(candidate);
    if (entries.length > maxEntriesPerContainer) return false;
    remainingEntries -= entries.length;
    if (remainingEntries < 0) return false;

    for (const [key, nested] of entries) {
      if (key.length > MAX_FIELD_VALUE_CHARS) return false;
      if (!visit(nested, depth + 1)) return false;
    }
    return true;
  };

  return visit(value, 0);
}

function stateSnapshotToServerMessages(event: Record<string, unknown>): readonly ServerMessage[] {
  const stage = snapshotStage(event["snapshot"]);
  if (stage === undefined) return [];
  return [{ kind: "patch", patches: [{ op: "replace", path: "", value: stage }] }];
}

function customEventToServerMessages(event: Record<string, unknown>): readonly ServerMessage[] {
  if (event["name"] !== FACET_RESET_EVENT_NAME || event["value"] !== null) return [];
  return [{ kind: "reset" }];
}

export function agUiEventToServerMessages(event: unknown): readonly ServerMessage[] {
  if (!isObject(event)) return [];
  try {
    switch (event["type"]) {
      case EventType.STATE_DELTA:
        return stateDeltaToServerMessages(event);
      case EventType.STATE_SNAPSHOT:
        return stateSnapshotToServerMessages(event);
      case EventType.CUSTOM:
        return customEventToServerMessages(event);
      case EventType.RUN_ERROR:
        return [{ kind: "say", text: RUN_ERROR_TEXT }];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export { AgUiServerMessageAccumulator, agUiEventsToServerMessages } from "./events-text.js";
