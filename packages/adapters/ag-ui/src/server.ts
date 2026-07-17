import type { IncomingMessage, ServerResponse } from "node:http";

import { RunAgentInputSchema } from "@ag-ui/core";
import type { AGUIEvent, RunAgentInput } from "@ag-ui/core";

import { facetStageToStateSnapshot } from "./events.js";
import {
  authorizeDirectRunInput,
  authorizeHttpRunInputUntilOpen,
  requireFacetInput,
} from "./server-input.js";
import {
  appendHandledEvents,
  appendSnapshot,
  runError,
  runFinished,
  runStarted,
  writeHandledEvents,
} from "./server-output.js";
import {
  acquireRuntimeQueuedRun,
  acquireRuntimeRun,
  pendingWorkForTimeout,
  recordWithoutThrow,
  releaseRuntimeRun,
  runtimeErrorCode,
  withRuntimeAuthorizationRun,
  withRuntimeVisitorRun,
  withSnapshotTimeout,
} from "./server-scheduling.js";
import {
  createSseWriteQueue,
  endResponse,
  isResponseClosed,
  parseRequestJson,
  readRequestBody,
  writeAgUiSseResponse,
} from "./server-sse.js";
import {
  AgUiHttpInputError,
  DEFAULT_MAX_BODY_BYTES,
  RUNTIME_ERROR_MESSAGE,
  SSE_HEADERS,
  errorMessage,
  logInternalFailure,
  type AgUiHttpExecutionOptions,
  type FacetAgUiInput,
  type FacetRuntimeForAgUi,
  type HandleAgUiRequestOptions,
  type RunFacetAsAgUiOptions,
  type StageSnapshotState,
} from "./server-types.js";

export type {
  FacetAgUiInput,
  FacetAgUiVisitorResolutionInput,
  FacetRuntimeForAgUi,
  HandleAgUiRequestOptions,
  RunFacetAsAgUiOptions,
} from "./server-types.js";
export { facetInputFromRunAgentInput } from "./server-input.js";
export { writeAgUiSseEvent } from "./server-sse.js";

export async function runFacetAsAgUi(
  runtime: FacetRuntimeForAgUi,
  input: unknown,
  options: RunFacetAsAgUiOptions = {},
): Promise<readonly AGUIEvent[]> {
  let parsed: ReturnType<typeof RunAgentInputSchema.safeParse>;
  try {
    parsed = RunAgentInputSchema.safeParse(input);
  } catch {
    return [runError("Malformed AG-UI run input", "BAD_REQUEST")];
  }
  if (!parsed.success) return [runError("Malformed AG-UI run input", "BAD_REQUEST")];

  let runInput = parsed.data;
  const events: AGUIEvent[] = [runStarted(runInput)];
  let releaseRun: (() => void) | undefined;
  let releaseAfter: Promise<unknown> | undefined;
  try {
    releaseRun = acquireRuntimeRun(runtime, options);
    const scheduledRun = await withRuntimeAuthorizationRun(runtime, runInput, options, async () => {
      const authorizedRunInput = await authorizeDirectRunInput(runInput, options);
      const facetInput = requireFacetInput(authorizedRunInput);

      const queuedRun = withRuntimeVisitorRun(runtime, facetInput.visitor, async () => {
        try {
          const stageState: StageSnapshotState = { stage: undefined };
          if (options.includeSnapshot === true) {
            stageState.stage = await appendSnapshot(events, runtime, facetInput.visitor, options);
          }

          if (facetInput.kind === "record") {
            releaseAfter = recordWithoutThrow(runtime, facetInput.visitor, facetInput.record);
          } else {
            await appendHandledEvents(events, runtime, facetInput, authorizedRunInput, stageState);
          }
        } catch (error) {
          releaseAfter = pendingWorkForTimeout(error);
          throw error;
        }
      });

      return { runInput: authorizedRunInput, queuedRun };
    });
    runInput = scheduledRun.runInput;
    await scheduledRun.queuedRun;
    events.push(runFinished(runInput));
  } catch (error) {
    if (error instanceof AgUiHttpInputError) {
      events.push(runError(error.message, error.code, runInput));
    } else {
      logInternalFailure("runtime failed", error);
      events.push(runError(RUNTIME_ERROR_MESSAGE, runtimeErrorCode(error), runInput));
    }
  } finally {
    if (releaseRun !== undefined) releaseRuntimeRun(releaseRun, releaseAfter);
  }

  return events;
}

