import { EventType } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput } from "@ag-ui/core";
import { foldPatchIntoStage } from "@facet/core";
import type { FacetTree, ServerMessage, VisitorContext } from "@facet/core";
import type { RuntimeFrameContext, TurnResult } from "@facet/runtime";

import { facetStageToStateSnapshot, serverMessageToAgUiEvents } from "./events.js";
import { withSnapshotTimeout } from "./server-scheduling.js";
import type {
  FacetAgUiInput,
  FacetRuntimeForAgUi,
  AgUiRuntimeExecutionOptions,
  StageSnapshotState,
  TextMessageState,
  RunStartedAgUiEvent,
  RunFinishedAgUiEvent,
  RunErrorAgUiEvent,
} from "./server-types.js";

export async function appendSnapshot(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  visitor: VisitorContext,
  options: AgUiRuntimeExecutionOptions,
): Promise<FacetTree | undefined> {
  const stage = await withSnapshotTimeout(runtime.stageFor(visitor.visitorId), options);
  if (stage !== undefined) events.push(facetStageToStateSnapshot(stage));
  return stage;
}

export async function appendHandledEvents(
  events: AGUIEvent[],
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): Promise<void> {
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  let delivery = Promise.resolve();
  const resultPromise = invokeRuntimeHandle(runtime, input, (messages, context) => {
    deliveredFrame = true;
    delivery = delivery.then(async () => {
      await appendServerMessages(events, messages, textState, runInput, stageState, context);
    });
  });
  const result = await resultPromise;
  await delivery;
  if (!deliveredFrame) {
    appendTurnResult(events, result, textState, runInput, stageState);
  }
}

export async function writeHandledEvents(
  write: (event: AGUIEvent) => void,
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): Promise<void> {
  const events: AGUIEvent[] = [];
  const textState: TextMessageState = { nextIndex: 1 };
  let deliveredFrame = false;
  let delivery = Promise.resolve();
  const resultPromise = invokeRuntimeHandle(runtime, input, (messages, context) => {
    deliveredFrame = true;
    delivery = delivery.then(async () => {
      const frameEvents: AGUIEvent[] = [];
      await appendServerMessages(frameEvents, messages, textState, runInput, stageState, context);
      for (const event of frameEvents) write(event);
    });
  });
  const result = await resultPromise;
  await delivery;
  if (!deliveredFrame) {
    appendTurnResult(events, result, textState, runInput, stageState);
    for (const event of events) write(event);
  }
}

function invokeRuntimeHandle(
  runtime: FacetRuntimeForAgUi,
  input: Extract<FacetAgUiInput, { readonly kind: "event" }>,
  onFrame: (messages: readonly ServerMessage[], context?: RuntimeFrameContext) => void,
): Promise<TurnResult> {
  return Promise.resolve().then(() => runtime.handle(input.visitor, input.event, onFrame));
}

function appendTurnResult(
  events: AGUIEvent[],
  result: TurnResult,
  textState: TextMessageState,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
): void {
  appendServerMessages(events, result.messages, textState, runInput, stageState);
}

function appendServerMessages(
  events: AGUIEvent[],
  messages: readonly ServerMessage[],
  textState: TextMessageState,
  runInput: RunAgentInput,
  stageState: StageSnapshotState,
  context?: RuntimeFrameContext,
): void {
  let contextStageRead = false;
  let contextStage: FacetTree | undefined;
  const readContextStage = (): FacetTree | undefined => {
    if (!contextStageRead) {
      contextStageRead = true;
      contextStage = context?.stage;
      if (contextStage !== undefined) stageState.stage = contextStage;
    }
    return contextStage;
  };
  for (const message of messages) {
    if (message.kind === "say") {
      const messageId = `facet-${runInput.runId}-message-${String(textState.nextIndex)}`;
      textState.nextIndex += 1;
      events.push(...serverMessageToAgUiEvents(message, { messageId }));
    } else {
      const converted = serverMessageToAgUiEvents(message);
      if (message.kind === "patch" && message.patches.length > 0 && converted.length === 0) {
        if (readContextStage() === undefined) updateStageShadow(stageState, message);
        if (stageState.stage !== undefined)
          events.push(facetStageToStateSnapshot(stageState.stage));
      } else {
        if (message.kind === "patch" && readContextStage() === undefined) {
          updateStageShadow(stageState, message);
        }
        events.push(...converted);
      }
    }
  }
}

function updateStageShadow(stageState: StageSnapshotState, message: ServerMessage): void {
  if (message.kind !== "patch" || stageState.stage === undefined) return;
  stageState.stage = foldPatchIntoStage(stageState.stage, message.patches).tree;
}

export function runStarted(input: RunAgentInput): RunStartedAgUiEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
  } satisfies RunStartedAgUiEvent;
}

export function runFinished(input: RunAgentInput): RunFinishedAgUiEvent {
  return {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: { type: "success" },
  } satisfies RunFinishedAgUiEvent;
}

export function runError(message: string, code?: string, input?: RunAgentInput): RunErrorAgUiEvent {
  return {
    type: EventType.RUN_ERROR,
    message,
    ...(code === undefined ? {} : { code }),
    ...(input === undefined ? {} : { threadId: input.threadId, runId: input.runId }),
  } satisfies RunErrorAgUiEvent;
}
