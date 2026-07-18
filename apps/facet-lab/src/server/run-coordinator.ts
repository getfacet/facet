import { randomUUID } from "node:crypto";

import { EMPTY_TREE, type FacetAgent, type FacetTree } from "@facet/core";
import type {
  ReferenceAgentDiagnosticEvent,
  ReferenceAgentDiagnosticObserver,
  ReferenceProvider,
} from "@facet/reference-agent";
import type { Sink } from "@facet/runtime";
import type { FacetServerObserver } from "@facet/server";

import type { OfficialScenario, ScenarioConstraint } from "../scenarios/scenarios.js";
import {
  MAX_DIAGNOSTIC_ITEM_BYTES,
  MAX_EVIDENCE_BUNDLE_BYTES,
  type RunConfiguration,
  type RunEvidenceV1,
  type RunStatus,
} from "../shared/run-contract.js";
import { createRunAssetSnapshot, type AssetSnapshot } from "./asset-snapshot.js";
import { createLabAgent, type LabAgentAssembly } from "./lab-agent.js";
import type { ProviderRegistry } from "./provider-registry.js";
import { buildRunGuide } from "./run-guide.js";
import { createRunObserver, type RunObserver } from "./run-observer.js";

export interface CreateCoordinatedRunInput {
  readonly assets: AssetSnapshot;
  readonly configuration: RunConfiguration;
  readonly constraint: ScenarioConstraint | null;
  readonly scenario: OfficialScenario;
  readonly sink: Sink;
  readonly providerRegistry?: Pick<ProviderRegistry, "createProvider">;
  readonly onLifecycle?: (event: CoordinatedRunLifecycleEvent) => void;
}

export interface CoordinatedRunLifecycleEvent {
  readonly phase: "sealed" | "persisted";
  readonly identity: CoordinatedRunIdentity;
  readonly status: "complete" | "failed" | "cancelled" | "incomplete";
}

export interface CoordinatedRunIdentity {
  readonly runId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly generation: number;
}

export interface CoordinatedGeneration {
  readonly identity: CoordinatedRunIdentity;
  readonly agent: FacetAgent;
  readonly provider: ReferenceProvider;
  readonly assets: AssetSnapshot;
  readonly guide: string;
  readonly signal: AbortSignal;
  readonly diagnosticObserver: ReferenceAgentDiagnosticObserver;
  readonly serverObserver: FacetServerObserver;
}

export interface CoordinatedRunSnapshot {
  readonly identity: CoordinatedRunIdentity;
  readonly status: RunStatus;
  readonly generation: number;
  readonly assets: AssetSnapshot;
  readonly records: RunEvidenceV1["records"];
  readonly frames: RunEvidenceV1["frames"];
  readonly checkpoints: RunEvidenceV1["checkpoints"];
  readonly viewCheckpoints: RunEvidenceV1["viewCheckpoints"];
  readonly providerUsage: RunEvidenceV1["providerUsage"];
  readonly stageVersion: number;
  readonly finalTree: FacetTree | null;
  readonly sealed: boolean;
}

export interface CreatedCoordinatedRun {
  readonly runId: string;
  readonly generation: number;
  readonly status: "queued";
}

export type StartCoordinatedRunResult =
  | { readonly ok: true; readonly generation: CoordinatedGeneration }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "already-running" | "sealed-run" | "assembly-failed";
    };

export type SettleCoordinatedRunResult =
  | { readonly ok: true; readonly changed: boolean; readonly generation: number }
  | {
      readonly ok: false;
      readonly reason: "not-found" | "not-running" | "sealed-generation" | "persistence-failed";
    };

export interface CompleteCoordinatedRunInput {
  readonly status: "complete" | "failed" | "incomplete";
  readonly finalTree: FacetTree | null;
}

export interface CreateRunCoordinatorOptions {
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly canaries?: readonly string[];
  readonly persist?: (evidence: RunEvidenceV1) => boolean | void | Promise<boolean | void>;
  readonly publish?: (evidence: RunEvidenceV1) => void | Promise<void>;
}

