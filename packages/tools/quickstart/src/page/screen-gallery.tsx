import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

import { ComponentPreview } from "./component-preview.js";
import type { ComponentPreviewFixtureResult } from "./component-preview-fixtures.js";
import { screenPatterns, type ScreenPattern } from "./screen-gallery-fixtures.js";

export interface ScreenGalleryProps {
  readonly patterns?: readonly ScreenPattern[];
  readonly renderPreview?: (preview: ComponentPreviewFixtureResult) => ReactNode;
  readonly suppressPreviewModals?: boolean;
}

export function ScreenGallery({
  patterns,
  renderPreview,
  suppressPreviewModals,
}: ScreenGalleryProps = {}): ReactNode {
  const resolvedPatterns = useMemo(() => patterns ?? screenPatterns(), [patterns]);
  const [selectedPatternId, setSelectedPatternId] = useState(resolvedPatterns[0]?.id ?? "");
  const selectedPattern =
    resolvedPatterns.find((pattern) => pattern.id === selectedPatternId) ??
    resolvedPatterns[0] ??
    null;

  return (
    <section aria-label="Screens section" data-facet-screen-gallery style={styles.gallery}>
      <style>{SCREEN_GALLERY_RESPONSIVE_CSS}</style>
      <header style={styles.header}>
        <div style={styles.titleBlock}>
          <h2 style={styles.title}>Screens</h2>
          <p style={styles.summary}>
            Larger default-asset screens rendered as complete product surfaces.
          </p>
        </div>
        <span style={styles.count}>{resolvedPatterns.length} patterns</span>
      </header>

      <div data-facet-screen-gallery-workspace style={styles.workspace}>
        <nav aria-label="Screen examples" data-facet-screen-pattern-nav style={styles.patternNav}>
          {resolvedPatterns.map((pattern) => (
            <button
              aria-pressed={pattern.id === selectedPattern?.id}
              data-screen-pattern-option={pattern.id}
              key={pattern.id}
              onClick={() => setSelectedPatternId(pattern.id)}
              style={
                pattern.id === selectedPattern?.id
                  ? styles.patternOptionActive
                  : styles.patternOption
              }
              type="button"
            >
              <span style={styles.patternOptionTitle}>{pattern.label}</span>
              <span style={styles.patternOptionDescription}>{pattern.description}</span>
            </button>
          ))}
        </nav>

        {selectedPattern === null ? (
          <p data-screen-pattern-empty style={styles.emptyState}>
            No screen selected
          </p>
        ) : (
          <ScreenPatternDetail
            pattern={selectedPattern}
            {...(renderPreview === undefined ? {} : { renderPreview })}
            {...(suppressPreviewModals === undefined ? {} : { suppressPreviewModals })}
          />
        )}
      </div>
    </section>
  );
}

function ScreenPatternDetail({
  pattern,
  renderPreview,
  suppressPreviewModals,
}: {
  readonly pattern: ScreenPattern;
  readonly renderPreview?: (preview: ComponentPreviewFixtureResult) => ReactNode;
  readonly suppressPreviewModals?: boolean;
}): ReactNode {
  return (
    <article data-screen-pattern={pattern.id} style={styles.patternDetail}>
      <header data-facet-screen-pattern-header style={styles.patternHeader}>
        <div style={styles.patternTitleBlock}>
          <h3 style={styles.patternTitle}>{pattern.label}</h3>
          <p style={styles.patternDescription}>{pattern.description}</p>
        </div>
        <div aria-label={`${pattern.label} components`} style={styles.roleList}>
          {pattern.roles.map((role) => (
            <span data-screen-pattern-role={role} key={role} style={styles.roleChip}>
              {role}
            </span>
          ))}
        </div>
      </header>

      <div data-facet-screen-preview-frame style={styles.previewFrame}>
        {renderPreview === undefined ? (
          <ComponentPreview
            result={pattern.result}
            {...(suppressPreviewModals === undefined
              ? {}
              : { suppressModals: suppressPreviewModals })}
          />
        ) : (
          renderPreview(pattern.result)
        )}
      </div>
    </article>
  );
}

const SCREEN_GALLERY_RESPONSIVE_CSS = `
@media (max-width: 760px) {
  [data-facet-screen-gallery-workspace] {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  [data-facet-screen-pattern-nav] {
    position: static !important;
    border-right: 0 !important;
    border-bottom: 1px solid #ede3cf !important;
    padding-right: 0 !important;
    padding-bottom: 0.75rem !important;
  }

  [data-facet-screen-pattern-header] {
    align-items: flex-start !important;
    flex-direction: column !important;
  }

  [data-facet-screen-preview-frame] {
    min-height: 0 !important;
    overflow-x: auto !important;
  }
}
`;

const styles = {
  gallery: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    width: "100%",
  },
  header: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.5rem",
  },
  titleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  title: {
    margin: 0,
    color: "#17140f",
    fontSize: "1rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  summary: {
    margin: 0,
    color: "#625844",
    fontSize: "0.8125rem",
    lineHeight: 1.35,
  },
  count: {
    color: "#625844",
    fontSize: "0.8125rem",
    whiteSpace: "nowrap",
  },
  workspace: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(13rem, 16rem) minmax(0, 1fr)",
    gap: "1.25rem",
    alignItems: "start",
  },
  patternNav: {
    minWidth: 0,
    position: "sticky",
    top: "0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    borderRight: "1px solid #ede3cf",
    paddingRight: "0.75rem",
  },
  patternOption: {
    minWidth: 0,
    width: "100%",
    borderColor: "transparent",
    borderRadius: "0.25rem",
    borderStyle: "solid",
    borderWidth: "1px",
    background: "transparent",
    color: "#17140f",
    cursor: "pointer",
    display: "grid",
    gap: "0.25rem",
    padding: "0.5rem",
    textAlign: "left",
    overflowWrap: "anywhere",
  },
  patternOptionActive: {
    minWidth: 0,
    width: "100%",
    borderColor: "#2e5aa7",
    borderRadius: "0.25rem",
    borderStyle: "solid",
    borderWidth: "1px",
    background: "#d9ecff",
    boxShadow: "inset 3px 0 0 #2e5aa7",
    color: "#17140f",
    cursor: "pointer",
    display: "grid",
    gap: "0.25rem",
    padding: "0.5rem",
    textAlign: "left",
    overflowWrap: "anywhere",
  },
  patternOptionTitle: {
    color: "#17140f",
    fontSize: "0.8125rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  patternOptionDescription: {
    color: "#625844",
    fontSize: "0.6875rem",
    lineHeight: 1.35,
  },
  patternDetail: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
  },
  patternHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: "1rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.75rem",
  },
  patternTitleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  patternTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "1.25rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  patternDescription: {
    margin: 0,
    color: "#625844",
    fontSize: "0.75rem",
    lineHeight: 1.35,
  },
  roleList: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "0.25rem",
  },
  roleChip: {
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.6875rem",
    lineHeight: 1,
    padding: "0.25rem 0.375rem",
  },
  previewFrame: {
    minWidth: 0,
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    background: "#fffdf7",
    minHeight: "38rem",
    overflow: "visible",
  },
  emptyState: {
    margin: 0,
    color: "#827763",
    fontSize: "0.8125rem",
  },
} satisfies Record<string, CSSProperties>;