export async function handleAgUiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: FacetRuntimeForAgUi,
  options: HandleAgUiRequestOptions = {},
): Promise<void> {
  try {
    if (req.method !== undefined && req.method !== "POST") {
      writeAgUiSseResponse(res, 405, [runError("Method not allowed", "METHOD_NOT_ALLOWED")]);
      return;
    }

    const body = await readRequestBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    const json = parseRequestJson(body);
    const parsed = RunAgentInputSchema.safeParse(json);
    if (!parsed.success) {
      writeAgUiSseResponse(res, 400, [runError("Malformed AG-UI run input", "BAD_REQUEST")]);
      return;
    }

    const releaseRun = acquireRuntimeRun(runtime, options);
    let handedToWriter = false;
    let closedBeforeWriter = false;
    let resolveClosedBeforeWriter: (() => void) | undefined;
    const closedBeforeWriterPromise = new Promise<void>((resolve) => {
      resolveClosedBeforeWriter = resolve;
    });
    const cleanupPreWriterCloseWatch = (): void => {
      res.off("close", onClosedBeforeWriter);
      res.off("error", onClosedBeforeWriter);
    };
    const onClosedBeforeWriter = (): void => {
      closedBeforeWriter = true;
      cleanupPreWriterCloseWatch();
      releaseRun();
      resolveClosedBeforeWriter?.();
    };
    res.once("close", onClosedBeforeWriter);
    res.once("error", onClosedBeforeWriter);
    try {
      if (isResponseClosed(res)) {
        onClosedBeforeWriter();
        return;
      }
      const authorizedRun = withRuntimeAuthorizationRun(runtime, parsed.data, options, async () => {
        if (closedBeforeWriter || isResponseClosed(res)) return { kind: "closed" as const };
        const runInput = await authorizeHttpRunInputUntilOpen(
          req,
          parsed.data,
          options,
          closedBeforeWriterPromise,
        );
        if (runInput === undefined || closedBeforeWriter || isResponseClosed(res)) {
          return { kind: "closed" as const };
        }
        cleanupPreWriterCloseWatch();
        handedToWriter = true;
        return {
          kind: "writer" as const,
          writerRun: writeAgUiRunResponse(res, runtime, runInput, options, releaseRun),
        };
      });
      const completed = await Promise.race([
        authorizedRun,
        closedBeforeWriterPromise.then(() => ({ kind: "closed" as const })),
      ]);
      if (completed.kind === "closed") {
        void authorizedRun.catch((error: unknown) => {
          logInternalFailure("authorization failed after response close", error);
        });
        return;
      }
      await completed.writerRun;
    } finally {
      cleanupPreWriterCloseWatch();
      if (!handedToWriter) releaseRun();
    }
  } catch (error) {
    const statusCode = error instanceof AgUiHttpInputError ? error.statusCode : 500;
    const code = error instanceof AgUiHttpInputError ? error.code : "INTERNAL_ERROR";
    const message =
      error instanceof AgUiHttpInputError ? errorMessage(error) : RUNTIME_ERROR_MESSAGE;
    if (!(error instanceof AgUiHttpInputError)) logInternalFailure("handler failed", error);
    writeAgUiSseResponse(res, statusCode, [runError(message, code)]);
  }
}

