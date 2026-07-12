import type { IncomingMessage } from "node:http";

import type { RunAgentInput } from "@ag-ui/core";
import { MAX_FIELD_VALUE_CHARS, MAX_FIELDS_KEYS, sanitizeView } from "@facet/core";
import type {
  ClientEvent,
  CollectedEvent,
  FacetAction,
  FieldValues,
  TapEffect,
  VisitorContext,
} from "@facet/core";

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

  const visitor = normalizeVisitor(facet["visitor"]);
  if (visitor === undefined) return undefined;

  const eventValue = facet["event"];
  const recordValue = facet["record"];
  if (eventValue !== undefined && recordValue !== undefined) return undefined;
  if (eventValue !== undefined) {
    const event = normalizeClientEvent(eventValue);
    return event === undefined ? undefined : { kind: "event", visitor, event };
  }
  if (recordValue !== undefined) {
    const record = normalizeCollectedEvent(recordValue);
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
    return normalizeVisitor(facet["visitor"]);
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

function normalizeVisitor(value: unknown): VisitorContext | undefined {
  if (!isObject(value)) return undefined;
  const visitorId = value["visitorId"];
  if (typeof visitorId !== "string") return undefined;

  const referrer = optionalString(value, "referrer");
  const locale = optionalString(value, "locale");
  const relationship = optionalString(value, "relationship");
  if (referrer === null || locale === null || relationship === null) return undefined;

  return {
    visitorId,
    ...(referrer === undefined ? {} : { referrer }),
    ...(locale === undefined ? {} : { locale }),
    ...(relationship === undefined ? {} : { relationship }),
  };
}

function normalizeClientEvent(value: unknown): ClientEvent | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  const seq = optionalSeq(value);
  if (seq === null) return undefined;
  const view = sanitizeView(value["view"]);

  if (kind === "visit") {
    const eventVisitor = normalizeVisitor(value["visitor"]);
    return eventVisitor === undefined
      ? undefined
      : {
          kind: "visit",
          visitor: eventVisitor,
          ...(view === undefined ? {} : { view }),
          ...(seq === undefined ? {} : { seq }),
        };
  }
  if (kind === "message") {
    const text = value["text"];
    return typeof text === "string"
      ? { kind, text, ...(view === undefined ? {} : { view }), ...(seq === undefined ? {} : { seq }) }
      : undefined;
  }
  if (kind === "tap") {
    const action = normalizeAgentAction(value["action"]);
    if (action === undefined) return undefined;
    const fields = optionalFields(value);
    if (fields === null) return undefined;
    if (value["effect"] !== undefined || value["target"] !== undefined) return undefined;
    return {
      kind,
      action,
      ...(fields === undefined ? {} : { fields }),
      ...(view === undefined ? {} : { view }),
      ...(seq === undefined ? {} : { seq }),
    };
  }

  return undefined;
}

function normalizeCollectedEvent(value: unknown): CollectedEvent | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  const seq = optionalSeq(value);
  if (seq === null) return undefined;

  if (kind !== "tap") return undefined;
  if (value["action"] !== undefined) return undefined;
  const effect = optionalTapEffect(value);
  const fields = optionalFields(value);
  const target = optionalBoundedString(value, "target");
  if (effect === undefined || effect === null || fields === null || target === null) {
    return undefined;
  }
  const view = sanitizeView(value["view"]);

  return {
    kind,
    ...(target === undefined ? {} : { target }),
    effect,
    ...(fields === undefined ? {} : { fields }),
    ...(view === undefined ? {} : { view }),
    ...(seq === undefined ? {} : { seq }),
  };
}

function normalizeAgentAction(value: unknown): FacetAction | undefined {
  if (!isObject(value)) return undefined;
  const kind = value["kind"];
  if (kind !== undefined && kind !== "agent") return undefined;

  const name = value["name"];
  if (typeof name !== "string") return undefined;
  const payload = optionalPayload(value);
  const collect = optionalString(value, "collect");
  if (payload === null || collect === null) return undefined;

  return {
    ...(kind === "agent" ? { kind } : {}),
    name,
    ...(payload === undefined ? {} : { payload }),
    ...(collect === undefined ? {} : { collect }),
  };
}

function optionalTapEffect(object: Record<string, unknown>): TapEffect | undefined | null {
  const effect = object["effect"];
  if (effect === undefined) return undefined;
  if (!isObject(effect)) return null;
  const navigate = effect["navigate"];
  const toggle = effect["toggle"];
  if (
    typeof navigate === "string" &&
    navigate.length <= MAX_FIELD_VALUE_CHARS &&
    toggle === undefined
  )
    return { navigate };
  if (
    typeof toggle === "string" &&
    toggle.length <= MAX_FIELD_VALUE_CHARS &&
    navigate === undefined
  )
    return { toggle };
  return null;
}

function optionalFields(object: Record<string, unknown>): FieldValues | undefined | null {
  const fields = object["fields"];
  if (fields === undefined) return undefined;
  if (!isObject(fields)) return null;
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS_KEYS) return null;
  const normalized: Record<string, string | boolean> = {};
  for (const [name, value] of entries) {
    if (name.length > MAX_FIELD_VALUE_CHARS) return null;
    if (typeof value !== "string" && typeof value !== "boolean") return null;
    if (typeof value === "string" && value.length > MAX_FIELD_VALUE_CHARS) return null;
    normalized[name] = value;
  }
  return normalized;
}

function optionalPayload(
  object: Record<string, unknown>,
): Readonly<Record<string, string | number | boolean>> | undefined | null {
  const payload = object["payload"];
  if (payload === undefined) return undefined;
  if (!isObject(payload)) return null;
  const normalized: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    normalized[name] = value;
  }
  return normalized;
}

function optionalString(object: Record<string, unknown>, key: string): string | undefined | null {
  const value = object[key];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function optionalBoundedString(
  object: Record<string, unknown>,
  key: string,
): string | undefined | null {
  const value = optionalString(object, key);
  if (value === null || value === undefined) return value;
  return value.length <= MAX_FIELD_VALUE_CHARS ? value : null;
}

function optionalSeq(object: Record<string, unknown>): number | undefined | null {
  const seq = object["seq"];
  if (seq === undefined) return undefined;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
