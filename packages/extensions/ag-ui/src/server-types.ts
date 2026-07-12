import type { IncomingMessage } from "node:http";

import { EventType } from "@ag-ui/core";
import type { AGUIEvent } from "@ag-ui/core";
import type { ClientEvent, CollectedEvent, FacetTree, VisitorContext } from "@facet/core";
import type { FacetRuntime } from "@facet/runtime";

export const DEFAULT_MAX_BODY_BYTES = 1_000_000;
export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_IN_FLIGHT_RUNS = 64;
export const DEFAULT_MAX_BUFFERED_SSE_EVENTS = 1_024;
export const RUNTIME_ERROR_MESSAGE = "Facet runtime failed";
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export type FacetRuntimeForAgUi = Pick<FacetRuntime, "handle" | "record" | "stageFor">;

export interface FacetAgUiVisitorResolutionInput {
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly forwardedVisitor?: VisitorContext;
}

export interface RunFacetAsAgUiOptions {
  readonly includeSnapshot?: boolean;
  readonly snapshotTimeoutMs?: number | false;
  readonly maxInFlightRuns?: number | false;
  readonly allowForwardedVisitor?: boolean;
  readonly authorizedVisitor?: VisitorContext;
  readonly resolveVisitor?: (
    input: FacetAgUiVisitorResolutionInput,
  ) => VisitorContext | undefined | Promise<VisitorContext | undefined>;
}

export interface HandleAgUiRequestOptions extends Omit<
  RunFacetAsAgUiOptions,
  "authorizedVisitor" | "resolveVisitor"
> {
  readonly maxBodyBytes?: number;
  readonly maxBufferedSseEvents?: number | false;
  readonly resolveVisitor?: (
    req: IncomingMessage,
    input: FacetAgUiVisitorResolutionInput,
  ) => VisitorContext | undefined | Promise<VisitorContext | undefined>;
}

export type FacetAgUiInput =
  | {
      readonly kind: "event";
      readonly visitor: VisitorContext;
      readonly event: ClientEvent;
    }
  | {
      readonly kind: "record";
      readonly visitor: VisitorContext;
      readonly record: CollectedEvent;
    };

export type RunStartedAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_STARTED }>;
export type RunFinishedAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_FINISHED }>;
export type RunErrorAgUiEvent = Extract<AGUIEvent, { readonly type: EventType.RUN_ERROR }> & {
  readonly threadId?: string;
  readonly runId?: string;
};

export interface TextMessageState {
  nextIndex: number;
}

export type AgUiRuntimeExecutionOptions = Pick<
  RunFacetAsAgUiOptions,
  "includeSnapshot" | "snapshotTimeoutMs" | "maxInFlightRuns"
>;

export type AgUiHttpExecutionOptions = AgUiRuntimeExecutionOptions &
  Pick<HandleAgUiRequestOptions, "maxBufferedSseEvents">;

export interface StageSnapshotState {
  stage: FacetTree | undefined;
}

export class AgUiHttpInputError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AG-UI run failed";
}

export function logInternalFailure(label: string, error: unknown): void {
  const errorKind = error instanceof Error ? error.name : typeof error;
  console.error(`[facet/ag-ui] ${label}: ${errorKind}`);
}