export interface RunCoordinator {
  create(input: CreateCoordinatedRunInput): CreatedCoordinatedRun;
  start(runId: string): StartCoordinatedRunResult;
  cancel(runId: string): Promise<SettleCoordinatedRunResult>;
  restart(runId: string): StartCoordinatedRunResult;
  complete(
    runId: string,
    generation: number,
    result: CompleteCoordinatedRunInput,
  ): Promise<SettleCoordinatedRunResult>;
  snapshot(runId: string): CoordinatedRunSnapshot | undefined;
  forget(runId: string): boolean;
}

interface FrozenRunInput {
  readonly configuration: RunConfiguration;
  readonly constraint: ScenarioConstraint | null;
  readonly scenario: OfficialScenario;
  readonly sink: Sink;
  readonly providerRegistry?: Pick<ProviderRegistry, "createProvider">;
  readonly onLifecycle?: (event: CoordinatedRunLifecycleEvent) => void;
}

interface RunEntry {
  readonly identity: CoordinatedRunIdentity;
  readonly input: FrozenRunInput;
  readonly assets: AssetSnapshot;
  readonly guide: string;
  readonly createdAt: string;
  readonly abortController: AbortController;
  readonly observer: RunObserver;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  finalTree: FacetTree | null;
  assembly: LabAgentAssembly | null;
  persisted: boolean;
  published: boolean;
  sealedNotified: boolean;
  persistedNotified: boolean;
  settlement: Promise<boolean> | null;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assetSource(source: AssetSnapshot["source"]): RunEvidenceV1["run"]["assetSource"] {
  return source === "default" ? "default" : "imported";
}

function createIdentity(createId: () => string, generation: number): CoordinatedRunIdentity {
  return Object.freeze({
    runId: createId(),
    sessionId: createId(),
    visitorId: createId(),
    generation,
  });
}

function freezeInput(input: CreateCoordinatedRunInput): FrozenRunInput {
  const configuration = deepFreeze(structuredClone(input.configuration));
  const constraint =
    input.constraint === null ? null : deepFreeze(structuredClone(input.constraint));
  const scenario = deepFreeze(structuredClone(input.scenario));
  if (configuration.scenarioId !== scenario.id) {
    throw new Error("Run configuration scenario identity does not match the selected scenario");
  }
  return Object.freeze({
    configuration,
    constraint,
    scenario,
    sink: input.sink,
    ...(input.providerRegistry === undefined ? {} : { providerRegistry: input.providerRegistry }),
    ...(input.onLifecycle === undefined ? {} : { onLifecycle: input.onLifecycle }),
  });
}

const EVIDENCE_DYNAMIC_RESERVE_BYTES = 2 * MAX_DIAGNOSTIC_ITEM_BYTES;

function timelineBudget(
  input: FrozenRunInput,
  assets: AssetSnapshot,
  identity: CoordinatedRunIdentity,
  createdAt: string,
): number {
  const baseEvidence: RunEvidenceV1 = {
    schemaVersion: 1,
    run: {
      ...input.configuration,
      ...identity,
      status: "running",
      createdAt,
      startedAt: createdAt,
      completedAt: null,
      assetDigest: assets.digest,
      assetSource: assetSource(assets.source),
      importedFromRunId: null,
    },
    assets: {
      digest: assets.digest,
      source: assetSource(assets.source),
      theme: assets.theme,
      patterns: assets.patterns,
    },
    initialTree: EMPTY_TREE,
    finalTree: null,
    records: [],
    frames: [],
    checkpoints: [],
    viewCheckpoints: [],
    providerUsage: null,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
  const envelopeBytes = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      evidence: baseEvidence,
      artifacts: [],
      digest: `sha256:${"0".repeat(64)}`,
    }),
  ).byteLength;
  const available = MAX_EVIDENCE_BUNDLE_BYTES - envelopeBytes - EVIDENCE_DYNAMIC_RESERVE_BYTES;
  if (available < 0) {
    throw new Error("Frozen assets leave no room for terminal Facet Lab evidence");
  }
  return available;
}

