import type { FacetCatalog } from "@facet/core";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { ComponentPreview } from "./component-preview.js";
import type { ComponentPreviewProps } from "./component-preview.js";
import { previewSpecimensForTag } from "./component-preview-fixtures.js";
import type {
  ComponentPreviewFixtureResult,
  ComponentPreviewSpecimen,
} from "./component-preview-fixtures.js";
import {
  deriveComponentInspectorRows,
  type ComponentInspectorRow,
  type ComponentPropMetadata,
} from "./component-inspector-model.js";
import type { AssetSourceFilter } from "./asset-source-filter.js";
import type { QuickstartResolvedDesignExample } from "../design-overlay.js";

const DEFAULT_COMPONENT_ROWS = deriveComponentInspectorRows();

type PreviewResult = ComponentPreviewFixtureResult;
type AcceptedPreviewBootstrap = NonNullable<ComponentPreviewProps["rendererBootstrap"]>;

export interface ComponentInspectorActiveDesign {
  readonly bootstrap: AcceptedPreviewBootstrap;
}

interface ComponentGroup {
  readonly key: string;
  readonly label: string;
  readonly order: number;
  readonly rows: readonly ComponentInspectorRow[];
}

export interface ComponentInspectorProps {
  readonly activeDesign?: ComponentInspectorActiveDesign;
  readonly examples?: readonly QuickstartResolvedDesignExample[];
  readonly sourceFilter?: AssetSourceFilter;
  readonly renderPreview?: (preview: PreviewResult) => ReactNode;
  readonly suppressPreviewModals?: boolean;
}

