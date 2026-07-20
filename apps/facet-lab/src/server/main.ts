import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRICK_TYPES,
  EMPTY_TREE,
  asAgentServerMessage,
  iterateAgentResult,
  type BrickType,
  type FacetAgent,
  type FacetNode,
  type ServerMessage,
} from "@facet/core";
import { MemorySink } from "@facet/runtime";
import type { FacetServerObservation } from "@facet/server";
import { chromium, type Browser } from "playwright";

import { createCatalogModel, PACKAGE_CATALOG_SOURCE } from "../catalog/catalog-model.js";
import { evaluateContract, type ContractAssetInventory } from "../evaluation/contract-evaluator.js";
import { appendVisualEvaluation } from "../evaluation/visual-evidence.js";
import {
  FREE_FORM_SCENARIO,
  OFFICIAL_SCENARIOS,
  type OfficialScenario,
  type ScenarioConstraint,
} from "../scenarios/scenarios.js";
import {
  DEFAULT_RETAINED_RUNS,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_JSON_REQUEST_BYTES,
  type RunConfiguration,
  type RunEvidenceV1,
} from "../shared/run-contract.js";
import { redactForCapture } from "../shared/redaction.js";
import { createDefaultAssetSnapshot, type AssetSnapshot } from "./asset-snapshot.js";
import { resolveFacetLabDataDirectory, type FacetLabDataDirectory } from "./data-directory.js";
import { exportEvidenceBundle, type EvidenceArtifact } from "./evidence-bundle.js";
import { createEvidenceStore, type EvidenceStore } from "./evidence-store.js";
import { LabHttpError, readBoundedBody } from "./http-security.js";
import { createProviderRegistry, type ProviderRegistry } from "./provider-registry.js";
import {
  createRunCoordinator,
  type CoordinatedGeneration,
  type CoordinatedRunSnapshot,
  type RunCoordinator,
  type SettleCoordinatedRunResult,
} from "./run-coordinator.js";
import {
  createPlaywrightScreenshotDriver,
  createScreenshotService,
  type ScreenshotDriver,
} from "./screenshot-service.js";
import {
  createLabVisitorRegistry,
  createLabWebHost,
  startLabInnerServer,
  type LabVisitorRegistry,
  type LabWebHostApiRequest,
} from "./web-host.js";
import {
  createLabApiRoutes,
  LabApiValidationError,
  type LabApiArtifact,
  type LabApiBackend,
  type LabApiRequest,
  type LabApiResponse,
  type LabApiRoutes,
  type LabRunListFilters,
} from "./api-routes.js";

const DEFAULT_PORT = 5293;
const HOST = "127.0.0.1";
const MAX_ACTIVE_RUNS = 100;
const STATIC_ROOT = fileURLToPath(new URL("../../dist/browser/", import.meta.url));

interface LiveRunMetadata {
  readonly configuration: RunConfiguration;
  readonly assets: AssetSnapshot;
  readonly createdAt: string;
  readonly startedAt: string;
}

export interface StartFacetLabOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly port?: number;
  readonly staticRoot?: string;
  readonly dataDirectory?: FacetLabDataDirectory | string;
  readonly screenshotDriver?: ScreenshotDriver;
  readonly enablePlaywrightScreenshots?: boolean;
  readonly now?: () => string;
}

export interface RunningFacetLab {
  readonly url: string;
  readonly dataDirectory: string;
  close(): Promise<void>;
}

async function* redactAgentOutput(
  result: ReturnType<FacetAgent>,
  canaries: readonly string[],
): AsyncGenerator<readonly ServerMessage[]> {
  for await (const batch of iterateAgentResult(result)) {
    const projected = redactForCapture(batch, { canaries });
    if (!projected.ok || !Array.isArray(projected.value)) continue;
    const messages = projected.value.flatMap((value) => {
      const message = asAgentServerMessage(value);
      return message === undefined ? [] : [message];
    });
    if (messages.length > 0) yield messages;
  }
}

function readPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (
    !/^(?:[1-9]|[1-9][0-9]{1,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/u.test(
      value,
    )
  ) {
    throw new Error("FACET_LAB_PORT must be an integer between 1 and 65535");
  }
  return Number(value);
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function apiHeaders(headers: IncomingHttpHeaders): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    "content-type": singleHeader(headers["content-type"]),
    "last-event-id": singleHeader(headers["last-event-id"]),
  });
}

function isAsyncText(value: unknown): value is AsyncIterable<string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function awaitsJsonBody(response: LabApiResponse): boolean {
  if (response.status !== 400 || typeof response.body !== "object" || response.body === null) {
    return false;
  }
  const error = Reflect.get(response.body, "error");
  return (
    typeof error === "object" && error !== null && Reflect.get(error, "code") === "missing-body"
  );
}

async function writeApiResponse(response: ServerResponse, result: LabApiResponse): Promise<void> {
  response.writeHead(result.status, result.headers);
  if (result.body instanceof Uint8Array) {
    response.end(result.body);
    return;
  }
  if (isAsyncText(result.body)) {
    for await (const chunk of result.body) {
      if (!response.write(chunk)) {
        await new Promise<void>((resolveWrite) => {
          const settle = (): void => {
            response.off("drain", settle);
            response.off("close", settle);
            response.off("error", settle);
            resolveWrite();
          };
          response.once("drain", settle);
          response.once("close", settle);
          response.once("error", settle);
        });
        if (response.destroyed) return;
      }
    }
    response.end();
    return;
  }
  const contentType = result.headers["content-type"] ?? "";
  response.end(
    typeof result.body === "string" && contentType.startsWith("application/json")
      ? result.body
      : JSON.stringify(result.body),
  );
}

/** Bridges the already-inspected WU-17 request into the pure allowlist router. */
export function createNodeLabApiHandler(
  routes: LabApiRoutes,
): (input: LabWebHostApiRequest) => Promise<void> {
  return async ({ request, response, url, maxBodyBytes }) => {
    const controller = new AbortController();
    response.once("close", () => controller.abort());
    const method = request.method ?? "GET";
    const target = `${url.pathname}${url.search}`;
    const headers = apiHeaders(request.headers);
    let body: Uint8Array | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const preliminary = await routes.handle({
        method,
        target,
        headers,
        signal: controller.signal,
      });
      if (!awaitsJsonBody(preliminary)) {
        await writeApiResponse(response, preliminary);
        return;
      }
      if (!singleHeader(request.headers["content-type"])?.startsWith("application/json")) {
        await writeApiResponse(response, {
          status: 415,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
          body: { error: { code: "content-type", message: "application/json is required." } },
        });
        return;
      }
      const routeMaximum =
        url.pathname === "/api/runs/import" ? MAX_EVIDENCE_BUNDLE_BYTES : MAX_JSON_REQUEST_BYTES;
      try {
        body = new Uint8Array(await readBoundedBody(request, Math.min(maxBodyBytes, routeMaximum)));
      } catch (error: unknown) {
        const status = error instanceof LabHttpError ? error.status : 400;
        await writeApiResponse(response, {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
          body: {
            error: {
              code: status === 413 ? "body-too-large" : "invalid-body",
              message: status === 413 ? "Request body is too large." : "Request body is invalid.",
            },
          },
        });
        return;
      }
    }
    const apiRequest: LabApiRequest = {
      method,
      target,
      headers,
      signal: controller.signal,
      ...(body === undefined ? {} : { body }),
    };
    await writeApiResponse(response, await routes.handle(apiRequest));
  };
}

