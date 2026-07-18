import { createReferenceAgent } from "@facet/reference-agent";
import type {
  ReferenceAgentDiagnosticObserver,
  ReferenceAgentOptions,
  ReferenceProvider,
} from "@facet/reference-agent";
import type { FacetAgent } from "@facet/core";
import type { Sink } from "@facet/runtime";

import type { OfficialScenario } from "../scenarios/scenarios.js";
import type { RunMode, RunConfiguration } from "../shared/run-contract.js";
import type { AssetSnapshot } from "./asset-snapshot.js";
import {
  DETERMINISTIC_MODEL,
  createDeterministicReferenceAgent,
} from "./deterministic-provider.js";
import type { ProviderRegistry } from "./provider-registry.js";

export type LabAgentConfiguration = Pick<RunConfiguration, "mode" | "provider" | "model">;

export interface CreateLabAgentOptions {
  readonly agentId: string;
  readonly assets: AssetSnapshot;
  readonly configuration: LabAgentConfiguration;
  readonly guide: string;
  readonly scenario: OfficialScenario;
  readonly sink: Sink;
  readonly providerRegistry?: Pick<ProviderRegistry, "createProvider">;
  readonly signal?: AbortSignal;
  readonly budget?: ReferenceAgentOptions["budget"];
  readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
}

export interface LabAgentAssembly {
  readonly agent: FacetAgent;
  readonly provider: ReferenceProvider;
  readonly provenance: LabAgentConfiguration;
  readonly assets: AssetSnapshot;
  readonly mode: RunMode;
}

function referenceAgentOptions(
  options: CreateLabAgentOptions,
  provider: ReferenceProvider,
): ReferenceAgentOptions {
  return {
    provider,
    guide: options.guide,
    sink: options.sink,
    agentId: options.agentId,
    assets: { theme: options.assets.theme, patterns: options.assets.patterns },
    ...(options.signal === undefined ? {} : { abortSignal: options.signal }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.diagnosticObserver === undefined
      ? {}
      : { diagnosticObserver: options.diagnosticObserver }),
  };
}

/** Creates one public reference-agent bound to a run's frozen asset snapshot. */
export function createLabAgent(options: CreateLabAgentOptions): LabAgentAssembly {
  if (!Object.isFrozen(options.assets)) {
    throw new Error("Lab agent assets must be a frozen run snapshot");
  }

  if (options.configuration.mode === "deterministic") {
    if (
      options.configuration.provider !== "openai" ||
      options.configuration.model !== DETERMINISTIC_MODEL
    ) {
      throw new Error("Deterministic runs must use the scripted OpenAI model");
    }
    const deterministic = createDeterministicReferenceAgent({
      agentId: options.agentId,
      sink: options.sink,
      assets: { theme: options.assets.theme, patterns: options.assets.patterns },
      scenario: options.scenario,
      guide: options.guide,
      ...(options.signal === undefined ? {} : { abortSignal: options.signal }),
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      ...(options.diagnosticObserver === undefined
        ? {}
        : { diagnosticObserver: options.diagnosticObserver }),
    });
    return Object.freeze({
      agent: deterministic.agent,
      provider: deterministic.provider,
      provenance: deterministic.provenance,
      assets: options.assets,
      mode: "deterministic" as const,
    });
  }

  if (options.providerRegistry === undefined) {
    throw new Error("Provider runs require a server-side provider registry");
  }
  const provider = options.providerRegistry.createProvider(
    options.configuration.provider,
    options.configuration.model,
  );
  const agent = createReferenceAgent(referenceAgentOptions(options, provider));
  return Object.freeze({
    agent,
    provider,
    provenance: Object.freeze({ ...options.configuration }),
    assets: options.assets,
    mode: "provider" as const,
  });
}