async function writeAgUiRunResponse(
  res: ServerResponse,
  runtime: FacetRuntimeForAgUi,
  runInput: RunAgentInput,
  options: AgUiHttpExecutionOptions,
  releaseRun: () => void,
): Promise<void> {
  if (!res.headersSent) res.writeHead(200, SSE_HEADERS);
  const writeQueue = createSseWriteQueue(res, options.maxBufferedSseEvents);
  const write = (event: AGUIEvent): void => writeQueue.enqueue(event);
  let runReleased = false;
  const releaseActiveRun = (): void => {
    if (runReleased) return;
    runReleased = true;
    releaseRun();
  };
  const finishWithoutRuntime = async (): Promise<void> => {
    releaseActiveRun();
    await writeQueue.flush();
    endResponse(res);
  };

  write(runStarted(runInput));
  let facetInput: FacetAgUiInput;
  try {
    facetInput = requireFacetInput(runInput);
  } catch (error) {
    const code = error instanceof AgUiHttpInputError ? error.code : "BAD_REQUEST";
    const message =
      error instanceof AgUiHttpInputError ? error.message : "Malformed Facet forwardedProps";
    write(runError(message, code, runInput));
    await finishWithoutRuntime();
    return;
  }

  try {
    if (isResponseClosed(res)) {
      releaseActiveRun();
      return;
    }
    let queuedTaskStarted = false;
    let abortedBeforeStart = false;
    let resolveClosedBeforeStart: (() => void) | undefined;
    const closedBeforeStart = new Promise<void>((resolve) => {
      resolveClosedBeforeStart = resolve;
    });
    const cleanupCloseWatch = (): void => {
      res.off("close", onClosedBeforeStart);
      res.off("error", onClosedBeforeStart);
    };
    const onClosedBeforeStart = (): void => {
      if (queuedTaskStarted) return;
      abortedBeforeStart = true;
      cleanupCloseWatch();
      releaseActiveRun();
      resolveClosedBeforeStart?.();
    };
    res.once("close", onClosedBeforeStart);
    res.once("error", onClosedBeforeStart);
    if (isResponseClosed(res)) {
      onClosedBeforeStart();
      return;
    }

    let releaseQueuedRun: (() => void) | undefined;
    let queuedRunReleased = false;
    const releaseQueuedRunOnce = (): void => {
      if (queuedRunReleased) return;
      queuedRunReleased = true;
      releaseQueuedRun?.();
    };
    try {
      releaseQueuedRun = acquireRuntimeQueuedRun(runtime, facetInput.visitor, options);
    } catch (error) {
      cleanupCloseWatch();
      releaseActiveRun();
      throw error;
    }

    const queuedRun = withRuntimeVisitorRun(runtime, facetInput.visitor, async () => {
      releaseQueuedRunOnce();
      queuedTaskStarted = true;
      cleanupCloseWatch();
      if (abortedBeforeStart) return;
      if (res.destroyed || res.writableEnded) {
        releaseActiveRun();
        return;
      }
      let releaseAfter: Promise<unknown> | undefined;
      try {
        const stageState: StageSnapshotState = { stage: undefined };
        if (options.includeSnapshot === true) {
          const stage = await withSnapshotTimeout(
            runtime.stageFor(facetInput.visitor.visitorId),
            options,
          );
          stageState.stage = stage;
          if (stage !== undefined) write(facetStageToStateSnapshot(stage));
        }

        if (facetInput.kind === "record") {
          releaseAfter = recordWithoutThrow(runtime, facetInput.visitor, facetInput.record);
        } else {
          await writeHandledEvents(write, runtime, facetInput, runInput, stageState);
        }
      } catch (error) {
        releaseAfter = pendingWorkForTimeout(error);
        throw error;
      } finally {
        releaseRuntimeRun(releaseActiveRun, releaseAfter);
      }

      write(runFinished(runInput));
    });
    const completed = await Promise.race([
      queuedRun.then(() => true),
      closedBeforeStart.then(() => false),
    ]);
    if (!completed) {
      void queuedRun.catch((error: unknown) => {
        logInternalFailure("queued run failed after response close", error);
      });
      return;
    }
  } catch (error) {
    if (error instanceof AgUiHttpInputError) {
      write(runError(error.message, error.code, runInput));
    } else {
      logInternalFailure("runtime failed", error);
      write(runError(RUNTIME_ERROR_MESSAGE, runtimeErrorCode(error), runInput));
    }
  }

  await writeQueue.flush();
  endResponse(res);
}
