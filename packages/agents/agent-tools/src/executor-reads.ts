import {
  BOUNDS,
  buildCatalogIndex,
  measurePublishPayload,
  parseDataPath,
  serializeScreen,
} from "@facet/core";
import type { ComponentSpec, DataPath, FacetToolSession } from "@facet/core";

import type { ReadComponentSpecInput, ReadDataInput, ReadScreenInput } from "./types.js";

export type ReadComponentSpecResult =
  | {
      readonly ok: true;
      readonly spec: ComponentSpec;
      readonly stageRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "component_not_found";
      readonly available: readonly string[];
    };

export type ReadScreenResult =
  | {
      readonly ok: true;
      readonly screen: string;
      readonly markup: string;
      readonly issues: readonly string[];
      readonly stageRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "page_not_rendered";
      readonly detail: string;
    };

export type ReadDataResult =
  | {
      readonly ok: true;
      readonly path: string;
      readonly value: unknown;
      readonly count: number;
      readonly truncated: boolean;
      readonly stageRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_data_path";
      readonly detail: string;
    };

function pathText(path: readonly string[]): string {
  return path.join(".");
}

function issueText(issue: {
  readonly reason: string;
  readonly at: string;
  readonly prop?: string;
}): string {
  return issue.prop === undefined
    ? `${issue.reason}:${issue.at}`
    : `${issue.reason}:${issue.at}.${issue.prop}`;
}

function availableTags(session: FacetToolSession): readonly string[] {
  return Object.freeze(session.catalog.components.map((spec) => spec.tag).sort());
}

export async function executeReadComponentSpec(
  input: ReadComponentSpecInput,
  session: FacetToolSession,
): Promise<ReadComponentSpecResult> {
  const spec = buildCatalogIndex(session.catalog).get(input.tag);
  if (spec === undefined) {
    return Object.freeze({
      ok: false as const,
      code: "component_not_found" as const,
      available: availableTags(session),
    });
  }
  return Object.freeze({ ok: true as const, spec, stageRevision: session.stageRevision });
}

export async function executeReadScreen(
  input: ReadScreenInput,
  session: FacetToolSession,
): Promise<ReadScreenResult> {
  if (session.document === null) {
    return Object.freeze({
      ok: false as const,
      code: "page_not_rendered" as const,
      detail: "read_screen requires an existing page. Use render_page first.",
    });
  }
  const serialized = serializeScreen(session.document, input.screen);
  return Object.freeze({
    ok: true as const,
    screen: input.screen,
    markup: serialized.text,
    issues: Object.freeze(serialized.issues.map(issueText)),
    stageRevision: session.stageRevision,
  });
}

function readPath(data: FacetToolSession["data"], path: DataPath): unknown {
  let value: unknown = data;
  for (const segment of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (!Object.hasOwn(record, segment)) {
      return undefined;
    }
    value = record[segment];
  }
  return value;
}

function countOf(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length;
  }
  return value === undefined ? 0 : 1;
}

function envelope(
  path: string,
  value: unknown,
  count: number,
  truncated: boolean,
  stageRevision: number,
): Extract<ReadDataResult, { readonly ok: true }> {
  return Object.freeze({
    ok: true as const,
    path,
    value,
    count,
    truncated,
    stageRevision,
  });
}

function fits(result: ReadDataResult): boolean {
  const measured = measurePublishPayload(result);
  return measured.ok && measured.chars <= BOUNDS.readDataResult.chars;
}

function clampString(
  path: string,
  value: string,
  count: number,
  stageRevision: number,
): Extract<ReadDataResult, { readonly ok: true }> {
  let low = 0;
  let high = value.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (fits(envelope(path, candidate, count, true, stageRevision))) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return envelope(path, best, count, true, stageRevision);
}

function clampArray(
  path: string,
  value: readonly unknown[],
  stageRevision: number,
): Extract<ReadDataResult, { readonly ok: true }> {
  let limit = Math.min(value.length, BOUNDS.readDataResult.items);
  while (limit >= 0) {
    const candidate = envelope(
      path,
      value.slice(0, limit),
      value.length,
      limit < value.length,
      stageRevision,
    );
    if (fits(candidate)) {
      return candidate;
    }
    limit -= 1;
  }
  return envelope(path, [], value.length, true, stageRevision);
}

function clampObject(
  path: string,
  value: Readonly<Record<string, unknown>>,
  stageRevision: number,
): Extract<ReadDataResult, { readonly ok: true }> {
  const keys = Object.keys(value).sort();
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    const next = { ...projected, [key]: value[key] };
    const candidate = envelope(path, next, keys.length, true, stageRevision);
    if (!fits(candidate)) {
      break;
    }
    projected[key] = value[key];
  }
  const result = envelope(
    path,
    projected,
    keys.length,
    Object.keys(projected).length < keys.length,
    stageRevision,
  );
  return fits(result) ? result : envelope(path, {}, keys.length, true, stageRevision);
}

function boundedValue(
  path: string,
  value: unknown,
  stageRevision: number,
): Extract<ReadDataResult, { readonly ok: true }> {
  if (value === undefined) {
    return envelope(path, null, 0, false, stageRevision);
  }
  const count = countOf(value);
  const full = envelope(path, value, count, false, stageRevision);
  if (fits(full) && (!Array.isArray(value) || value.length <= BOUNDS.readDataResult.items)) {
    return full;
  }
  if (typeof value === "string") {
    return clampString(path, value, count, stageRevision);
  }
  if (Array.isArray(value)) {
    return clampArray(path, value, stageRevision);
  }
  if (typeof value === "object" && value !== null) {
    return clampObject(path, value as Readonly<Record<string, unknown>>, stageRevision);
  }
  return envelope(path, null, count, true, stageRevision);
}

export async function executeReadData(
  input: ReadDataInput,
  session: FacetToolSession,
): Promise<ReadDataResult> {
  const path = parseDataPath(input.path);
  if (path === null) {
    return Object.freeze({
      ok: false as const,
      code: "invalid_data_path" as const,
      detail: "read_data paths use named keys only.",
    });
  }
  return boundedValue(pathText(path), readPath(session.data, path), session.stageRevision);
}
