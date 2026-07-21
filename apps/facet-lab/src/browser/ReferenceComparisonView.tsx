import { Component } from "react";
import type { CSSProperties, ErrorInfo, ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import {
  type PresentedReferenceComparison,
  type PresentedReferenceComparisonFacetAvailable,
  type ReferenceComparisonClassification,
} from "./reference-comparison-presenter.js";

type FacetRenderer = (facet: PresentedReferenceComparisonFacetAvailable) => ReactNode;

interface ReferenceComparisonRenderBoundaryProps {
  readonly children: ReactNode;
}

interface ReferenceComparisonRenderBoundaryState {
  readonly message: string | null;
}

class ReferenceComparisonRenderBoundary extends Component<
  ReferenceComparisonRenderBoundaryProps,
  ReferenceComparisonRenderBoundaryState
> {
  override state: ReferenceComparisonRenderBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ReferenceComparisonRenderBoundaryState {
    return {
      message: error instanceof Error ? error.message : "Unknown render error.",
    };
  }

  override componentDidCatch(_error: unknown, _errorInfo: ErrorInfo): void {
    return undefined;
  }

  override render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div
          role="alert"
          className="lab-reference-comparison-render-error"
          data-reference-comparison-render-error="true"
        >
          <strong>Facet render unavailable in comparison mode.</strong>
          <span>{this.state.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function DefaultFacetRenderer({
  facet,
}: {
  readonly facet: PresentedReferenceComparisonFacetAvailable;
}): ReactNode {
  return <StageRenderer tree={facet.tree} colorMode={facet.colorMode} theme={facet.theme} />;
}

function ReferenceComparisonFacetContent({
  facet,
  renderFacet,
}: {
  readonly facet: PresentedReferenceComparisonFacetAvailable;
  readonly renderFacet: FacetRenderer;
}): ReactNode {
  return <>{renderFacet(facet)}</>;
}

export interface ReferenceComparisonViewProps {
  readonly comparison: PresentedReferenceComparison;
  readonly onClassificationChange: (classification: ReferenceComparisonClassification) => void;
  readonly renderFacet?: FacetRenderer;
}

export function ReferenceComparisonView({
  comparison,
  onClassificationChange,
  renderFacet = (facet) => <DefaultFacetRenderer facet={facet} />,
}: ReferenceComparisonViewProps): ReactNode {
  const viewportSurfaceStyle: CSSProperties = {
    maxWidth: comparison.viewport.width,
    aspectRatio: `${String(comparison.viewport.width)} / ${String(comparison.viewport.height)}`,
  };

  return (
    <section
      className="lab-reference-comparison"
      data-testid="reference-comparison"
      data-reference-comparison-status={comparison.status}
      data-reference-comparison-viewport={comparison.viewport.name}
      data-reference-comparison-classification={comparison.classification.value}
      aria-labelledby={`${comparison.benchmark.id}-comparison-title`}
    >
      <header className="lab-reference-comparison-header">
        <div>
          <p className="catalog-section-label">Visual comparison mode</p>
          <h4 id={`${comparison.benchmark.id}-comparison-title`}>{comparison.benchmark.name}</h4>
          <p>
            {comparison.viewport.label} · {comparison.viewport.width}×{comparison.viewport.height} ·{" "}
            {comparison.classification.label}
          </p>
        </div>
        <label htmlFor="reference-comparison-classification">
          Comparison verdict
          <select
            id="reference-comparison-classification"
            value={comparison.classification.value}
            onChange={(event) =>
              onClassificationChange(event.currentTarget.value as ReferenceComparisonClassification)
            }
          >
            {comparison.classificationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <p className="lab-reference-comparison-classification-summary">
        {comparison.classification.summary}
      </p>

      {comparison.diagnostics.length === 0 ? null : (
        <ul className="lab-reference-comparison-diagnostics">
          {comparison.diagnostics.map((diagnostic) => (
            <li key={diagnostic}>{diagnostic}</li>
          ))}
        </ul>
      )}

      <div className="lab-reference-comparison-grid">
        <article
          className="lab-reference-comparison-panel"
          data-reference-comparison-panel="reference"
        >
          <header>
            <h5>Reference</h5>
            <p>
              {comparison.reference.availability === "available"
                ? comparison.reference.sourceLabel
                : "No registered Lab snapshot"}
            </p>
          </header>
          {comparison.reference.availability === "available" ? (
            <img
              src={comparison.reference.src}
              alt={comparison.reference.alt}
              style={viewportSurfaceStyle}
            />
          ) : (
            <div
              role="status"
              className="lab-reference-comparison-unavailable"
              style={viewportSurfaceStyle}
            >
              <strong>Reference unavailable for this viewport</strong>
              <span>{comparison.reference.reason}</span>
            </div>
          )}
        </article>

        <article className="lab-reference-comparison-panel" data-reference-comparison-panel="facet">
          <header>
            <h5>Facet render</h5>
            <p>Chrome-free StageRenderer surface only</p>
          </header>
          {comparison.facet.availability === "available" ? (
            <div
              className="lab-reference-comparison-facet-surface"
              data-testid="reference-comparison-facet-surface"
              data-reference-comparison-facet-surface="true"
              style={viewportSurfaceStyle}
            >
              <ReferenceComparisonRenderBoundary>
                <ReferenceComparisonFacetContent
                  facet={comparison.facet}
                  renderFacet={renderFacet}
                />
              </ReferenceComparisonRenderBoundary>
            </div>
          ) : (
            <div
              role="status"
              className="lab-reference-comparison-unavailable"
              style={viewportSurfaceStyle}
            >
              <strong>Facet render unavailable</strong>
              <span>{comparison.facet.reason}</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