function toLiveEvidence(
  metadata: LiveRunMetadata,
  snapshot: CoordinatedRunSnapshot,
): RunEvidenceV1 {
  return {
    schemaVersion: 1,
    run: {
      ...metadata.configuration,
      ...snapshot.identity,
      status: snapshot.status,
      createdAt: metadata.createdAt,
      startedAt: metadata.startedAt,
      completedAt: null,
      assetDigest: metadata.assets.digest,
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: {
      digest: metadata.assets.digest,
      source: "default",
      theme: metadata.assets.theme,
      patterns: metadata.assets.patterns,
    },
    initialTree: EMPTY_TREE,
    finalTree: snapshot.finalTree,
    records: snapshot.records,
    frames: snapshot.frames,
    checkpoints: snapshot.checkpoints,
    viewCheckpoints: snapshot.viewCheckpoints,
    providerUsage: snapshot.providerUsage,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

function parseConstraint(value: string | null): ScenarioConstraint | null {
  if (value === null) return null;
  const parts = value.split(":");
  if (parts[0] === "brick" && parts.length === 2 && parts[1] !== "") {
    return { kind: "brick", brick: parts[1]! };
  }
  if (parts[0] === "pattern" && parts.length === 2 && parts[1] !== "") {
    return { kind: "pattern", name: parts[1]! };
  }
  if (parts[0] === "preset" && parts.length === 3 && parts[1] !== "" && parts[2] !== "") {
    return { kind: "preset", brick: parts[1]!, name: parts[2]! };
  }
  throw new LabApiValidationError("invalid-constraint", "Run constraint is invalid.");
}

function constraintExists(constraint: ScenarioConstraint | null, assets: AssetSnapshot): boolean {
  if (constraint === null) return true;
  if (constraint.kind === "brick") {
    return (BRICK_TYPES as readonly string[]).includes(constraint.brick);
  }
  if (constraint.kind === "pattern") {
    return assets.patterns.some(({ name }) => name === constraint.name);
  }
  if (!(BRICK_TYPES as readonly string[]).includes(constraint.brick)) return false;
  return assets.theme.presets?.[constraint.brick as BrickType]?.[constraint.name] !== undefined;
}

function nodeStylePreset(node: FacetNode): string | undefined {
  const style = node.style;
  return style === undefined || typeof style.preset !== "string" ? undefined : style.preset;
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticData(evidence: RunEvidenceV1): readonly Readonly<Record<string, unknown>>[] {
  return evidence.records.flatMap(({ kind, data }) =>
    kind === "diagnostic" && isJsonRecord(data) ? [data] : [],
  );
}

function diagnosticEntries(evidence: RunEvidenceV1): readonly {
  readonly turnId: string | null;
  readonly data: Readonly<Record<string, unknown>>;
}[] {
  return evidence.records.flatMap(({ kind, turnId, data }) =>
    kind === "diagnostic" && isJsonRecord(data) ? [{ turnId, data }] : [],
  );
}

function diagnosticCallKey(turnId: string | null, callId: string): string {
  return `${turnId ?? "<none>"}\u0000${callId}`;
}

function successfulReadCallKeys(
  evidence: RunEvidenceV1,
  toolNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const successful = new Set<string>();
  for (const { turnId, data } of diagnosticEntries(evidence)) {
    if (data["kind"] !== "tool-result" || typeof data["callId"] !== "string") continue;
    const rawObservation = data["observation"];
    let observation: Readonly<Record<string, unknown>> | undefined;
    if (isJsonRecord(rawObservation)) {
      observation = rawObservation;
    } else if (typeof rawObservation === "string") {
      try {
        const parsed: unknown = JSON.parse(rawObservation);
        if (isJsonRecord(parsed)) observation = parsed;
      } catch {
        observation = undefined;
      }
    }
    if (
      observation !== undefined &&
      observation["status"] === "ok" &&
      typeof observation["tool"] === "string" &&
      toolNames.has(observation["tool"])
    ) {
      successful.add(diagnosticCallKey(turnId, data["callId"]));
    }
  }
  return successful;
}

export function usedInventory(evidence: RunEvidenceV1): ContractAssetInventory {
  const tree = evidence.finalTree;
  if (tree === null) return { bricks: [], presets: [], patterns: [] };
  const bricks = new Set<string>();
  const presets = new Set<string>();
  for (const node of Object.values(tree.nodes)) {
    bricks.add(node.type);
    const preset = nodeStylePreset(node);
    if (preset !== undefined) presets.add(`${node.type}:${preset}`);
  }
  const patterns = new Set<string>();
  const successfulPatternReads = successfulReadCallKeys(evidence, new Set(["get_pattern"]));
  for (const { turnId, data } of diagnosticEntries(evidence)) {
    if (
      data["kind"] !== "tool-call" ||
      data["name"] !== "get_pattern" ||
      typeof data["callId"] !== "string" ||
      !successfulPatternReads.has(diagnosticCallKey(turnId, data["callId"]))
    ) {
      continue;
    }
    const input = data["input"];
    if (isJsonRecord(input) && typeof input["name"] === "string") patterns.add(input["name"]);
  }
  return {
    bricks: [...bricks],
    presets: [...presets].map((value) => {
      const separator = value.indexOf(":");
      return { brick: value.slice(0, separator), name: value.slice(separator + 1) };
    }),
    patterns: [...patterns],
  };
}

function availableInventory(
  assets: Pick<AssetSnapshot, "theme" | "patterns">,
): ContractAssetInventory {
  const catalog = createCatalogModel({
    ...PACKAGE_CATALOG_SOURCE,
    theme: assets.theme,
    patterns: assets.patterns,
  });
  return {
    bricks:
      catalog.categories.find(({ id }) => id === "bricks")?.items.map(({ name }) => name) ?? [],
    presets:
      catalog.categories
        .find(({ id }) => id === "presets")
        ?.items.flatMap((item) =>
          item.kind === "preset" ? [{ brick: item.brick, name: item.name }] : [],
        ) ?? [],
    patterns:
      catalog.categories.find(({ id }) => id === "patterns")?.items.map(({ name }) => name) ?? [],
  };
}

function observedActionNames(evidence: RunEvidenceV1): readonly string[] {
  const names = new Set<string>();
  for (const record of evidence.records) {
    if (record.kind !== "ui-in" || !isJsonRecord(record.data)) continue;
    const event = record.data["event"];
    if (!isJsonRecord(event) || event["kind"] !== "tap") continue;
    const action = event["action"];
    if (isJsonRecord(action) && typeof action["name"] === "string") names.add(action["name"]);
  }
  return [...names];
}

function traceFacts(evidence: RunEvidenceV1): {
  readonly prompt: boolean;
  readonly assetReads: boolean;
  readonly toolCalls: boolean;
  readonly validation: boolean;
  readonly stageVersions: boolean;
} {
  const diagnostics = diagnosticData(evidence);
  const toolCalls = diagnostics.filter(({ kind }) => kind === "tool-call");
  const assetToolNames = new Set([
    "get_pattern",
    "get_preset",
    "get_brick_spec",
    "get_style_choices",
  ]);
  const successfulAssetReads = successfulReadCallKeys(evidence, assetToolNames);
  let priorVersion = 0;
  const stageVersions = evidence.frames.every((frame) => {
    const valid = frame.stageVersion >= priorVersion;
    priorVersion = frame.stageVersion;
    return valid;
  });
  return {
    prompt: evidence.run.prompt.length > 0,
    assetReads: diagnosticEntries(evidence).some(
      ({ turnId, data: { kind, name, callId } }) =>
        kind === "tool-call" &&
        typeof name === "string" &&
        assetToolNames.has(name) &&
        typeof callId === "string" &&
        successfulAssetReads.has(diagnosticCallKey(turnId, callId)),
    ),
    toolCalls: toolCalls.length > 0,
    validation: evidence.frames.length > 0,
    stageVersions,
  };
}

async function evidenceArtifacts(
  store: EvidenceStore,
  evidence: RunEvidenceV1,
): Promise<readonly EvidenceArtifact[]> {
  const artifacts = await Promise.all(
    evidence.artifacts.map(({ id }) => store.getArtifact(evidence.run.runId, id)),
  );
  return artifacts.flatMap((artifact) => (artifact === undefined ? [] : [artifact]));
}

interface BackendOptions {
  readonly coordinator: RunCoordinator;
  readonly store: EvidenceStore;
  readonly providerRegistry: ProviderRegistry;
  readonly visitors: LabVisitorRegistry;
  readonly activeByVisitor: Map<string, CoordinatedGeneration>;
  readonly liveRuns: Map<string, LiveRunMetadata>;
  readonly getAssets: () => AssetSnapshot;
  readonly screenshotDriver?: ScreenshotDriver;
  readonly dataDirectoryLabel: string;
  readonly now: () => string;
  readonly getPublicBaseUrl: () => string;
}

function createLabBackend(options: BackendOptions): LabApiBackend {
  const runMutationTails = new Map<string, Promise<void>>();
  const cancelTombstones = new Map<string, SettleCoordinatedRunResult>();
  const rememberCancelTombstone = (runId: string, result: SettleCoordinatedRunResult): void => {
    cancelTombstones.delete(runId);
    cancelTombstones.set(runId, result);
    while (cancelTombstones.size > MAX_ACTIVE_RUNS) {
      const oldest = cancelTombstones.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cancelTombstones.delete(oldest);
    }
  };
  const mutateRun = <T>(runId: string, task: () => Promise<T>): Promise<T> => {
    const prior = runMutationTails.get(runId) ?? Promise.resolve();
    const result = prior.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    runMutationTails.set(runId, tail);
    void tail.finally(() => {
      if (runMutationTails.get(runId) === tail) runMutationTails.delete(runId);
    });
    return result;
  };
  const getRun = async (runId: string): Promise<RunEvidenceV1 | undefined> => {
    const stored = await options.store.get(runId);
    if (stored !== undefined) return stored;
    const metadata = options.liveRuns.get(runId);
    const snapshot = options.coordinator.snapshot(runId);
    return metadata === undefined || snapshot === undefined
      ? undefined
      : toLiveEvidence(metadata, snapshot);
  };

  const screenshotService = createScreenshotService({
    ...(options.screenshotDriver === undefined ? {} : { driver: options.screenshotDriver }),
    store: options.store,
    replayUrlForRun: (runId) => `${options.getPublicBaseUrl()}/replay/${runId}`,
  });

  return {
    getCatalog() {
      const assets = options.getAssets();
      return {
        ...createCatalogModel({
          ...PACKAGE_CATALOG_SOURCE,
          theme: assets.theme,
          patterns: assets.patterns,
        }),
        assetDigest: assets.digest,
      };
    },
    getCapabilities() {
      return {
        ...options.providerRegistry.capabilities,
        bounds: { maxHistory: 100, screenshotConditions: 6 },
        dataDirectory: options.dataDirectoryLabel,
        retention: DEFAULT_RETAINED_RUNS,
      };
    },
    getAssets() {
      const assets = options.getAssets();
      return {
        source: assets.source,
        digest: assets.digest,
        theme: assets.theme,
        patterns: assets.patterns,
      };
    },
    createRun(configuration) {
      if (options.activeByVisitor.size >= MAX_ACTIVE_RUNS) {
        throw new LabApiValidationError(
          "active-run-limit",
          "Cancel an active run before starting another one.",
        );
      }
      const scenario = scenarioForRun(configuration.scenarioId);
      if (scenario === undefined) {
        throw new LabApiValidationError("unknown-scenario", "Run scenario is unknown.");
      }
      if (configuration.mode === "provider") {
        const capability = options.providerRegistry.capabilities.providers[configuration.provider];
        if (!capability.available || !capability.models.includes(configuration.model)) {
          throw new LabApiValidationError("provider-unavailable", "Run provider is unavailable.");
        }
      } else {
        const deterministic = options.providerRegistry.capabilities.deterministic;
        if (
          configuration.provider !== deterministic.provider ||
          configuration.model !== deterministic.defaultModel
        ) {
          throw new LabApiValidationError(
            "deterministic-model",
            "Deterministic runs must use the deterministic fixture model.",
          );
        }
      }
      const assets = options.getAssets();
      const constraint = parseConstraint(configuration.constraint);
      if (!constraintExists(constraint, assets)) {
        throw new LabApiValidationError(
          "unknown-constraint",
          "Run constraint is not defined by the frozen asset selection.",
        );
      }
      const createdAt = options.now();
      const created = options.coordinator.create({
        assets,
        configuration,
        constraint,
        scenario,
        sink: new MemorySink(),
        providerRegistry: options.providerRegistry,
        onLifecycle(event) {
          if (event.phase === "sealed") {
            options.visitors.unregister(event.identity.visitorId);
            options.activeByVisitor.delete(event.identity.visitorId);
            return;
          }
          options.liveRuns.delete(event.identity.runId);
          options.coordinator.forget(event.identity.runId);
          if (event.status === "cancelled" || event.status === "incomplete") {
            rememberCancelTombstone(event.identity.runId, {
              ok: true,
              changed: false,
              generation: event.identity.generation,
            });
          }
        },
      });
      const started = options.coordinator.start(created.runId);
      if (!started.ok) throw new Error("Facet Lab could not start the run");
      const { identity } = started.generation;
      options.liveRuns.set(identity.runId, {
        configuration,
        assets: started.generation.assets,
        createdAt,
        startedAt: options.now(),
      });
      options.activeByVisitor.set(identity.visitorId, started.generation);
      options.visitors.register(identity.visitorId);
      return {
        ...identity,
        status: "queued",
        streamUrl: `/stream?visitorId=${encodeURIComponent(identity.visitorId)}`,
        evidenceUrl: `/api/runs/${identity.runId}/evidence`,
      };
    },
    async listRuns(filters: LabRunListFilters) {
      const byId = new Map<string, RunEvidenceV1>();
      for (const run of await options.store.list()) byId.set(run.run.runId, run);
      for (const [runId, metadata] of options.liveRuns) {
        const snapshot = options.coordinator.snapshot(runId);
        if (snapshot !== undefined) byId.set(runId, toLiveEvidence(metadata, snapshot));
      }
      const candidates = [...byId.values()]
        .filter(
          ({ run }) =>
            (filters.status === undefined || run.status === filters.status) &&
            (filters.provider === undefined || run.provider === filters.provider) &&
            (filters.mode === undefined || run.mode === filters.mode),
        )
        .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
        .slice(0, filters.limit);
      const bounded: RunEvidenceV1[] = [];
      for (const candidate of candidates) {
        const next = [...bounded, candidate];
        if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_EVIDENCE_BUNDLE_BYTES) {
          break;
        }
        bounded.push(candidate);
      }
      return bounded;
    },
    getRun,
    async cancelRun(runId) {
      return mutateRun(runId, async () => {
        const prior = cancelTombstones.get(runId);
        if (prior !== undefined) return prior;
        const stored = await options.store.get(runId);
        if (stored?.run.status === "cancelled" || stored?.run.status === "incomplete") {
          return {
            ok: true,
            changed: false,
            generation: stored.run.generation,
          };
        }
        const result = await options.coordinator.cancel(runId);
        const snapshot = options.coordinator.snapshot(runId);
        if (result.ok && snapshot !== undefined) {
          options.visitors.unregister(snapshot.identity.visitorId);
          options.activeByVisitor.delete(snapshot.identity.visitorId);
          options.liveRuns.delete(runId);
          options.coordinator.forget(runId);
        }
        if (result.ok) {
          rememberCancelTombstone(runId, { ...result, changed: false });
        }
        return result;
      });
    },
    async exportRun(runId) {
      const stored = await options.store.exportBundle(runId);
      if (stored !== undefined) return stored;
      const evidence = await getRun(runId);
      if (evidence === undefined) return undefined;
      const exported = exportEvidenceBundle(evidence, []);
      return exported.ok ? exported.json : undefined;
    },
    async importRun(bundle) {
      const result = await options.store.importBundle(bundle);
      if (!result.accepted) {
        throw new LabApiValidationError("invalid-evidence-bundle", "Evidence bundle is invalid.");
      }
      return {
        runId: result.evidence.run.runId,
        importedFromRunId: result.evidence.run.importedFromRunId,
      };
    },
    async evaluateRun(runId, request) {
      return mutateRun(runId, async () => {
        const evidence = await getRun(runId);
        if (evidence === undefined) return { accepted: false, reason: "run-not-found" };
        if (evidence.run.status === "queued" || evidence.run.status === "running") {
          return { accepted: false, reason: "run-active" };
        }
        const artifacts = await evidenceArtifacts(options.store, evidence);
        if (typeof request !== "object" || request === null || !("kind" in request)) {
          return { accepted: false, reason: "invalid-evaluation" };
        }
        let updated: RunEvidenceV1;
        if (request.kind === "advisory" && "record" in request) {
          const appended = appendVisualEvaluation(evidence.visualEvaluations, request.record);
          if (!appended.ok) return { accepted: false, error: appended.error };
          updated = { ...evidence, visualEvaluations: appended.history };
        } else if (request.kind === "recalculate") {
          const scenario = OFFICIAL_SCENARIOS.find(({ id }) => id === evidence.run.scenarioId);
          if (scenario === undefined) return { accepted: false, reason: "unknown-scenario" };
          const result = evaluateContract({
            scenario,
            theme: evidence.assets.theme,
            finalTree: evidence.finalTree,
            availableAssets: availableInventory(evidence.assets),
            usedAssets: usedInventory(evidence),
            observedActionNames: observedActionNames(evidence),
            stageMutations: Math.max(0, ...evidence.frames.map(({ stageVersion }) => stageVersion)),
            constraint: parseConstraint(evidence.run.constraint),
            trace: traceFacts(evidence),
            view: { viewport: evidence.run.viewport, colorMode: evidence.run.colorMode },
          });
          updated = { ...evidence, checks: result.checks };
        } else {
          return { accepted: false, reason: "invalid-evaluation" };
        }
        const saved = await options.store.save(updated, artifacts);
        return saved.accepted
          ? {
              accepted: true,
              checks: saved.evidence.checks,
              visualEvaluations: saved.evidence.visualEvaluations,
            }
          : { accepted: false, error: saved.error };
      });
    },
    async captureRun(runId) {
      return mutateRun(runId, async () => {
        const evidence = await getRun(runId);
        if (evidence === undefined) return { accepted: false, reason: "run-not-found" };
        if (evidence.run.status === "queued" || evidence.run.status === "running") {
          return { accepted: false, reason: "run-active" };
        }
        const artifacts = await evidenceArtifacts(options.store, evidence);
        return screenshotService.capture({
          evidence,
          existingArtifacts: artifacts,
          evaluationId: `capture-${randomUUID()}`,
          stageVersion: evidence.frames.at(-1)?.stageVersion ?? null,
          ordinal:
            Math.max(
              -1,
              ...evidence.records.map(({ ordinal }) => ordinal),
              ...evidence.frames.map(({ ordinal }) => ordinal),
            ) + 1,
        });
      });
    },
    async getArtifact(runId, artifactId): Promise<LabApiArtifact | undefined> {
      const evidence = await getRun(runId);
      const manifest = evidence?.artifacts.find(({ id }) => id === artifactId);
      if (manifest === undefined) return undefined;
      const artifact = await options.store.getArtifact(runId, artifactId);
      return artifact === undefined
        ? undefined
        : {
            mediaType: manifest.mediaType,
            data: artifact.data,
            downloadName: `${artifactId}.${manifest.mediaType === "image/png" ? "png" : manifest.mediaType === "application/json" ? "json" : "txt"}`,
          };
    },
    readEvidence: getRun,
  };
}

function scenarioForRun(scenarioId: string): OfficialScenario | undefined {
  const official = OFFICIAL_SCENARIOS.find(({ id }) => id === scenarioId);
  if (official !== undefined) return official;
  if (scenarioId !== FREE_FORM_SCENARIO.id) return undefined;
  const deterministicFixture = OFFICIAL_SCENARIOS[0];
  if (deterministicFixture === undefined) return undefined;
  return {
    ...deterministicFixture,
    id: FREE_FORM_SCENARIO.id,
    name: FREE_FORM_SCENARIO.name,
    prompt: "Author the operator's free-form prompt using validated Facet assets.",
    expectedAssets: { bricks: [], presets: [], patterns: [] },
    expectedOutcomes: { actionNames: [], stageMutations: 1 },
  };
}

/** Starts one same-origin loopback Lab: static UI, API, live Facet transport, and evidence. */
export async function startFacetLab(options: StartFacetLabOptions = {}): Promise<RunningFacetLab> {
  const environment = options.environment ?? process.env;
  const port = options.port ?? readPort(environment.FACET_LAB_PORT);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("invalid Lab port");
  const now = options.now ?? (() => new Date().toISOString());
  const dataDirectory = options.dataDirectory ?? resolveFacetLabDataDirectory({ environment });
  const providerCanaries = [environment.OPENAI_API_KEY, environment.ANTHROPIC_API_KEY].flatMap(
    (value) => (value === undefined || value.trim().length === 0 ? [] : [value.trim()]),
  );
  const store = createEvidenceStore({ dataDirectory, canaries: providerCanaries });
  const providerRegistry = createProviderRegistry({ environment });
  const visitors = createLabVisitorRegistry();
  const activeByVisitor = new Map<string, CoordinatedGeneration>();
  const liveRuns = new Map<string, LiveRunMetadata>();
  let screenshotBrowser: Browser | undefined;
  const screenshotDriver: ScreenshotDriver | undefined =
    options.screenshotDriver ??
    (options.enablePlaywrightScreenshots === true
      ? {
          async capture(request) {
            screenshotBrowser ??= await chromium.launch({ headless: true });
            return createPlaywrightScreenshotDriver(screenshotBrowser).capture(request);
          },
        }
      : undefined);
  const defaultAssets = createDefaultAssetSnapshot();
  let publicBaseUrl = "http://127.0.0.1:0";

  const coordinator = createRunCoordinator({
    now,
    canaries: providerCanaries,
    persist: async (evidence) => (await store.save(evidence, [])).accepted,
  });

  const dispatcher: FacetAgent = (event, context) => {
    const generation = activeByVisitor.get(context.visitor.visitorId);
    return generation === undefined
      ? [{ kind: "say", text: "Facet Lab run is not active." }]
      : redactAgentOutput(generation.agent(event, context), providerCanaries);
  };
  const observer = (observation: FacetServerObservation): void => {
    activeByVisitor.get(observation.visitor.visitorId)?.serverObserver(observation);
  };

  const inner = await startLabInnerServer({
    agentId: `facet-lab-dispatcher-${randomUUID()}`,
    agent: dispatcher,
    observer,
  });
  const backend = createLabBackend({
    coordinator,
    store,
    providerRegistry,
    visitors,
    activeByVisitor,
    liveRuns,
    getAssets: () => defaultAssets,
    ...(screenshotDriver === undefined ? {} : { screenshotDriver }),
    dataDirectoryLabel:
      typeof dataDirectory === "string"
        ? "Configured external data directory"
        : dataDirectory.source === "environment"
          ? "Configured external data directory"
          : "Platform application data",
    now,
    getPublicBaseUrl: () => publicBaseUrl,
  });
  const routes = createLabApiRoutes({ backend });
  const host = createLabWebHost({
    innerBaseUrl: inner.baseUrl,
    visitors,
    host: HOST,
    port,
    staticRoot: resolve(options.staticRoot ?? STATIC_ROOT),
    apiMaxBodyBytes: MAX_JSON_REQUEST_BYTES,
    apiImportMaxBodyBytes: MAX_EVIDENCE_BUNDLE_BYTES,
    isKnownApiPath: routes.hasPath,
    apiHandler: createNodeLabApiHandler(routes),
  });

  try {
    const listening = await host.listen();
    publicBaseUrl = listening.baseUrl;
    return Object.freeze({
      url: listening.baseUrl,
      dataDirectory: store.directory,
      async close() {
        await host.close().catch(() => undefined);
        await inner.server.close().catch(() => undefined);
        await screenshotBrowser?.close().catch(() => undefined);
      },
    });
  } catch (error: unknown) {
    await inner.server.close().catch(() => undefined);
    throw error;
  }
}

const entryPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
  void startFacetLab({ enablePlaywrightScreenshots: true })
    .then(({ url, dataDirectory }) => {
      process.stdout.write(`Facet Lab running at ${url}\nEvidence: ${dataDirectory}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown startup failure";
      process.stderr.write(`Facet Lab failed to start: ${message}\n`);
      process.exitCode = 1;
    });
}
