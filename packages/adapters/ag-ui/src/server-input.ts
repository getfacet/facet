import type { IncomingMessage } from "node:http";

import type { RunAgentInput } from "@ag-ui/core";
import {
  normalizeClientEvent,
  normalizeLocalCollectedEvent,
  normalizeVisitorContext,
} from "@facet/core";
import type { VisitorContext } from "@facet/core";

import {
  AgUiHttpInputError,
  logInternalFailure,
  type FacetAgUiInput,
  type FacetAgUiVisitorResolutionInput,
  type HandleAgUiRequestOptions,
  type RunFacetAsAgUiOptions,
} from "./server-types.js";

export function requireFacetInput(input: RunAgentInput): FacetAgUiInput {
  try {
    const facetInput = facetInputFromRunAgentInput(input);
    if (facetInput !== undefined) return facetInput;
  } catch {
    // Fall through to the uniform BAD_REQUEST below.
  }
  throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed Facet forwardedProps");
}

export function facetInputFromRunAgentInput(input: RunAgentInput): FacetAgUiInput | undefined {
  const forwardedProps: unknown = input.forwardedProps;
  if (!isObject(forwardedProps)) return undefined;
  const facet = forwardedProps["facet"];
  if (!isObject(facet)) return undefined;

  const visitor = normalizeVisitorContext(facet["visitor"]);
  if (visitor === undefined) return undefined;

  const eventValue = facet["event"];
  const recordValue = facet["record"];
  if (eventValue !== undefined && recordValue !== undefined) return undefined;
  if (eventValue !== undefined) {
    const event = normalizeClientEvent(eventValue);
    return event === undefined ? undefined : { kind: "event", visitor, event };
  }
  if (recordValue !== undefined) {
    const record = normalizeLocalCollectedEvent(recordValue);
    return record === undefined ? undefined : { kind: "record", visitor, record };
  }

  return undefined;
}

export async function authorizeDirectRunInput(
  input: RunAgentInput,
  options: RunFacetAsAgUiOptions,
): Promise<RunAgentInput> {
  const forwardedVisitor = forwardedVisitorFromRunAgentInput(input);
  if (options.authorizedVisitor !== undefined) {
    return withAuthorizedVisitor(input, options.authorizedVisitor);
  }
  if (options.resolveVisitor !== undefined) {
    const visitor = await options.resolveVisitor(visitorResolutionInput(input, forwardedVisitor));
    if (visitor === undefined) {
      throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor is not authorized");
    }
    return withAuthorizedVisitor(input, visitor);
  }
  if (options.allowForwardedVisitor === true) return input;
  throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor resolver required");
}

export async function authorizeHttpRunInput(
  req: IncomingMessage,
  input: RunAgentInput,
  options: HandleAgUiRequestOptions,
): Promise<RunAgentInput> {
  const forwardedVisitor = forwardedVisitorFromRunAgentInput(input);
  if (options.resolveVisitor !== undefined) {
    const visitor = await options.resolveVisitor(
      req,
      visitorResolutionInput(input, forwardedVisitor),
    );
    if (visitor === undefined) {
      throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor is not authorized");
    }
    return withAuthorizedVisitor(input, visitor);
  }
  if (options.allowForwardedVisitor === true) return input;
  throw new AgUiHttpInputError(403, "FORBIDDEN", "AG-UI visitor resolver required");
}

export async function authorizeHttpRunInputUntilOpen(
  req: IncomingMessage,
  input: RunAgentInput,
  options: HandleAgUiRequestOptions,
  closed: Promise<void>,
): Promise<RunAgentInput | undefined> {
  const authorization = authorizeHttpRunInput(req, input, options);
  const result = await Promise.race([
    authorization.then(
      (runInput) => ({ kind: "authorized" as const, runInput }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    closed.then(() => ({ kind: "closed" as const })),
  ]);

  if (result.kind === "closed") {
    void authorization.catch((error: unknown) => {
      logInternalFailure("authorization failed after response close", error);
    });
    return undefined;
  }
  if (result.kind === "error") throw result.error;
  return result.runInput;
}

function visitorResolutionInput(
  input: RunAgentInput,
  forwardedVisitor: VisitorContext | undefined,
): FacetAgUiVisitorResolutionInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    ...(forwardedVisitor === undefined ? {} : { forwardedVisitor }),
  };
}

export function forwardedVisitorFromRunAgentInput(
  input: RunAgentInput,
): VisitorContext | undefined {
  try {
    const forwardedProps: unknown = input.forwardedProps;
    if (!isObject(forwardedProps)) return undefined;
    const facet = forwardedProps["facet"];
    if (!isObject(facet)) return undefined;
    return normalizeVisitorContext(facet["visitor"]);
  } catch {
    return undefined;
  }
}

function withAuthorizedVisitor(input: RunAgentInput, visitor: VisitorContext): RunAgentInput {
  try {
    const forwardedProps: Record<string, unknown> = isObject(input.forwardedProps)
      ? input.forwardedProps
      : {};
    const facet: Record<string, unknown> = isObject(forwardedProps["facet"])
      ? forwardedProps["facet"]
      : {};
    const event = authorizedEventValue(facet["event"], visitor);
    return {
      ...input,
      forwardedProps: {
        ...forwardedProps,
        facet: {
          ...facet,
          visitor,
          ...(event === undefined ? {} : { event }),
        },
      },
    };
  } catch {
    throw new AgUiHttpInputError(400, "BAD_REQUEST", "Malformed Facet forwardedProps");
  }
}

function authorizedEventValue(event: unknown, visitor: VisitorContext): unknown {
  if (!isObject(event) || event["kind"] !== "visit") return event;
  return { ...event, visitor };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
