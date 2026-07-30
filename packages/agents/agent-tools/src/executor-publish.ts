import { measurePublishPayload } from "@facet/core";
import type { DataPath, FacetToolSession, PayloadEvaluation } from "@facet/core";

export interface PublishExecutorInput {
  readonly path: DataPath;
  readonly value: unknown;
  readonly trusted?: boolean;
}

type PublishedShape = "null" | "string" | "number" | "boolean" | "array" | "object";

export type PublishDataResult =
  | {
      readonly ok: true;
      readonly descriptor: {
        readonly path: string;
        readonly shape: PublishedShape;
        readonly fields: readonly string[];
        readonly count: number;
      };
      readonly stageRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: Extract<PayloadEvaluation, { readonly ok: false }>["reason"];
      readonly bound: string | null;
      readonly path: string;
    };

function pathText(path: DataPath): string {
  return path.join(".");
}

function shapeOf(value: unknown): PublishedShape {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

function fieldsOf(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    const fields = new Set<string>();
    for (const item of value) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        continue;
      }
      for (const key of Object.keys(item)) {
        fields.add(key);
      }
    }
    return Object.freeze([...fields].sort());
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(Object.keys(value).sort());
  }
  return Object.freeze([]);
}

function countOf(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length;
  }
  return 1;
}

function rejection(result: Extract<PayloadEvaluation, { readonly ok: false }>): PublishDataResult {
  return Object.freeze({
    ok: false as const,
    code: result.reason,
    bound: result.bound,
    path: result.path,
  });
}

export async function executePublishData(
  input: PublishExecutorInput,
  session: FacetToolSession,
): Promise<PublishDataResult> {
  if (input.trusted !== true) {
    const measured = measurePublishPayload(input.value);
    if (!measured.ok) {
      return rejection(measured);
    }
  }
  const published = await session.publishData(input.path, input.value);
  if (!published.ok) {
    return rejection(published);
  }
  return Object.freeze({
    ok: true as const,
    descriptor: Object.freeze({
      path: pathText(input.path),
      shape: shapeOf(input.value),
      fields: fieldsOf(input.value),
      count: countOf(input.value),
    }),
    stageRevision: session.stageRevision,
  });
}
