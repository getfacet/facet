import {
  EMPTY_TREE,
  validateTree,
  type FacetTree,
  type JsonPatchOperation,
  type ServerMessage,
} from "@facet/core";
import type {
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
} from "@facet/reference-agent";
import type { FacetServerObserver } from "@facet/server";

import { digestReplayTree } from "../runs/replay.js";
import { redactForCapture } from "../shared/redaction.js";
import {
  MAX_DIAGNOSTIC_ITEM_BYTES,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_EVIDENCE_ITEMS_PER_RUN,
  type AcceptedFrameEvidenceV1,
  type ColorMode,
  type EvidenceRecordV1,
  type JsonValue,
  type ProviderUsageEvidenceV1,
  type RunStatus,
  type StageCheckpointV1,
  type ViewCheckpointV1,
  type ViewportName,
} from "../shared/run-contract.js";

const DEFAULT_MAX_TIMELINE_BYTES = MAX_EVIDENCE_BUNDLE_BYTES - 8 * 1024 * 1024;
const CHECKPOINT_INTERVAL = 25;

export interface RunObserverSnapshot {
  readonly records: readonly EvidenceRecordV1[];
  readonly frames: readonly AcceptedFrameEvidenceV1[];
  readonly checkpoints: readonly StageCheckpointV1[];
  readonly viewCheckpoints: readonly ViewCheckpointV1[];
  readonly providerUsage: ProviderUsageEvidenceV1 | null;
  readonly stageVersion: number;
  readonly lastStage: FacetTree | null;
  readonly overflowed: boolean;
  readonly sealed: boolean;
}

export interface RunObserver {
  readonly diagnosticObserver: ReferenceAgentDiagnosticObserver;
  readonly serverObserver: FacetServerObserver;
  recordStatus(status: RunStatus): void;
  seal(): void;
  snapshot(): RunObserverSnapshot;
}

export interface CreateRunObserverOptions {
  readonly runId: string;
  readonly generation: number;
  readonly now?: () => string;
  readonly canaries?: readonly string[];
  readonly viewport?: ViewportName;
  readonly colorMode?: ColorMode;
  /** Per-run space left after accounting for its frozen assets and evidence envelope. */
  readonly maxTimelineBytes?: number;
  readonly onOverflow?: () => void;
  readonly onStop?: (
    reason: Extract<ReferenceAgentDiagnosticEvent, { readonly kind: "stop" }>["reason"],
  ) => void;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function messagesOfKind<MessageKind extends ServerMessage["kind"]>(
  messages: readonly ServerMessage[],
  kind: MessageKind,
): readonly Extract<ServerMessage, { readonly kind: MessageKind }>[] {
  return messages.filter(
    (message): message is Extract<ServerMessage, { readonly kind: MessageKind }> =>
      message.kind === kind,
  );
}

function diagnosticWasTruncated(event: ReferenceAgentDiagnosticEvent): boolean {
  return (event.kind === "tool-call" || event.kind === "tool-result") && event.truncated;
}

/** Correlates bounded agent/server observations into one immutable run timeline. */
export function createRunObserver(options: CreateRunObserverOptions): RunObserver {
  const now = options.now ?? (() => new Date().toISOString());
  const maxTimelineBytes = Math.max(
    0,
    Math.min(MAX_EVIDENCE_BUNDLE_BYTES, options.maxTimelineBytes ?? DEFAULT_MAX_TIMELINE_BYTES),
  );
  const records: EvidenceRecordV1[] = [];
  const frames: AcceptedFrameEvidenceV1[] = [];
  const checkpoints: StageCheckpointV1[] = [];
  const viewCheckpoints: ViewCheckpointV1[] = [];
  let ordinal = 0;
  let stageVersion = 0;
  let activeTurnId: string | null = null;
  let lastStage: FacetTree | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let hasProviderUsage = false;
  let timelineBytes = 0;
  let overflowed = false;
  let sealed = false;

  const project = (value: unknown): JsonValue | undefined => {
    const projected = redactForCapture(value, {
      maxBytes: MAX_DIAGNOSTIC_ITEM_BYTES,
      ...(options.canaries === undefined ? {} : { canaries: options.canaries }),
    });
    return projected.ok ? projected.value : undefined;
  };

  const encodedBytes = (value: unknown): number => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };

