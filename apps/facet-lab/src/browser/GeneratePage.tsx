import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { FacetTheme } from "@facet/core";

import {
  FREE_FORM_SCENARIO,
  OFFICIAL_SCENARIOS,
  type OfficialScenario,
} from "../scenarios/scenarios.js";
import type {
  ColorMode,
  ProviderName,
  RunConfiguration,
  ViewportName,
  RunStatus,
} from "../shared/run-contract.js";
import { createLabApiClient, type BrowserCreatedRun, type LabApiClient } from "./api-client.js";
import {
  createGenerateDraft,
  createRunActivationGate,
  projectGenerateReadiness,
} from "./generate-presenter.js";
import { LiveStage, type LiveStageMessage } from "./LiveStage.js";
import type { LabCapabilities } from "./run-config.js";
import {
  createInitialRunStreamState,
  createRunEvidenceStream,
  type RunStreamState,
} from "./run-stream.js";

export interface GeneratePageProps {
  readonly client?: LabApiClient;
  readonly capabilities?: LabCapabilities;
  readonly scenarios?: readonly OfficialScenario[];
  readonly initialScenarioId?: string;
  readonly initialConstraint?: string | null;
  readonly theme?: FacetTheme;
  readonly onRunStarted?: (run: BrowserCreatedRun) => void;
}

interface ActiveRun {
  readonly run: BrowserCreatedRun;
  readonly configuration: RunConfiguration;
  readonly theme?: FacetTheme;
}

const VIEWPORT_WIDTHS: Readonly<Record<ViewportName, number>> = {
  mobile: 390,
  tablet: 768,
  desktop: 1_200,
};

function scenarioForId(
  scenarioId: string | undefined,
  scenarios: readonly OfficialScenario[],
): OfficialScenario | typeof FREE_FORM_SCENARIO {
  if (scenarioId === FREE_FORM_SCENARIO.id) return FREE_FORM_SCENARIO;
  return scenarios.find(({ id }) => id === scenarioId) ?? scenarios[0] ?? FREE_FORM_SCENARIO;
}

function errorMessage(kind: "load" | "start" | "cancel"): string {
  if (kind === "load") return "Run capabilities could not be loaded.";
  if (kind === "cancel")
    return "The run could not be cancelled. Its last valid stage remains visible.";
  return "The run could not be started. Check the configuration and try again.";
}

