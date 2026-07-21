import { Component, useEffect, useRef, useState } from "react";
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

function measuredScale({
  availableWidth,
  surfaceWidth,
}: {
  readonly availableWidth: number | null;
  readonly surfaceWidth: number;
}): number {
  if (availableWidth === null || availableWidth <= 0) return 1;
  return Math.max(0.18, Math.min(1, availableWidth / surfaceWidth));
}

function ReferenceComparisonSurfaceFrame({
  viewport,
  surfaceClassName,
  testId,
  unavailable,
  children,
}: {
  readonly viewport: PresentedReferenceComparison["viewport"];
  readonly surfaceClassName: string;
  readonly testId?: string;
  readonly unavailable?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = shellRef.current;
    if (element === null) return undefined;

    const updateAvailableWidth = (nextWidth: number): void => {
      if (nextWidth > 0) setAvailableWidth(nextWidth);
    };

    updateAvailableWidth(element.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      const updateFromElement = (): void => updateAvailableWidth(element.clientWidth);
      window.addEventListener("resize", updateFromElement);
      return () => window.removeEventListener("resize", updateFromElement);
    }

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      updateAvailableWidth(entry?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = measuredScale({
    availableWidth,
    surfaceWidth: viewport.width,
  });
  const frameStyle: CSSProperties = {
    width: viewport.width * scale,
    height: viewport.height * scale,
  };
  const surfaceStyle: CSSProperties = {
    width: viewport.width,
    height: viewport.height,
    transform: `scale(${scale})`,
  };

  return (
    <div
      ref={shellRef}
      className="lab-reference-comparison-surface-shell"
      data-reference-comparison-surface-shell="true"
    >
      <div className="lab-reference-comparison-surface-frame" style={frameStyle}>
        <div
          className={surfaceClassName}
          data-testid={testId}
          data-reference-comparison-facet-surface={
            testId === "reference-comparison-facet-surface" ? "true" : undefined
          }
          data-reference-comparison-viewport-width={viewport.width}
          data-reference-comparison-viewport-height={viewport.height}
          data-reference-comparison-scaled={scale < 1 ? "true" : "false"}
          data-reference-comparison-unavailable={unavailable === true ? "true" : undefined}
          style={surfaceStyle}
        >
          {children}
        </div>
      </div>
    </div>
  );
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
            <ReferenceComparisonSurfaceFrame
              viewport={comparison.viewport}
              surfaceClassName="lab-reference-comparison-reference-surface"
            >
              <img
                className="lab-reference-comparison-reference-image"
                src={comparison.reference.src}
                alt={comparison.reference.alt}
              />
            </ReferenceComparisonSurfaceFrame>
          ) : (
            <ReferenceComparisonSurfaceFrame
              viewport={comparison.viewport}
              surfaceClassName="lab-reference-comparison-unavailable"
              unavailable
            >
              <div role="status">
                <strong>Reference unavailable for this viewport</strong>
                <span>{comparison.reference.reason}</span>
              </div>
            </ReferenceComparisonSurfaceFrame>
          )}
        </article>

        <article className="lab-reference-comparison-panel" data-reference-comparison-panel="facet">
          <header>
            <h5>Facet render</h5>
            <p>Chrome-free StageRenderer surface only</p>
          </header>
          {comparison.facet.availability === "available" ? (
            <ReferenceComparisonSurfaceFrame
              viewport={comparison.viewport}
              surfaceClassName="lab-reference-comparison-facet-surface"
              testId="reference-comparison-facet-surface"
            >
              <ReferenceComparisonRenderBoundary>
                <ReferenceComparisonFacetContent
                  facet={comparison.facet}
                  renderFacet={renderFacet}
                />
              </ReferenceComparisonRenderBoundary>
            </ReferenceComparisonSurfaceFrame>
          ) : (
            <ReferenceComparisonSurfaceFrame
              viewport={comparison.viewport}
              surfaceClassName="lab-reference-comparison-unavailable"
              unavailable
            >
              <div role="status">
                <strong>Facet render unavailable</strong>
                <span>{comparison.facet.reason}</span>
              </div>
            </ReferenceComparisonSurfaceFrame>
          )}
        </article>
      </div>
    </section>
  );
}
