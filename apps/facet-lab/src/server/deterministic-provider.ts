import { EMPTY_TREE, applyPatch } from "@facet/core";
import type { FacetAgent, FacetTree } from "@facet/core";
import {
  createOpenAiProvider,
  createReferenceAgent,
  type ReferenceAgentAssetSource,
  type ReferenceAgentDiagnosticObserver,
  type ReferenceAgentOptions,
  type ReferenceProvider,
} from "@facet/reference-agent";
import type { Sink } from "@facet/runtime";

import type { OfficialScenario, ScenarioProviderStep } from "../scenarios/scenarios.js";
import type { RunConfiguration } from "../shared/run-contract.js";

export const DETERMINISTIC_MODEL = "facet-lab-deterministic-v1";

const SCRIPTED_PROVIDER_KEY = "facet-lab-scripted-key";

export type DeterministicProvenance = Pick<RunConfiguration, "mode" | "provider" | "model">;

export interface DeterministicReferenceAgentOptions {
  readonly agentId: string;
  readonly sink: Sink;
  readonly assets: ReferenceAgentAssetSource;
  readonly scenario: OfficialScenario;
  readonly guide: string;
  readonly abortSignal?: AbortSignal;
  readonly budget?: ReferenceAgentOptions["budget"];
  readonly diagnosticObserver?: ReferenceAgentDiagnosticObserver;
}

export interface DeterministicReferenceAgent {
  readonly agent: FacetAgent;
  readonly provider: ReferenceProvider;
  readonly provenance: DeterministicProvenance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasRenderPageTool(request: Record<string, unknown>): boolean {
  const tools = request.tools;
  if (!Array.isArray(tools)) return false;
  return tools.some((tool) => {
    if (!isRecord(tool) || !isRecord(tool.function)) return false;
    return tool.function.name === "render_page";
  });
}

function openAiTextResponse(text: string): Response {
  return Response.json({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 8, completion_tokens: 2 },
  });
}

function openAiToolResponse(step: ScenarioProviderStep, tree: FacetTree): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: `${step.id}-mutation`,
              type: "function",
              function: {
                name: "render_page",
                arguments: JSON.stringify({ tree }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 4 },
  });
}

function openAiPatternReadResponse(step: ScenarioProviderStep, name: string): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: `${step.id}-pattern`,
              type: "function",
              function: { name: "get_pattern", arguments: JSON.stringify({ name }) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 2 },
  });
}

function nextScenarioTree(current: FacetTree, step: ScenarioProviderStep): FacetTree {
  return step.output.kind === "render"
    ? structuredClone(step.output.tree)
    : applyPatch(current, step.output.patches);
}

function createScenarioFetch(scenario: OfficialScenario): typeof fetch {
  const steps = scenario.fixture.providerSteps;
  let stepIndex = 0;
  let phase: "pattern" | "mutation" | "complete" = "pattern";
  let currentTree: FacetTree = EMPTY_TREE;

  return async (_input, init) => {
    let request: unknown;
    try {
      request = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    } catch {
      request = undefined;
    }
    if (
      !isRecord(request) ||
      request.model !== DETERMINISTIC_MODEL ||
      !hasRenderPageTool(request)
    ) {
      return new Response("invalid deterministic provider request", { status: 400 });
    }

    const step = steps[stepIndex];
    if (step === undefined) return openAiTextResponse("Deterministic scenario is complete.");

    if (phase === "complete") {
      phase = "pattern";
      stepIndex += 1;
      return openAiTextResponse(`Completed deterministic step ${step.id}.`);
    }

    if (phase === "pattern") {
      phase = "mutation";
      return openAiPatternReadResponse(step, scenario.expectedAssets.patterns[0] ?? "hero");
    }

    currentTree = nextScenarioTree(currentTree, step);
    phase = "complete";
    return openAiToolResponse(step, currentTree);
  };
}

/**
 * Uses the real public OpenAI adapter and reference tool loop with a local,
 * network-free fetch script derived from the selected official scenario.
 */
export function createDeterministicReferenceAgent(
  options: DeterministicReferenceAgentOptions,
): DeterministicReferenceAgent {
  const provider = createOpenAiProvider(
    SCRIPTED_PROVIDER_KEY,
    createScenarioFetch(options.scenario),
    {
      model: DETERMINISTIC_MODEL,
    },
  );
  const agent = createReferenceAgent({
    provider,
    guide: options.guide,
    sink: options.sink,
    agentId: options.agentId,
    assets: options.assets,
    ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.diagnosticObserver !== undefined
      ? { diagnosticObserver: options.diagnosticObserver }
      : {}),
  });

  return Object.freeze({
    agent,
    provider,
    provenance: Object.freeze({
      mode: "deterministic",
      provider: "openai",
      model: DETERMINISTIC_MODEL,
    }),
  });
}