  const ordinaryItemCount = (): number =>
    records.length + frames.length + checkpoints.length + viewCheckpoints.length;

  const appendOverflow = (
    turnId: string | null,
    source: EvidenceRecordV1["source"],
    data: unknown,
    truncated: boolean,
  ): void => {
    if (sealed || overflowed) return;
    const projected = project(data);
    const record = deepFreeze({
      kind: "overflow",
      runId: options.runId,
      turnId,
      generation: options.generation,
      ordinal,
      timestamp: now(),
      source,
      truncated: truncated || projected === undefined,
      overflow: true,
      data: projected ?? { code: "projection-overflow" },
    } satisfies EvidenceRecordV1);
    overflowed = true;
    records.push(record);
    ordinal += 1;
    timelineBytes += encodedBytes(record);
    options.onOverflow?.();
  };

  const reserveOrdinaryItem = (turnId: string | null, bytes: number): boolean => {
    if (sealed || overflowed) return false;
    if (
      ordinaryItemCount() < MAX_EVIDENCE_ITEMS_PER_RUN - 1 &&
      Number.isFinite(bytes) &&
      timelineBytes + bytes <= maxTimelineBytes
    ) {
      return true;
    }
    appendOverflow(
      turnId,
      "lab",
      {
        code: ordinaryItemCount() >= MAX_EVIDENCE_ITEMS_PER_RUN - 1 ? "item-limit" : "byte-limit",
        maximumItems: MAX_EVIDENCE_ITEMS_PER_RUN,
        maximumBytes: maxTimelineBytes,
        dropped: 1,
      },
      true,
    );
    return false;
  };

  const appendRecord = (
    kind: EvidenceRecordV1["kind"],
    turnId: string | null,
    source: EvidenceRecordV1["source"],
    data: unknown,
    truncated = false,
  ): EvidenceRecordV1 | undefined => {
    if (kind === "overflow") {
      appendOverflow(turnId, source, data, truncated);
      return undefined;
    }
    const projected = project(data);
    if (projected === undefined) {
      appendOverflow(turnId, source, { code: "projection-overflow" }, true);
      return undefined;
    }
    const record = deepFreeze({
      kind,
      runId: options.runId,
      turnId,
      generation: options.generation,
      ordinal,
      timestamp: now(),
      source,
      truncated,
      overflow: false,
      data: projected,
    } satisfies EvidenceRecordV1);
    const bytes = encodedBytes(record);
    if (!reserveOrdinaryItem(turnId, bytes)) return undefined;
    records.push(record);
    ordinal += 1;
    timelineBytes += bytes;
    return record;
  };

  const diagnosticObserver: ReferenceAgentDiagnosticObserver = (event) => {
    if (sealed) return;
    if (event.kind === "batch" && event.usage !== undefined) {
      if (event.usage.inputTokens !== undefined) inputTokens += event.usage.inputTokens;
      if (event.usage.outputTokens !== undefined) outputTokens += event.usage.outputTokens;
      hasProviderUsage = true;
    }
    appendRecord(
      event.kind === "overflow" ? "overflow" : "diagnostic",
      activeTurnId,
      "agent",
      event,
      diagnosticWasTruncated(event),
    );
    if (event.kind === "stop") options.onStop?.(event.reason);
  };