export function GeneratePage({
  client: providedClient,
  capabilities: providedCapabilities,
  scenarios = OFFICIAL_SCENARIOS,
  initialScenarioId,
  initialConstraint = null,
  theme,
  onRunStarted,
}: GeneratePageProps = {}): ReactNode {
  const client = useMemo(() => providedClient ?? createLabApiClient(), [providedClient]);
  const gate = useMemo(() => createRunActivationGate(client.createRun), [client]);
  const [capabilities, setCapabilities] = useState<LabCapabilities | null>(
    providedCapabilities ?? null,
  );
  const [draft, setDraft] = useState<RunConfiguration | null>(null);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [lifecycle, setLifecycle] = useState<"idle" | RunStatus>("idle");
  const [trace, setTrace] = useState<RunStreamState>(createInitialRunStreamState);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [message, setMessage] = useState<LiveStageMessage | null>(null);
  const messageSequence = useRef(0);

  useEffect(() => {
    if (providedCapabilities !== undefined) {
      setCapabilities(providedCapabilities);
      return;
    }
    let current = true;
    void client
      .getCapabilities()
      .then((loaded) => {
        if (current) setCapabilities(loaded);
      })
      .catch(() => {
        if (current) setError(errorMessage("load"));
      });
    return () => {
      current = false;
    };
  }, [client, providedCapabilities]);

  useEffect(() => {
    if (capabilities === null) return;
    const scenario = scenarioForId(initialScenarioId, scenarios);
    setDraft((previous) => {
      const next = createGenerateDraft(capabilities, scenario);
      return Object.freeze({
        ...next,
        constraint: initialConstraint,
        viewport: previous?.viewport ?? next.viewport,
        colorMode: previous?.colorMode ?? next.colorMode,
      });
    });
  }, [capabilities, initialConstraint, initialScenarioId, scenarios]);

  useEffect(() => {
    if (active === null) {
      setTrace(createInitialRunStreamState());
      return;
    }
    const stream = createRunEvidenceStream({
      onState: (state) => {
        setTrace(state);
        if (state.terminalStatus !== null) setLifecycle(state.terminalStatus);
      },
    });
    try {
      stream.select(
        { runId: active.run.runId, generation: active.run.generation },
        active.run.evidenceUrl,
      );
    } catch {
      stream.close();
    }
    return () => stream.close();
  }, [active]);

  const readiness = useMemo(
    () =>
      capabilities === null || draft === null
        ? null
        : projectGenerateReadiness(draft, capabilities, scenarios),
    [capabilities, draft, scenarios],
  );

  if (capabilities === null || draft === null) {
    return (
      <section className="lab-page lab-generate-page" aria-labelledby="generate-title">
        <header className="lab-page-header">
          <h1 id="generate-title">Generate</h1>
          <p>Configure a real-provider run and inspect the resulting live Facet stage.</p>
        </header>
        {error === null ? (
          <p role="status">Loading run capabilities…</p>
        ) : (
          <p role="alert">{error}</p>
        )}
      </section>
    );
  }

  const update = <Key extends keyof RunConfiguration>(
    key: Key,
    value: RunConfiguration[Key],
  ): void => setDraft((current) => (current === null ? current : { ...current, [key]: value }));

  const handleProvider = (event: ChangeEvent<HTMLSelectElement>): void => {
    const provider = event.target.value as ProviderName;
    const capability = capabilities.providers[provider];
    setDraft((current) =>
      current === null ? current : { ...current, provider, model: capability.defaultModel },
    );
  };
  const handleScenario = (event: ChangeEvent<HTMLSelectElement>): void => {
    const scenario = scenarioForId(event.target.value, scenarios);
    setDraft((current) =>
      current === null
        ? current
        : { ...current, scenarioId: scenario.id, prompt: scenario.prompt, constraint: null },
    );
  };

  const start = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (readiness === null || !readiness.ready || readiness.configuration === null) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const result = await gate.start(readiness.configuration);
      if (!result.ok) {
        if (result.reason === "duplicate-run-identity") setError(errorMessage("start"));
        return;
      }
      setActive({
        run: result.run,
        configuration: readiness.configuration,
        ...(theme === undefined ? {} : { theme: structuredClone(theme) }),
      });
      setLifecycle("running");
      setMessage(null);
      setFollowUp("");
      onRunStarted?.(result.run);
    } catch {
      setError(errorMessage("start"));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (active === null || lifecycle !== "running") return;
    setError(null);
    try {
      await client.cancelRun(active.run.runId);
      setLifecycle("cancelled");
    } catch {
      setError(errorMessage("cancel"));
    }
  };

  const sendFollowUp = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = followUp.trim();
    if (active === null || lifecycle !== "running" || text.length === 0 || text.length > 20_000) {
      return;
    }
    messageSequence.current += 1;
    setMessage({ id: `${active.run.runId}:${String(messageSequence.current)}`, text });
    setFollowUp("");
  };

  const providerCapability = capabilities.providers[draft.provider];
  const modelOptions = providerCapability.models;

  return (
    <section className="lab-page lab-generate-page" aria-labelledby="generate-title">
      <header className="lab-page-header">
        <h1 id="generate-title">Generate</h1>
        <p>Configure a real-provider run and inspect the resulting live Facet stage.</p>
      </header>
      <form onSubmit={(event) => void start(event)} aria-describedby="run-readiness">
        <fieldset disabled={starting}>
          <legend>Run configuration</legend>

          <label htmlFor="generate-scenario">Scenario</label>
          <select id="generate-scenario" value={draft.scenarioId} onChange={handleScenario}>
            <option value={FREE_FORM_SCENARIO.id}>{FREE_FORM_SCENARIO.name}</option>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>

          <label htmlFor="generate-prompt">Prompt</label>
          <textarea
            id="generate-prompt"
            value={draft.prompt}
            maxLength={20_000}
            required
            onChange={(event) => update("prompt", event.target.value)}
          />

          <label htmlFor="generate-provider">Provider</label>
          <select id="generate-provider" value={draft.provider} onChange={handleProvider}>
            {(["openai", "anthropic"] as const).map((provider) => {
              const capability = capabilities.providers[provider];
              return (
                <option key={provider} value={provider} disabled={!capability.available}>
                  {provider} {capability.available ? "" : "(not configured)"}
                </option>
              );
            })}
          </select>
          {!providerCapability.available ? (
            <p role="status">
              This provider is unavailable because it is not configured on the Lab server.
            </p>
          ) : null}

          <label htmlFor="generate-model">Model</label>
          <select
            id="generate-model"
            value={draft.model}
            onChange={(event) => update("model", event.target.value)}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          <label htmlFor="generate-asset-mode">Asset selection</label>
          <select
            id="generate-asset-mode"
            value={draft.constraint === null ? "autonomous" : "constrained"}
            onChange={(event) =>
              update("constraint", event.target.value === "autonomous" ? null : "brick:text")
            }
          >
            <option value="autonomous">Agent autonomous</option>
            <option value="constrained">Explicit constraint</option>
          </select>
          {draft.constraint === null ? null : (
            <>
              <label htmlFor="generate-constraint">Brick, Preset, or Pattern constraint</label>
              <input
                id="generate-constraint"
                value={draft.constraint}
                maxLength={1_000}
                placeholder="brick:chart"
                onChange={(event) => update("constraint", event.target.value)}
              />
            </>
          )}

          <label htmlFor="generate-viewport">Viewport</label>
          <select
            id="generate-viewport"
            value={draft.viewport}
            onChange={(event) => update("viewport", event.target.value as ViewportName)}
          >
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="desktop">Desktop</option>
          </select>

          <label htmlFor="generate-color-mode">Color mode</label>
          <select
            id="generate-color-mode"
            value={draft.colorMode}
            onChange={(event) => update("colorMode", event.target.value as ColorMode)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </fieldset>

        <div id="run-readiness" aria-live="polite">
          {readiness?.ready ? (
            <p>Ready to start a distinct run.</p>
          ) : (
            <ul>
              {readiness?.issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.field}:${String(index)}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
        {error === null ? null : <p role="alert">{error}</p>}
        <button type="submit" disabled={starting || !readiness?.ready}>
          {starting ? "Starting…" : "Start new run"}
        </button>
      </form>

      {active === null ? null : (
        <section className="lab-page-section lab-live-run" aria-labelledby="live-run-title">
          <h2 id="live-run-title">Live run</h2>
          <p role="status">
            Run {active.run.runId}: {lifecycle}
          </p>
          <p role="status">
            Evidence trace: {trace.connection} · {String(trace.items.length)} correlated items
          </p>
          <button
            className="lab-button-danger"
            type="button"
            disabled={lifecycle !== "running"}
            onClick={() => void cancel()}
          >
            Cancel run
          </button>
          <div
            className="lab-live-stage-shell"
            data-viewport={active.configuration.viewport}
            style={{ maxWidth: VIEWPORT_WIDTHS[active.configuration.viewport], width: "100%" }}
          >
            <LiveStage
              run={active.run}
              colorMode={active.configuration.colorMode}
              {...(active.theme === undefined ? {} : { theme: active.theme })}
              message={message}
            />
          </div>
          <form onSubmit={sendFollowUp}>
            <label htmlFor="generate-follow-up">Follow-up message</label>
            <textarea
              id="generate-follow-up"
              value={followUp}
              maxLength={20_000}
              disabled={lifecycle !== "running"}
              onChange={(event) => setFollowUp(event.target.value)}
            />
            <button
              type="submit"
              disabled={lifecycle !== "running" || followUp.trim().length === 0}
            >
              Send follow-up through UI-IN
            </button>
          </form>
        </section>
      )}
    </section>
  );
}