type DiagnosticStopReason = Extract<
  ReferenceAgentDiagnosticEvent,
  { readonly kind: "stop" }
>["reason"];

function statusForDiagnosticStop(reason: DiagnosticStopReason): "failed" | "incomplete" | null {
  switch (reason) {
    case "budget":
    case "aborted":
      return "incomplete";
    case "provider-error":
    case "invalid-output":
      return "failed";
    case "complete":
      // A clean stop finishes one conversational turn; the live run remains interactive.
      return null;
  }
}

/** One coordinator owns unique identities and terminal sealing for every Lab run. */
export function createRunCoordinator(options: CreateRunCoordinatorOptions = {}): RunCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? randomUUID;
  const runs = new Map<string, RunEntry>();

  const makeEntry = (
    input: FrozenRunInput,
    assets: AssetSnapshot,
    guide: string,
    generation: number,
  ): RunEntry => {
    const identity = createIdentity(createId, generation);
    const createdAt = now();
    const entryRef: { current?: RunEntry } = {};
    const observer = createRunObserver({
      runId: identity.runId,
      generation,
      now,
      ...(options.canaries === undefined ? {} : { canaries: options.canaries }),
      viewport: input.configuration.viewport,
      colorMode: input.configuration.colorMode,
      maxTimelineBytes: timelineBudget(input, assets, identity, createdAt),
      onOverflow: () => {
        if (entryRef.current !== undefined) settleFromObserver(entryRef.current, "incomplete");
      },
      onStop: (reason) => {
        const status = statusForDiagnosticStop(reason);
        if (status !== null && entryRef.current !== undefined) {
          settleFromObserver(entryRef.current, status);
        }
      },
    });
    const entry: RunEntry = {
      identity,
      input,
      assets,
      guide,
      createdAt,
      abortController: new AbortController(),
      observer,
      status: "queued",
      startedAt: null,
      completedAt: null,
      finalTree: null,
      assembly: null,
      persisted: false,
      published: false,
      sealedNotified: false,
      persistedNotified: false,
      settlement: null,
    };
    entryRef.current = entry;
    return entry;
  };

  const snapshot = (entry: RunEntry): CoordinatedRunSnapshot => {
    const observed = entry.observer.snapshot();
    return Object.freeze({
      identity: entry.identity,
      status: entry.status,
      generation: entry.identity.generation,
      assets: entry.assets,
      records: observed.records,
      frames: observed.frames,
      checkpoints: observed.checkpoints,
      viewCheckpoints: observed.viewCheckpoints,
      providerUsage: observed.providerUsage,
      stageVersion: observed.stageVersion,
      finalTree: entry.finalTree ?? observed.lastStage,
      sealed: observed.sealed,
    });
  };

  const evidence = (entry: RunEntry): RunEvidenceV1 => {
    const current = snapshot(entry);
    return deepFreeze({
      schemaVersion: 1 as const,
      run: {
        ...entry.input.configuration,
        runId: entry.identity.runId,
        sessionId: entry.identity.sessionId,
        visitorId: entry.identity.visitorId,
        generation: entry.identity.generation,
        status: entry.status,
        createdAt: entry.createdAt,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        assetDigest: entry.assets.digest,
        assetSource: assetSource(entry.assets.source),
        importedFromRunId: null,
      },
      assets: {
        digest: entry.assets.digest,
        source: assetSource(entry.assets.source),
        theme: entry.assets.theme,
        patterns: entry.assets.patterns,
      },
      initialTree: EMPTY_TREE,
      finalTree: current.finalTree,
      records: current.records,
      frames: current.frames,
      checkpoints: current.checkpoints,
      viewCheckpoints: current.viewCheckpoints,
      providerUsage: current.providerUsage,
      warnings: entry.observer.snapshot().overflowed
        ? [
            {
              code: "evidence-overflow",
              classification: "overflow",
              message: "The evidence budget was reached; the run was sealed as incomplete.",
              ordinal: current.records.at(-1)?.ordinal ?? null,
            },
          ]
        : [],
      checks: [],
      visualEvaluations: [],
      artifacts: [],
    } satisfies RunEvidenceV1);
  };

  const notifyLifecycle = (entry: RunEntry, phase: CoordinatedRunLifecycleEvent["phase"]): void => {
    if (
      entry.status !== "complete" &&
      entry.status !== "failed" &&
      entry.status !== "cancelled" &&
      entry.status !== "incomplete"
    ) {
      return;
    }
    try {
      entry.input.onLifecycle?.({ phase, identity: entry.identity, status: entry.status });
    } catch {
      // Lifecycle cleanup is best-effort and must not invalidate sealed evidence.
    }
  };

  const persistAndPublish = async (entry: RunEntry): Promise<boolean> => {
    if (entry.persisted && entry.published) return true;
    if (entry.settlement !== null) return entry.settlement;
    const pending = (async (): Promise<boolean> => {
      const terminalEvidence = evidence(entry);
      try {
        if (!entry.persisted) {
          const accepted = await options.persist?.(terminalEvidence);
          if (accepted === false) return false;
          entry.persisted = true;
        }
        if (!entry.published) {
          await options.publish?.(terminalEvidence);
          entry.published = true;
        }
        if (!entry.persistedNotified) {
          entry.persistedNotified = true;
          notifyLifecycle(entry, "persisted");
        }
        return true;
      } catch {
        return false;
      }
    })();
    entry.settlement = pending;
    const accepted = await pending;
    if (!accepted) entry.settlement = null;
    return accepted;
  };

  function prepareSettlement(
    entry: RunEntry,
    status: "complete" | "failed" | "cancelled" | "incomplete",
    finalTree: FacetTree | null,
    abortReason: Error | undefined,
  ): boolean {
    if (entry.status !== "running" && entry.status !== "queued") return false;
    entry.status = status;
    entry.completedAt = now();
    entry.finalTree =
      finalTree === null
        ? entry.observer.snapshot().lastStage
        : deepFreeze(structuredClone(finalTree));
    entry.observer.recordStatus(status);
    entry.observer.seal();
    if (!entry.sealedNotified) {
      entry.sealedNotified = true;
      notifyLifecycle(entry, "sealed");
    }
    if (abortReason !== undefined && !entry.abortController.signal.aborted) {
      entry.abortController.abort(abortReason);
    }
    return true;
  }

  function settleFromObserver(entry: RunEntry, status: "failed" | "incomplete"): void {
    if (!prepareSettlement(entry, status, null, new Error(`Facet Lab run ${status}`))) return;
    void persistAndPublish(entry);
  }

  const start = (runId: string): StartCoordinatedRunResult => {
    const entry = runs.get(runId);
    if (entry === undefined) return { ok: false, reason: "not-found" };
    if (entry.status === "running") return { ok: false, reason: "already-running" };
    if (entry.status !== "queued") return { ok: false, reason: "sealed-run" };

    try {
      const assembly = createLabAgent({
        agentId: entry.identity.runId,
        assets: entry.assets,
        configuration: entry.input.configuration,
        guide: entry.guide,
        scenario: entry.input.scenario,
        sink: entry.input.sink,
        ...(entry.input.providerRegistry === undefined
          ? {}
          : { providerRegistry: entry.input.providerRegistry }),
        signal: entry.abortController.signal,
        diagnosticObserver: entry.observer.diagnosticObserver,
      });
      entry.assembly = assembly;
      entry.status = "running";
      entry.startedAt = now();
      return {
        ok: true,
        generation: Object.freeze({
          identity: entry.identity,
          agent: assembly.agent,
          provider: assembly.provider,
          assets: entry.assets,
          guide: entry.guide,
          signal: entry.abortController.signal,
          diagnosticObserver: entry.observer.diagnosticObserver,
          serverObserver: entry.observer.serverObserver,
        }),
      };
    } catch {
      prepareSettlement(entry, "failed", null, new Error("Facet Lab assembly failed"));
      void persistAndPublish(entry);
      return { ok: false, reason: "assembly-failed" };
    }
  };

  const cancel = async (runId: string): Promise<SettleCoordinatedRunResult> => {
    const entry = runs.get(runId);
    if (entry === undefined) return { ok: false, reason: "not-found" };
    if (entry.status === "cancelled" || entry.status === "incomplete") {
      if (!(await persistAndPublish(entry))) return { ok: false, reason: "persistence-failed" };
      return { ok: true, changed: false, generation: entry.identity.generation };
    }
    if (entry.status !== "running" && entry.status !== "queued") {
      return { ok: false, reason: "sealed-generation" };
    }
    prepareSettlement(
      entry,
      entry.observer.snapshot().overflowed ? "incomplete" : "cancelled",
      null,
      new Error("Facet Lab run cancelled"),
    );
    if (!(await persistAndPublish(entry))) return { ok: false, reason: "persistence-failed" };
    return { ok: true, changed: true, generation: entry.identity.generation };
  };

  const complete = async (
    runId: string,
    generation: number,
    result: CompleteCoordinatedRunInput,
  ): Promise<SettleCoordinatedRunResult> => {
    const entry = runs.get(runId);
    if (entry === undefined) return { ok: false, reason: "not-found" };
    if (
      entry.identity.generation === generation &&
      entry.status === result.status &&
      entry.observer.snapshot().sealed
    ) {
      if (!(await persistAndPublish(entry))) return { ok: false, reason: "persistence-failed" };
      return { ok: true, changed: false, generation };
    }
    if (entry.identity.generation !== generation || entry.status !== "running") {
      return { ok: false, reason: "sealed-generation" };
    }
    prepareSettlement(
      entry,
      entry.observer.snapshot().overflowed ? "incomplete" : result.status,
      result.finalTree,
      undefined,
    );
    if (!(await persistAndPublish(entry))) return { ok: false, reason: "persistence-failed" };
    return { ok: true, changed: true, generation };
  };

  return Object.freeze({
    create(input: CreateCoordinatedRunInput): CreatedCoordinatedRun {
      const frozenInput = freezeInput(input);
      const assets = createRunAssetSnapshot(input.assets);
      const guide = buildRunGuide({
        scenario: frozenInput.scenario,
        prompt: frozenInput.configuration.prompt,
        constraint: frozenInput.constraint,
      });
      const entry = makeEntry(frozenInput, assets, guide, 1);
      runs.set(entry.identity.runId, entry);
      return Object.freeze({
        runId: entry.identity.runId,
        generation: entry.identity.generation,
        status: "queued" as const,
      });
    },
    start,
    cancel,
    restart(runId: string): StartCoordinatedRunResult {
      const prior = runs.get(runId);
      if (prior === undefined) return { ok: false, reason: "not-found" };
      if (
        prior.status !== "cancelled" &&
        prior.status !== "failed" &&
        prior.status !== "incomplete"
      ) {
        return { ok: false, reason: prior.status === "running" ? "already-running" : "sealed-run" };
      }
      const restarted = makeEntry(
        prior.input,
        prior.assets,
        prior.guide,
        prior.identity.generation + 1,
      );
      runs.set(restarted.identity.runId, restarted);
      return start(restarted.identity.runId);
    },
    complete,
    snapshot(runId: string): CoordinatedRunSnapshot | undefined {
      const entry = runs.get(runId);
      return entry === undefined ? undefined : snapshot(entry);
    },
    forget(runId: string): boolean {
      const entry = runs.get(runId);
      if (entry === undefined || !entry.persisted || !entry.observer.snapshot().sealed)
        return false;
      return runs.delete(runId);
    },
  });
}
