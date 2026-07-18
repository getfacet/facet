import { useState } from "react";
import type { ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import {
  COLOR_MODES,
  VIEWPORTS,
  type ColorMode,
  type RunEvidenceV1,
  type ViewportName,
} from "../shared/run-contract.js";
import { presentReplay } from "./replay-presenter.js";

export interface ReplayPageProps {
  readonly evidence?: RunEvidenceV1 | null;
}

function captureOverride(): {
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
} | null {
  if (typeof window === "undefined") return null;
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("capture") !== "1" || parameters.size !== 3) return null;
  const viewport = parameters.get("viewport");
  const colorMode = parameters.get("colorMode");
  const validViewport = VIEWPORTS.find((value) => value === viewport);
  const validColorMode = COLOR_MODES.find((value) => value === colorMode);
  return validViewport !== undefined && validColorMode !== undefined
    ? { viewport: validViewport, colorMode: validColorMode }
    : null;
}

function ReplaySession({ evidence }: ReplayPageProps): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(undefined);
  const presentation = presentReplay(evidence, selectedIndex);
  const selected = presentation.selected;
  const override = captureOverride();

  return (
    <main
      aria-labelledby="replay-page-title"
      {...(presentation.runId === null ? {} : { "data-replay-run-id": presentation.runId })}
    >
      <header>
        <h1 id="replay-page-title">Provider-free replay</h1>
        <p>
          Scrub immutable accepted stages and recorded browser views without starting a provider.
        </p>
      </header>
      <p role={presentation.state === "error" ? "alert" : "status"} aria-live="polite">
        {presentation.statusMessage}
      </p>

      {presentation.state !== "ready" || selected === null ? null : (
        <>
          <section aria-labelledby="replay-timeline-title">
            <h2 id="replay-timeline-title">Accepted timeline</h2>
            <label htmlFor="replay-scrubber">Replay checkpoint</label>
            <input
              id="replay-scrubber"
              className="facet-lab-focusable"
              type="range"
              min={0}
              max={Math.max(0, presentation.steps.length - 1)}
              step={1}
              value={selected.index}
              onChange={(event) => setSelectedIndex(Number(event.currentTarget.value))}
            />
            <output htmlFor="replay-scrubber">{selected.label}</output>
            <div role="group" aria-label="Replay navigation">
              <button
                className="facet-lab-focusable"
                type="button"
                disabled={selected.index === 0}
                onClick={() => setSelectedIndex(selected.index - 1)}
              >
                Previous checkpoint
              </button>
              <button
                className="facet-lab-focusable"
                type="button"
                disabled={selected.index >= presentation.steps.length - 1}
                onClick={() => setSelectedIndex(selected.index + 1)}
              >
                Next checkpoint
              </button>
            </div>
            <ol>
              {presentation.steps.map((step) => (
                <li key={step.rendererKey}>
                  <button
                    className="facet-lab-focusable"
                    type="button"
                    aria-current={step.index === selected.index ? "step" : undefined}
                    onClick={() => setSelectedIndex(step.index)}
                  >
                    {step.label} · {step.disposition}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="replay-stage-title">
            <h2 id="replay-stage-title">Recorded stage</h2>
            <dl>
              <dt>Stage version</dt>
              <dd>{selected.stageVersion}</dd>
              <dt>Evidence ordinal</dt>
              <dd>{selected.ordinal ?? "initial"}</dd>
              <dt>Viewport</dt>
              <dd>{override?.viewport ?? selected.viewport}</dd>
              <dt>Color mode</dt>
              <dd>{override?.colorMode ?? selected.colorMode}</dd>
              <dt>View checkpoint</dt>
              <dd>{selected.viewOrdinal ?? "not recorded"}</dd>
              <dt>Digest verified</dt>
              <dd>{selected.digestMatchesEvidence ? "yes" : "no"}</dd>
            </dl>
            <div
              data-replay-viewport={override?.viewport ?? selected.viewport}
              data-replay-color-mode={override?.colorMode ?? selected.colorMode}
              aria-label={`Replay stage at checkpoint ${String(selected.index)}`}
            >
              <StageRenderer
                key={selected.rendererKey}
                tree={selected.tree}
                colorMode={override?.colorMode ?? selected.colorMode}
                {...(evidence?.assets.theme === undefined ? {} : { theme: evidence.assets.theme })}
                {...(selected.initialView === null ? {} : { initialView: selected.initialView })}
              />
            </div>
            {selected.says.length === 0 ? (
              <p>No agent messages were recorded at this checkpoint.</p>
            ) : (
              <ul aria-label="Recorded agent messages">
                {selected.says.map((message, index) => (
                  <li key={`${String(index)}:${message}`}>{message}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="replay-diagnostics-title">
            <h2 id="replay-diagnostics-title">Replay diagnostics</h2>
            {presentation.issues.length === 0 ? (
              <p>No replay integrity issues detected.</p>
            ) : (
              <ul role="alert">
                {presentation.issues.map((issue, index) => (
                  <li key={`${issue.code}:${String(issue.ordinal)}:${String(index)}`}>
                    <strong>{issue.code}</strong>: {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <p>
              Final tree match:{" "}
              {presentation.finalTreeMatchesEvidence === null
                ? "not recorded"
                : presentation.finalTreeMatchesEvidence
                  ? "verified"
                  : "mismatch"}
            </p>
          </section>
        </>
      )}
    </main>
  );
}

/** A run identity change remounts the scrubber and prevents cross-run view-state reuse. */
export function ReplayPage(props: ReplayPageProps): ReactNode {
  const key = props.evidence?.run.runId ?? (props.evidence === null ? "empty" : "loading");
  return <ReplaySession key={key} {...props} />;
}