  const serverObserver: FacetServerObserver = (observation) => {
    if (sealed) return;
    if (observation.kind === "ui-in") {
      const turnId = observation.turnId;
      if (turnId !== null) activeTurnId = turnId;
      const record = appendRecord("ui-in", turnId, "browser", observation, false);
      const view = "view" in observation.event ? observation.event.view : undefined;
      const projectedView = view === undefined ? undefined : project(view);
      if (record !== undefined && projectedView !== undefined) {
        const checkpoint = deepFreeze({
          ordinal: record.ordinal,
          viewport: options.viewport ?? "desktop",
          colorMode: options.colorMode ?? "light",
          view: projectedView,
        } satisfies ViewCheckpointV1);
        const bytes = encodedBytes(checkpoint);
        if (reserveOrdinaryItem(turnId, bytes)) {
          viewCheckpoints.push(checkpoint);
          timelineBytes += bytes;
        }
      }
      return;
    }

    const turnId = observation.turnId;
    const rawPatches = structuredClone(
      messagesOfKind(observation.messages, "patch").flatMap(({ patches: batch }) => batch),
    );
    const projectedStage = observation.stage === undefined ? undefined : project(observation.stage);
    const safeStage = projectedStage === undefined ? undefined : validateTree(projectedStage).tree;
    if (observation.disposition === "applied" && safeStage !== undefined) {
      // Preserve the accepted Stage before any evidence reservation can synchronously
      // overflow and seal the coordinator. The terminal full tree is replay-critical.
      lastStage = deepFreeze(structuredClone(safeStage));
    }
    if (
      observation.disposition === "applied" &&
      observation.agentMutated &&
      rawPatches.length > 0
    ) {
      stageVersion += 1;
    }
    const projectedPatches = project(rawPatches);
    if (!Array.isArray(projectedPatches)) {
      appendOverflow(turnId, "server", { code: "frame-projection-overflow" }, true);
      return;
    }
    const patches = projectedPatches as unknown as readonly JsonPatchOperation[];
    const says = messagesOfKind(observation.messages, "say").map(({ text }) => {
      const projected = project(text);
      return typeof projected === "string" ? projected : "[redacted]";
    });
    const frame = deepFreeze({
      runId: options.runId,
      turnId,
      generation: options.generation,
      ordinal,
      timestamp: now(),
      source: observation.source,
      stageVersion,
      patches,
      says,
      disposition: observation.disposition,
      postFoldTreeDigest: digestReplayTree(safeStage ?? lastStage ?? EMPTY_TREE),
    } satisfies AcceptedFrameEvidenceV1);
    const bytes = encodedBytes(frame);
    if (!reserveOrdinaryItem(turnId, bytes)) return;
    frames.push(frame);
    ordinal += 1;
    timelineBytes += bytes;
    if (observation.disposition === "applied" && safeStage !== undefined) {
      if (
        observation.agentMutated &&
        patches.length > 0 &&
        (stageVersion === 1 || stageVersion % CHECKPOINT_INTERVAL === 0)
      ) {
        const checkpoint = deepFreeze({
          ordinal: frame.ordinal,
          stageVersion,
          treeDigest: frame.postFoldTreeDigest,
          tree: structuredClone(safeStage),
        } satisfies StageCheckpointV1);
        const checkpointBytes = encodedBytes(checkpoint);
        if (reserveOrdinaryItem(turnId, checkpointBytes)) {
          checkpoints.push(checkpoint);
          timelineBytes += checkpointBytes;
        }
      }
    }
  };

  return Object.freeze({
    diagnosticObserver,
    serverObserver,
    recordStatus(status: RunStatus) {
      appendRecord("status", null, "lab", { status });
    },
    seal() {
      sealed = true;
    },
    snapshot(): RunObserverSnapshot {
      return Object.freeze({
        records: Object.freeze([...records]),
        frames: Object.freeze([...frames]),
        checkpoints: Object.freeze([...checkpoints]),
        viewCheckpoints: Object.freeze([...viewCheckpoints]),
        providerUsage: hasProviderUsage
          ? Object.freeze({
              ...(inputTokens === 0 ? {} : { inputTokens }),
              ...(outputTokens === 0 ? {} : { outputTokens }),
            })
          : null,
        stageVersion,
        lastStage,
        overflowed,
        sealed,
      });
    },
  });
}
