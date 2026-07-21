import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import {
  REFERENCE_BENCHMARK_AUTHORING_PROTOCOL,
  REFERENCE_BENCHMARKS,
  type ReferenceBenchmark,
} from "../scenarios/reference-benchmarks.js";
import {
  COLOR_MODES,
  VIEWPORTS,
  type ColorMode,
  type ViewportName,
} from "../shared/run-contract.js";
import {
  defaultReferenceBenchmarkSelection,
  presentReferenceBenchmarks,
  type PresentedReferenceBenchmarkRender,
} from "./reference-benchmark-presenter.js";

type StageTheme = ComponentProps<typeof StageRenderer>["theme"];

export interface ReferenceBenchmarksPanelProps {
  readonly benchmarks?: readonly ReferenceBenchmark[];
  readonly theme?: StageTheme;
  readonly initialBenchmarkId?: string;
  readonly initialViewport?: ViewportName;
  readonly initialColorMode?: ColorMode;
  readonly onViewChange?: (view: {
    readonly benchmarkId: string;
    readonly viewport: ViewportName;
    readonly colorMode: ColorMode;
  }) => void;
}

const VIEWPORT_WIDTHS: Readonly<Record<ViewportName, number>> = {
  mobile: 390,
  tablet: 768,
  desktop: 1_600,
};

function AssetList({
  label,
  values,
}: {
  readonly label: string;
  readonly values: readonly string[];
}): ReactNode {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{values.join(", ") || "None"}</dd>
    </div>
  );
}

