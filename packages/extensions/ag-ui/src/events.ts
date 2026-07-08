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
import { MAX_PATCH_OPS } from "@facet/core";
import type { FacetTree, JsonPatchOperation, ServerMessage } from "@facet/core";
import { isTreeShaped } from "@facet/core";

export const FACET_STAGE_STATE_PATH = "/facet/stage";
export const FACET_RESET_EVENT_NAME = "facet/reset";
const RUN_ERROR_TEXT = "(the agent hit an error - try again)";

type JsonPatchObject = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown | undefined {
  try {
    const json = JSON.stringify(value);
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
): StateDeltaEvent | undefined {
  const delta: JsonPatchOperation[] = [];
  for (const patch of patches) {
    const normalized = normalizePatchOperation(patch);
    if (normalized === undefined) return undefined;
    const operation = toAgUiStageOperation(normalized);
    if (operation === undefined) return undefined;
    delta.push(operation);
  }
  if (delta.length === 0) return undefined;
  return { type: EventType.STATE_DELTA, delta };
}

export function facetStageToStateSnapshot(stage: FacetTree): StateSnapshotEvent {
  const clonedStage = cloneJsonValue(stage);
  return {
    type: EventType.STATE_SNAPSHOT,
    snapshot: { facet: { stage: clonedStage } },
  };
}

function messageIdFor(index: number): string {
  return `facet-message-${index + 1}`;
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
      const messageId = options.messageId ?? messageIdFor(0);
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
    const normalized = normalizePatchOperation(candidate);
    if (normalized === undefined) {
      return [];
    }
    if (fromAgUiStagePath(normalized.path) === undefined) {
      continue;
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
  const clonedStage = cloneJsonValue(facet["stage"]);
  if (!isTreeShaped(clonedStage)) return undefined;
  return clonedStage;
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

export function agUiEventsToServerMessages(events: readonly unknown[]): readonly ServerMessage[] {
  const messages: ServerMessage[] = [];
  for (const event of events) {
    messages.push(...agUiEventToServerMessages(event));
  }
  return messages;
}