export function ComponentInspector({
  activeDesign,
  examples,
  sourceFilter = "all",
  renderPreview,
  suppressPreviewModals,
}: ComponentInspectorProps = {}): ReactNode {
  const activeCatalog: FacetCatalog | undefined = activeDesign?.bootstrap.catalog;
  const hasRenderedTrustedPreview = useRef(false);
  const shouldResolveTrustedPreviews =
    renderPreview !== undefined ||
    suppressPreviewModals !== true ||
    hasRenderedTrustedPreview.current;
  if (suppressPreviewModals !== true) {
    hasRenderedTrustedPreview.current = true;
  }
  const rows = useMemo(
    () =>
      activeCatalog === undefined
        ? DEFAULT_COMPONENT_ROWS
        : deriveComponentInspectorRows(activeCatalog),
    [activeCatalog],
  );
  const sourceRows = useMemo(() => filterRowsBySource(rows, sourceFilter), [rows, sourceFilter]);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState(sourceRows[0]?.tag ?? "");
  const [openGroupKeys, setOpenGroupKeys] = useState<ReadonlySet<string> | null>(() =>
    shouldResolveTrustedPreviews ? openGroupKeySet(sourceRows) : null,
  );
  const filteredRows = useMemo(
    () => (shouldResolveTrustedPreviews ? filterRows(sourceRows, query) : []),
    [query, sourceRows, shouldResolveTrustedPreviews],
  );
  const groupedRows = useMemo(() => groupRows(filteredRows), [filteredRows]);
  const resolvedOpenGroupKeys = useMemo(
    () =>
      shouldResolveTrustedPreviews
        ? (openGroupKeys ?? openGroupKeySet(sourceRows))
        : new Set<string>(),
    [openGroupKeys, sourceRows, shouldResolveTrustedPreviews],
  );
  const selectedRow =
    filteredRows.find((row) => row.tag === selectedTag) ?? filteredRows[0] ?? null;
  const specimens = useMemo(() => {
    if (selectedRow === null) {
      return [];
    }
    return shouldResolveTrustedPreviews
      ? previewSpecimensForTag(selectedRow.tag, activeCatalog, examples)
      : [];
  }, [activeCatalog, examples, selectedRow, shouldResolveTrustedPreviews]);

  if (!shouldResolveTrustedPreviews) {
    return <SuppressedComponentInspector componentCount={sourceRows.length} />;
  }

  return (
    <section
      aria-label="Components section"
      data-facet-component-inspector
      style={styles.inspector}
    >
      <div data-component-list-panel style={styles.listPanel}>
        <header style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>Components</h2>
          <span style={styles.componentCount}>{sourceRows.length} components</span>
        </header>
        <input
          aria-label="Search components"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search"
          style={styles.searchInput}
          type="search"
          value={query}
        />
        <nav aria-label="Default components" role="list" style={styles.componentList}>
          {filteredRows.length === 0 ? (
            <p data-component-empty-state style={styles.emptyState}>
              No components match
            </p>
          ) : (
            groupedRows.map((group) => {
              const isOpen = resolvedOpenGroupKeys.has(group.key);
              return (
                <section
                  aria-label={`${group.label} components`}
                  data-component-presentation-group={group.key}
                  key={group.key}
                  style={styles.groupSection}
                >
                  <button
                    aria-expanded={isOpen}
                    data-component-group-toggle={group.key}
                    onClick={() =>
                      setOpenGroupKeys(toggleGroupKey(resolvedOpenGroupKeys, group.key))
                    }
                    style={styles.groupSummary}
                    type="button"
                  >
                    <span style={styles.groupTitle}>{group.label}</span>
                    <span style={styles.groupSummaryMeta}>
                      <span style={styles.groupCount}>{group.rows.length}</span>
                      <span aria-hidden="true" style={styles.groupMarker}>
                        {isOpen ? "-" : "+"}
                      </span>
                    </span>
                  </button>
                  {isOpen ? (
                    <div style={styles.groupRows}>
                      {group.rows.map((row) => (
                        <button
                          aria-pressed={row.tag === selectedRow?.tag}
                          data-component-option={row.tag}
                          key={row.tag}
                          onClick={() => setSelectedTag(row.tag)}
                          style={
                            row.tag === selectedRow?.tag
                              ? styles.componentButtonActive
                              : styles.componentButton
                          }
                          type="button"
                        >
                          <span style={styles.componentTag}>{row.tag}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </nav>
      </div>

      <section
        aria-label={
          selectedRow === null ? "Component details" : `Component details for ${selectedRow.tag}`
        }
        data-component-detail-panel
        style={styles.detailPanel}
      >
        {selectedRow === null || specimens.length === 0 ? (
          <p data-component-detail-empty style={styles.emptyState}>
            No component selected
          </p>
        ) : (
          <ComponentDetail
            row={selectedRow}
            specimens={specimens}
            {...(activeDesign === undefined ? {} : { rendererBootstrap: activeDesign.bootstrap })}
            renderTrustedPreview={shouldResolveTrustedPreviews}
            {...(renderPreview === undefined ? {} : { renderPreview })}
            {...(suppressPreviewModals === undefined ? {} : { suppressPreviewModals })}
          />
        )}
      </section>
    </section>
  );
}

function SuppressedComponentInspector({
  componentCount,
}: {
  readonly componentCount: number;
}): ReactNode {
  return (
    <section
      aria-label="Components section"
      data-facet-component-inspector
      style={styles.inspector}
    >
      <div data-component-list-panel style={styles.listPanel}>
        <header style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>Components</h2>
          <span style={styles.componentCount}>{componentCount} components</span>
        </header>
      </div>
      <section
        aria-label="Component details"
        data-component-detail-panel
        style={styles.detailPanel}
      >
        <p data-component-detail-empty style={styles.emptyState}>
          Preview deferred
        </p>
      </section>
    </section>
  );
}

function ComponentDetail({
  row,
  specimens,
  rendererBootstrap,
  renderTrustedPreview,
  renderPreview,
  suppressPreviewModals,
}: {
  readonly row: ComponentInspectorRow;
  readonly specimens: readonly ComponentPreviewSpecimen[];
  readonly rendererBootstrap?: AcceptedPreviewBootstrap;
  readonly renderTrustedPreview: boolean;
  readonly renderPreview?: (preview: PreviewResult) => ReactNode;
  readonly suppressPreviewModals?: boolean;
}): ReactNode {
  const themeBadge = rendererBootstrap === undefined ? "Default theme" : "Active theme";
  const themeHint =
    rendererBootstrap === undefined
      ? "Rendered with the default theme recipe"
      : "Rendered with the active theme recipe";
  return (
    <article data-component-detail={row.tag} style={styles.detailContent}>
      <header style={styles.detailHeader}>
        <div style={styles.detailTitleBlock}>
          <div style={styles.detailKickerRow}>
            <span style={styles.groupBadge}>{row.presentation.label}</span>
            <span style={styles.componentTagBadge}>{`<${row.tag} />`}</span>
          </div>
          <h3 style={styles.detailTitle}>{row.tag}</h3>
          <p style={styles.detailSummary}>{row.whenToUse}</p>
        </div>
      </header>

      <div aria-label={`${row.tag} contract summary`} style={styles.specBar}>
        <SpecBarItem label="tag" value={row.tag} />
        <SpecBarItem label="role" value={row.authoringRole} />
        <SpecBarItem label="group" value={row.presentation.label} />
        <SpecBarItem label="children" value={row.acceptsChildren ? "accepted" : "none"} />
        <SpecBarItem label="props" value={String(row.props.length)} />
        <SpecBarItem label="recipe" value={`${row.themeRecipe?.tokens.length ?? 0} tokens`} />
      </div>

      <section
        aria-label={`${row.tag} authoring semantics`}
        data-component-authoring={row.tag}
        style={styles.metadataSection}
      >
        <header style={styles.sectionHeader}>
          <div style={styles.sectionTitleBlock}>
            <h4 style={styles.sectionTitle}>Authoring semantics</h4>
            <span style={styles.sectionHint}>Compact signals exposed during agent discovery</span>
          </div>
          <span style={styles.sectionCount}>{row.semanticSignals.length}</span>
        </header>
        <div style={styles.tokenList}>
          {row.semanticSignals.map((signal) => (
            <span data-component-semantic-signal={signal} key={signal} style={styles.token}>
              {signal}
            </span>
          ))}
        </div>
      </section>

      <section
        aria-label={`${row.tag} specimens`}
        data-component-specimens={row.tag}
        style={styles.specimensSection}
      >
        <header style={styles.previewHeader}>
          <div style={styles.sectionTitleBlock}>
            <h4 style={styles.sectionTitle}>Variants</h4>
            <span style={styles.sectionHint}>{themeHint}</span>
          </div>
          <span style={styles.previewThemeBadge}>{themeBadge}</span>
        </header>
        <div style={styles.specimenGrid}>
          {specimens.map((specimen) => (
            <SpecimenCard
              key={specimen.id}
              specimen={specimen}
              {...(rendererBootstrap === undefined ? {} : { rendererBootstrap })}
              renderTrustedPreview={renderTrustedPreview}
              {...(renderPreview === undefined ? {} : { renderPreview })}
              {...(suppressPreviewModals === undefined ? {} : { suppressPreviewModals })}
            />
          ))}
        </div>
      </section>

      <section aria-label={`${row.tag} props`} style={styles.metadataSection}>
        <header style={styles.sectionHeader}>
          <div style={styles.sectionTitleBlock}>
            <h4 style={styles.sectionTitle}>Props</h4>
            <span style={styles.sectionHint}>Authored contract accepted by this component</span>
          </div>
          <span style={styles.sectionCount}>{row.props.length}</span>
        </header>
        {row.props.length === 0 ? (
          <p style={styles.mutedText}>None</p>
        ) : (
          <div style={styles.propList}>
            {row.props.map((prop) => (
              <PropRow key={prop.name} prop={prop} />
            ))}
          </div>
        )}
      </section>

      <div style={styles.detailMetaColumns}>
        <section
          aria-label={`${row.tag} collect metadata`}
          data-component-collect={row.tag}
          style={styles.metadataSection}
        >
          <h4 style={styles.sectionTitle}>Collect</h4>
          {row.collect === null ? (
            <p style={styles.mutedText}>None</p>
          ) : (
            <div style={styles.inlinePairs}>
              <span>valueProp {row.collect.valueProp}</span>
              <span>sensitiveProp {row.collect.sensitiveProp ?? "none"}</span>
            </div>
          )}
        </section>

        <section
          aria-label={`${row.tag} theme recipe metadata`}
          data-component-theme-recipe={row.tag}
          style={styles.metadataSection}
        >
          <h4 style={styles.sectionTitle}>Theme recipe</h4>
          {row.themeRecipe === null ? (
            <p style={styles.mutedText}>None</p>
          ) : (
            <div style={styles.tokenList}>
              {row.themeRecipe.tokens.map((token) => (
                <span data-component-theme-token={token.name} key={token.name} style={styles.token}>
                  {token.name} {token.kind}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function SpecimenCard({
  rendererBootstrap,
  renderPreview,
  renderTrustedPreview,
  specimen,
  suppressPreviewModals,
}: {
  readonly rendererBootstrap?: AcceptedPreviewBootstrap;
  readonly renderPreview?: (preview: PreviewResult) => ReactNode;
  readonly renderTrustedPreview: boolean;
  readonly specimen: ComponentPreviewSpecimen;
  readonly suppressPreviewModals?: boolean;
}): ReactNode {
  const cardStyle =
    specimen.display === "wide"
      ? { ...styles.specimenCard, ...styles.specimenCardWide }
      : styles.specimenCard;

  return (
    <article
      data-component-specimen={specimen.id}
      data-component-specimen-size={specimen.display}
      style={cardStyle}
    >
      <header style={styles.specimenHeader}>
        <div style={styles.specimenTitleRow}>
          <h5 style={styles.specimenTitle}>{specimen.label}</h5>
          <span style={styles.specimenKind}>variant</span>
        </div>
        <p style={styles.specimenDescription}>{specimen.description}</p>
      </header>
      <div style={styles.previewFrame}>
        {renderPreview === undefined ? (
          renderTrustedPreview ? (
            <ComponentPreview
              result={specimen.result}
              {...(rendererBootstrap === undefined ? {} : { rendererBootstrap })}
              {...(suppressPreviewModals === undefined
                ? {}
                : { suppressModals: suppressPreviewModals })}
            />
          ) : (
            <SuppressedPreviewPlaceholder tag={specimen.result.tag} />
          )
        ) : (
          renderPreview(specimen.result)
        )}
      </div>
      <div aria-label={`${specimen.label} recipe tokens`} style={styles.specimenTokenPanel}>
        <span style={styles.specimenTokenLabel}>recipe</span>
        <div style={styles.specimenTokenList}>
          {specimen.recipeTokens.map((token) => (
            <span data-component-specimen-token={token} key={token} style={styles.token}>
              {token}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function SuppressedPreviewPlaceholder({ tag }: { readonly tag: string }): ReactNode {
  return (
    <div
      aria-hidden="true"
      data-facet-component-preview={tag}
      data-facet-component-preview-state="suppressed"
    />
  );
}

function SpecBarItem({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <div data-component-contract-summary-item={label} style={styles.specBarItem}>
      <span style={styles.metadataLabel}>{label}</span>
      <span style={styles.metadataValue}>{value}</span>
    </div>
  );
}

function PropRow({ prop }: { readonly prop: ComponentPropMetadata }): ReactNode {
  const badges = [
    prop.required ? "required" : "optional",
    prop.bindable ? "bindable" : null,
    prop.defaultValue === null ? null : `default ${prop.defaultValue}`,
    prop.rangeLabel === null ? null : `range ${prop.rangeLabel}`,
  ].filter((badge): badge is string => badge !== null);

  return (
    <article data-component-prop={prop.name} style={styles.propRow}>
      <div style={styles.propIdentity}>
        <span style={styles.propName}>{prop.name}</span>
        <div style={styles.badgeRow}>
          {badges.map((badge) => (
            <span key={badge} style={styles.smallBadge}>
              {badge}
            </span>
          ))}
          {prop.enumValues.map((value) => (
            <span key={value} style={styles.smallBadge}>
              {value}
            </span>
          ))}
        </div>
      </div>
      <span style={styles.propType}>{prop.type}</span>
      <p style={styles.propGuidance}>{prop.guidance}</p>
    </article>
  );
}

function filterRows(
  rows: readonly ComponentInspectorRow[],
  query: string,
): readonly ComponentInspectorRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return rows;
  }
  return rows.filter((row) => searchableText(row).includes(normalizedQuery));
}

function filterRowsBySource(
  rows: readonly ComponentInspectorRow[],
  sourceFilter: AssetSourceFilter,
): readonly ComponentInspectorRow[] {
  if (sourceFilter === "all") return rows;
  return rows.filter((row) => row.source === sourceFilter);
}

function searchableText(row: ComponentInspectorRow): string {
  const collectParts =
    row.collect === null ? [] : [row.collect.valueProp, row.collect.sensitiveProp ?? ""];
  const themeParts =
    row.themeRecipe === null
      ? []
      : row.themeRecipe.tokens.flatMap((token) => [token.name, token.kind]);
  return [
    row.tag,
    row.presentation.label,
    row.presentation.section,
    row.whenToUse,
    row.authoringRole,
    ...row.semanticSignals,
    String(row.acceptsChildren),
    ...row.props.flatMap((prop) => [
      prop.name,
      prop.type,
      prop.guidance,
      prop.defaultValue ?? "",
      prop.rangeLabel ?? "",
      ...prop.enumValues,
    ]),
    ...collectParts,
    ...themeParts,
  ]
    .join(" ")
    .toLowerCase();
}

function groupRows(rows: readonly ComponentInspectorRow[]): readonly ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();
  for (const row of rows) {
    const key = row.presentation.section;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        key,
        label: row.presentation.label,
        order: row.presentation.order,
        rows: [row],
      });
    } else {
      groups.set(key, {
        ...existing,
        order: Math.min(existing.order, row.presentation.order),
        rows: [...existing.rows, row],
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function openGroupKeySet(rows: readonly ComponentInspectorRow[]): ReadonlySet<string> {
  return new Set(groupRows(rows).map((group) => group.key));
}

function toggleGroupKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

const baseButton: CSSProperties = {
  minWidth: 0,
  width: "100%",
  borderColor: "transparent",
  borderRadius: "0.25rem",
  borderStyle: "solid",
  borderWidth: "1px",
  background: "transparent",
  color: "#17140f",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
  minHeight: "2rem",
  padding: "0.375rem 0.5rem",
  textAlign: "left",
  overflowWrap: "anywhere",
};

const styles = {
  inspector: {
    display: "grid",
    gridTemplateColumns: "minmax(11.5rem, 13.5rem) minmax(0, 1fr)",
    gap: "1.25rem",
    alignItems: "start",
    width: "100%",
  },
  listPanel: {
    minWidth: 0,
    position: "sticky",
    top: "0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
    borderRight: "1px solid #ede3cf",
    paddingRight: "0.75rem",
  },
  detailPanel: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.625rem",
  },
  panelTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "1rem",
    fontWeight: 700,
  },
  componentCount: {
    color: "#625844",
    fontSize: "0.75rem",
    whiteSpace: "nowrap",
  },
  searchInput: {
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#17140f",
    fontSize: "0.8125rem",
    lineHeight: 1.2,
    padding: "0.5rem",
  },
  componentList: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
  },
  groupSection: {
    minWidth: 0,
    borderBottom: "1px solid #ede3cf",
    paddingBottom: "0.375rem",
  },
  groupSummary: {
    minWidth: 0,
    width: "100%",
    border: 0,
    background: "transparent",
    color: "#625844",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    padding: "0.25rem 0",
    textAlign: "left",
  },
  groupTitle: {
    margin: 0,
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 700,
    overflowWrap: "anywhere",
    textTransform: "uppercase",
  },
  groupCount: {
    color: "#6f6048",
    fontSize: "0.6875rem",
    fontWeight: 650,
  },
  groupSummaryMeta: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
  },
  groupMarker: {
    width: "0.875rem",
    color: "#2e5aa7",
    fontSize: "0.8125rem",
    fontWeight: 800,
    lineHeight: 1,
    textAlign: "center",
  },
  groupRows: {
    display: "flex",
    flexDirection: "column",
    gap: "0.125rem",
    paddingTop: "0.125rem",
  },
  componentButton: baseButton,
  componentButtonActive: {
    ...baseButton,
    borderColor: "#2e5aa7",
    background: "#d9ecff",
    boxShadow: "inset 3px 0 0 #2e5aa7",
  },
  componentTag: {
    color: "#17140f",
    fontSize: "0.8125rem",
    fontWeight: 700,
    lineHeight: 1.2,
    overflowWrap: "anywhere",
  },
  detailContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1.125rem",
  },
  detailHeader: {
    display: "flex",
    alignItems: "start",
    justifyContent: "space-between",
    gap: "1rem",
    paddingBottom: "0.125rem",
  },
  detailTitleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.375rem",
  },
  detailKickerRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
  },
  groupBadge: {
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
    lineHeight: 1.1,
  },
  componentTagBadge: {
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.6875rem",
    lineHeight: 1,
    padding: "0.1875rem 0.375rem",
  },
  detailTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "0",
    lineHeight: 1.15,
    overflowWrap: "anywhere",
  },
  detailSummary: {
    margin: 0,
    maxWidth: "46rem",
    color: "#625844",
    fontSize: "0.875rem",
    lineHeight: 1.45,
  },
  specBar: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), 1fr))",
    borderColor: "#d9ccb2",
    borderStyle: "solid",
    borderWidth: "1px 0",
    background: "#fffdf7",
  },
  specBarItem: {
    minWidth: 0,
    display: "grid",
    gap: "0.1875rem",
    padding: "0.625rem 0.75rem",
    borderRight: "1px solid #ede3cf",
    overflowWrap: "anywhere",
  },
  specimensSection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  previewHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  previewThemeBadge: {
    border: "1px solid #d9ccb2",
    borderRadius: "999px",
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
    lineHeight: 1,
    padding: "0.25rem 0.5rem",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "end",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  sectionTitleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.1875rem",
  },
  sectionHint: {
    color: "#6f6048",
    fontSize: "0.75rem",
    lineHeight: 1.35,
  },
  sectionCount: {
    minWidth: "1.5rem",
    border: "1px solid #d9ccb2",
    borderRadius: "999px",
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
    lineHeight: 1,
    padding: "0.25rem 0.5rem",
    textAlign: "center",
  },
  specimenGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
    gap: "0.75rem",
  },
  specimenCard: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    background: "#ffffff",
    boxShadow: "0 1px 0 rgba(15, 23, 42, 0.03)",
    padding: "0.875rem",
  },
  specimenCardWide: {
    gridColumn: "1 / -1",
  },
  specimenHeader: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  specimenTitleRow: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  specimenTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "0.9375rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  specimenKind: {
    color: "#6f6048",
    fontSize: "0.6875rem",
    fontWeight: 650,
    lineHeight: 1,
    textTransform: "uppercase",
  },
  specimenDescription: {
    margin: 0,
    color: "#625844",
    fontSize: "0.75rem",
    lineHeight: 1.35,
  },
  previewFrame: {
    minWidth: 0,
    border: "1px solid #ede3cf",
    borderRadius: "0.25rem",
    background: "#fbf5e8",
    overflow: "auto",
    padding: "0.625rem",
  },
  specimenTokenPanel: {
    minWidth: 0,
    display: "grid",
    gap: "0.375rem",
    borderTop: "1px solid #ede3cf",
    paddingTop: "0.625rem",
  },
  specimenTokenList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
  },
  specimenTokenLabel: {
    color: "#6f6048",
    fontSize: "0.6875rem",
    fontWeight: 700,
    lineHeight: 1,
    textTransform: "uppercase",
  },
  metadataLabel: {
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 700,
    letterSpacing: "0",
    textTransform: "uppercase",
  },
  metadataValue: {
    color: "#17140f",
    fontSize: "0.875rem",
    fontWeight: 650,
    lineHeight: 1.35,
  },
  metadataSection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  detailMetaColumns: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
    gap: "0.75rem",
  },
  sectionTitle: {
    margin: 0,
    color: "#29251d",
    fontSize: "0.875rem",
    fontWeight: 700,
  },
  propList: {
    display: "flex",
    flexDirection: "column",
    borderTop: "1px solid #d9ccb2",
  },
  propRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(8rem, 0.45fr) minmax(5rem, 0.2fr) minmax(0, 1fr)",
    gap: "0.75rem",
    alignItems: "start",
    borderBottom: "1px solid #ede3cf",
    padding: "0.75rem 0",
    overflowWrap: "anywhere",
  },
  propIdentity: {
    minWidth: 0,
    display: "grid",
    gap: "0.375rem",
  },
  propName: {
    color: "#17140f",
    fontSize: "0.875rem",
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  propType: {
    color: "#625844",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.8125rem",
    lineHeight: 1.35,
  },
  propGuidance: {
    margin: 0,
    color: "#625844",
    fontSize: "0.8125rem",
    lineHeight: 1.45,
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
  },
  smallBadge: {
    border: "1px solid #d9ccb2",
    borderRadius: "999px",
    color: "#625844",
    fontSize: "0.6875rem",
    lineHeight: 1,
    padding: "0.1875rem 0.375rem",
  },
  inlinePairs: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
    color: "#17140f",
    fontSize: "0.8125rem",
  },
  tokenList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
  },
  token: {
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#17140f",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.6875rem",
    background: "#ffffff",
    padding: "0.1875rem 0.375rem",
    overflowWrap: "anywhere",
  },
  mutedText: {
    margin: 0,
    color: "#6f6048",
    fontSize: "0.8125rem",
  },
  emptyState: {
    margin: 0,
    color: "#6f6048",
    fontSize: "0.8125rem",
  },
} satisfies Record<string, CSSProperties>;