function RenderBenchmark({
  benchmark,
  viewport,
  colorMode,
  onViewChange,
}: {
  readonly benchmark: PresentedReferenceBenchmarkRender;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly onViewChange: (viewport: ViewportName, colorMode: ColorMode) => void;
}): ReactNode {
  return (
    <article className="lab-reference-benchmark-detail" data-reference-benchmark={benchmark.id}>
      <header>
        <p className="catalog-section-label">Static target preview</p>
        <h3>{benchmark.name}</h3>
        <p>{benchmark.goal}</p>
      </header>

      <dl className="lab-reference-benchmark-assets">
        <AssetList label="Service type" values={[benchmark.serviceType]} />
        <AssetList label="Asset theme" values={[benchmark.assetThemeName]} />
        <AssetList label="Asset source" values={[benchmark.assetSource]} />
        <AssetList label="Density" values={[benchmark.assetDensity ?? "fallback"]} />
        <AssetList label="Bricks" values={benchmark.bricks} />
        <AssetList label="Presets" values={benchmark.presets} />
        <AssetList label="Patterns" values={benchmark.patterns} />
      </dl>

      <section aria-labelledby={`${benchmark.id}-sources`}>
        <h4 id={`${benchmark.id}-sources`}>Reference sources</h4>
        <ul>
          {benchmark.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url}>{source.label}</a>
              <span> — {source.useFor}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${benchmark.id}-protocol`}>
        <h4 id={`${benchmark.id}-protocol`}>Authoring protocol</h4>
        <ol>
          {REFERENCE_BENCHMARK_AUTHORING_PROTOCOL.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={`${benchmark.id}-notes`}>
        <h4 id={`${benchmark.id}-notes`}>Target notes</h4>
        <ul>
          {benchmark.assetNotes.map((note) => (
            <li key={`asset:${note}`}>{note}</li>
          ))}
          {benchmark.targetNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${benchmark.id}-gaps`}>
        <h4 id={`${benchmark.id}-gaps`}>Known fidelity gaps</h4>
        <ul>
          {benchmark.gaps.map((gap) => (
            <li key={`${gap.category}:${gap.summary}`}>
              <strong>{gap.category}</strong> · {gap.severity}: {gap.summary}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="lab-reference-benchmark-preview"
        aria-label={`${benchmark.name} benchmark preview`}
        data-reference-preview-viewport={viewport}
        data-reference-preview-color-mode={colorMode}
      >
        <header>
          <div>
            <p className="catalog-section-label">Facet output target</p>
            <h4>
              {benchmark.assetSource === "custom"
                ? "Rendered with benchmark-specific custom assets"
                : "Rendered with current Bricks and fallback assets"}
            </h4>
          </div>
          <fieldset className="catalog-preview-controls">
            <legend>Preview appearance</legend>
            <label htmlFor="reference-benchmark-viewport">
              Width
              <select
                id="reference-benchmark-viewport"
                value={viewport}
                onChange={(event) =>
                  onViewChange(event.currentTarget.value as ViewportName, colorMode)
                }
              >
                {VIEWPORTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="reference-benchmark-color">
              Color
              <select
                id="reference-benchmark-color"
                value={colorMode}
                onChange={(event) => onViewChange(viewport, event.currentTarget.value as ColorMode)}
              >
                {COLOR_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </header>
        <div className="catalog-preview-frame">
          <div
            className="catalog-preview-canvas"
            style={{ maxWidth: VIEWPORT_WIDTHS[viewport], width: "100%" }}
          >
            <StageRenderer
              key={`${benchmark.id}:${viewport}:${colorMode}`}
              tree={benchmark.tree}
              colorMode={colorMode}
              theme={benchmark.theme}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby={`${benchmark.id}-qa`}>
        <h4 id={`${benchmark.id}-qa`}>Design QA checklist</h4>
        <ul>
          {benchmark.qaChecklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

export function ReferenceBenchmarksPanel({
  benchmarks = REFERENCE_BENCHMARKS,
  theme,
  initialBenchmarkId,
  initialViewport = "desktop",
  initialColorMode = "light",
  onViewChange,
}: ReferenceBenchmarksPanelProps = {}): ReactNode {
  const [selectedId, setSelectedId] = useState(
    initialBenchmarkId ?? defaultReferenceBenchmarkSelection(benchmarks),
  );
  const [viewport, setViewport] = useState<ViewportName>(initialViewport);
  const [colorMode, setColorMode] = useState<ColorMode>(initialColorMode);
  const presentation = useMemo(
    () =>
      presentReferenceBenchmarks({
        benchmarks,
        selectedId,
        ...(theme === undefined ? {} : { theme }),
      }),
    [benchmarks, selectedId, theme],
  );
  const selected = presentation.selected;

  const updateView = (nextViewport: ViewportName, nextColorMode: ColorMode): void => {
    setViewport(nextViewport);
    setColorMode(nextColorMode);
    if (selected !== null) {
      onViewChange?.({
        benchmarkId: selected.id,
        viewport: nextViewport,
        colorMode: nextColorMode,
      });
    }
  };

  if (presentation.total === 0) {
    return (
      <section
        className="lab-page-section lab-reference-benchmarks"
        aria-labelledby="reference-benchmarks-title"
      >
        <h2 id="reference-benchmarks-title">Reference benchmarks</h2>
        <p role="status">No reference benchmarks are available.</p>
      </section>
    );
  }

  return (
    <section
      className="lab-page-section lab-reference-benchmarks"
      aria-labelledby="reference-benchmarks-title"
    >
      <header>
        <h2 id="reference-benchmarks-title">Reference benchmarks</h2>
        <p>
          Static target previews for judging whether current Bricks, Presets, and Patterns can
          recreate real product surfaces. These are not provider-run official scenarios.
        </p>
        <p role="status">
          {presentation.renderable} renderable · {presentation.diagnostics} diagnostics
        </p>
      </header>

      <ul className="lab-reference-benchmark-grid" aria-label="Reference benchmark catalog">
        {presentation.items.map((benchmark) => (
          <li key={benchmark.id}>
            <button
              type="button"
              aria-pressed={selected?.id === benchmark.id}
              onClick={() => setSelectedId(benchmark.id)}
            >
              <span>{benchmark.name}</span>
              <small>{benchmark.status}</small>
            </button>
          </li>
        ))}
      </ul>

      {selected === null ? null : selected.status === "diagnostic" ? (
        <section
          role="alert"
          className="catalog-diagnostics"
          data-reference-benchmark={selected.id}
        >
          <h3>{selected.name}</h3>
          <p>This reference benchmark is unavailable.</p>
          <ul>
            {selected.diagnostics.map((entry, index) => (
              <li key={`${entry.message}:${String(index)}`}>{entry.message}</li>
            ))}
          </ul>
        </section>
      ) : (
        <RenderBenchmark
          benchmark={selected}
          viewport={viewport}
          colorMode={colorMode}
          onViewChange={updateView}
        />
      )}
    </section>
  );
}
