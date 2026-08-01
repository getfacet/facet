import { describeDataValue, measurePublishPayload } from "@facet/core";
import type {
  DataPath,
  DataValueDescriptor,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";

export interface PublishExecutorInput {
  readonly path: DataPath;
  readonly value: unknown;
  readonly trusted?: boolean;
}

export type PublishDataResult =
  | {
      readonly ok: true;
      readonly descriptor: DataValueDescriptor;
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
    descriptor: describeDataValue(pathText(input.path), input.value),
    stageRevision: session.stageRevision,
  });
}
