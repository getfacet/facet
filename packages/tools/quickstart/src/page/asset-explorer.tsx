import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { ComponentInspector } from "./component-inspector.js";
import { ScreenGallery } from "./screen-gallery.js";
import { screenPatterns } from "./screen-gallery-fixtures.js";
import { ThemeInspector } from "./theme-inspector.js";
import {
  ASSET_SOURCE_FILTERS,
  assetSourceFilterLabel,
  type AssetSourceFilter,
} from "./asset-source-filter.js";
import type { QuickstartActiveDesignSummary, QuickstartPageActiveDesign } from "./active-design.js";

type AssetSection = "theme" | "components" | "screens";

const ASSET_SECTIONS: readonly AssetSection[] = ["theme", "components", "screens"];

export interface AssetExplorerProps {
  readonly activeDesign?: QuickstartActiveDesignSummary;
  readonly themeInspector?: ReactNode;
  readonly componentInspector?: ReactNode;
  readonly screenGallery?: ReactNode;
  readonly suppressPreviewModals?: boolean;
}

export function AssetExplorer({
  activeDesign,
  themeInspector,
  componentInspector,
  screenGallery,
  suppressPreviewModals,
}: AssetExplorerProps = {}): ReactNode {
  const [activeSection, setActiveSection] = useState<AssetSection>("theme");
  const [sourceFilter, setSourceFilter] = useState<AssetSourceFilter>("all");
  const tabSetId = useId();
  const fullActiveDesign = pageActiveDesign(activeDesign);
  const hasImportedDesign =
    fullActiveDesign !== undefined &&
    (fullActiveDesign.customRegistryTags.length > 0 || fullActiveDesign.mode === "overlay");

  return (
    <section aria-label="Assets space" data-facet-asset-explorer style={styles.explorer}>
      <header style={styles.header}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>Assets</h1>
        </div>
        <div aria-label="Asset sections" role="tablist" style={styles.tabs}>
          {ASSET_SECTIONS.map((section) => (
            <button
              aria-selected={activeSection === section}
              aria-controls={assetPanelId(tabSetId, section)}
              data-facet-asset-tab={section}
              id={assetTabId(tabSetId, section)}
              key={section}
              onClick={() => setActiveSection(section)}
              role="tab"
              style={activeSection === section ? styles.tabActive : styles.tab}
              type="button"
            >
              {assetSectionLabel(section)}
            </button>
          ))}
        </div>
        {hasImportedDesign ? (
          <AssetSourceFilterControl value={sourceFilter} onChange={setSourceFilter} />
        ) : null}
      </header>
      {activeDesign === undefined ? null : <ActiveDesignSummary design={activeDesign} />}
      <div data-facet-asset-explorer-body style={styles.body}>
        <div
          aria-labelledby={assetTabId(tabSetId, "theme")}
          data-facet-asset-panel="theme"
          hidden={activeSection !== "theme"}
          id={assetPanelId(tabSetId, "theme")}
          role="tabpanel"
          style={activeSection === "theme" ? styles.panel : styles.panelHidden}
        >
          {themeInspector ?? defaultThemeInspector(fullActiveDesign, sourceFilter)}
        </div>
        <div
          aria-labelledby={assetTabId(tabSetId, "components")}
          data-facet-asset-panel="components"
          hidden={activeSection !== "components"}
          id={assetPanelId(tabSetId, "components")}
          role="tabpanel"
          style={activeSection === "components" ? styles.panel : styles.panelHidden}
        >
          {componentInspector ??
            defaultComponentInspector(
              fullActiveDesign,
              sourceFilter,
              suppressPreviewModals === true || activeSection !== "components",
            )}
        </div>
        <div
          aria-labelledby={assetTabId(tabSetId, "screens")}
          data-facet-asset-panel="screens"
          hidden={activeSection !== "screens"}
          id={assetPanelId(tabSetId, "screens")}
          role="tabpanel"
          style={activeSection === "screens" ? styles.panel : styles.panelHidden}
        >
          {screenGallery ??
            defaultScreenGallery(
              fullActiveDesign,
              sourceFilter,
              suppressPreviewModals === true || activeSection !== "screens",
            )}
        </div>
      </div>
    </section>
  );
}

function pageActiveDesign(
  design: QuickstartActiveDesignSummary | undefined,
): QuickstartPageActiveDesign | undefined {
  return isPageActiveDesign(design) ? design : undefined;
}

function isPageActiveDesign(
  design: QuickstartActiveDesignSummary | undefined,
): design is QuickstartPageActiveDesign {
  return design !== undefined && "bootstrap" in design && "examples" in design;
}

function defaultThemeInspector(
  activeDesign: QuickstartPageActiveDesign | undefined,
  sourceFilter: AssetSourceFilter,
): ReactNode {
  if (activeDesign === undefined || sourceFilter === "default") {
    return <ThemeInspector title="Default design system" />;
  }
  return (
    <ThemeInspector
      catalog={activeDesign.bootstrap.catalog}
      theme={activeDesign.bootstrap.theme}
      themeExtensions={activeDesign.bootstrap.themeExtensions}
      title={sourceFilter === "imported" ? "Imported design system" : "Active design system"}
    />
  );
}

function defaultComponentInspector(
  activeDesign: QuickstartPageActiveDesign | undefined,
  sourceFilter: AssetSourceFilter,
  suppressPreviewModals: boolean,
): ReactNode {
  if (activeDesign === undefined || sourceFilter === "default") {
    return <ComponentInspector suppressPreviewModals={suppressPreviewModals} />;
  }
  return (
    <ComponentInspector
      activeDesign={{ bootstrap: activeDesign.bootstrap }}
      examples={activeDesign.examples}
      sourceFilter={sourceFilter}
      suppressPreviewModals={suppressPreviewModals}
    />
  );
}

function defaultScreenGallery(
  activeDesign: QuickstartPageActiveDesign | undefined,
  sourceFilter: AssetSourceFilter,
  suppressPreviewModals: boolean,
): ReactNode {
  if (activeDesign === undefined || sourceFilter === "default") {
    return <ScreenGallery suppressPreviewModals={suppressPreviewModals} />;
  }
  return (
    <ScreenGallery
      patterns={screenPatterns({
        catalog: activeDesign.bootstrap.catalog,
        examples: activeDesign.examples,
      })}
      rendererBootstrap={activeDesign.bootstrap}
      sourceFilter={sourceFilter}
      suppressPreviewModals={suppressPreviewModals}
    />
  );
}

function AssetSourceFilterControl({
  value,
  onChange,
}: {
  readonly value: AssetSourceFilter;
  readonly onChange: (value: AssetSourceFilter) => void;
}): ReactNode {
  return (
    <div
      aria-label="Asset source"
      data-facet-asset-source-filter
      role="radiogroup"
      style={styles.sourceFilter}
    >
      {ASSET_SOURCE_FILTERS.map((filter) => (
        <button
          aria-checked={value === filter}
          data-facet-asset-source-option={filter}
          key={filter}
          onClick={() => onChange(filter)}
          role="radio"
          style={value === filter ? styles.sourceFilterOptionActive : styles.sourceFilterOption}
          type="button"
        >
          {assetSourceFilterLabel(filter)}
        </button>
      ))}
    </div>
  );
}

function ActiveDesignSummary({ design }: { readonly design: QuickstartActiveDesignSummary }) {
  const customTags =
    design.customRegistryTags.length === 0
      ? "Default components"
      : design.customRegistryTags.join(", ");
  return (
    <section aria-label="Active design" data-facet-active-design style={styles.activeDesign}>
      <div style={styles.activeDesignMeta}>
        <span data-facet-active-design-mode style={styles.activeDesignMode}>
          {design.mode === "overlay" ? "Custom design" : "Default design"}
        </span>
        <span data-facet-active-design-tag-count style={styles.activeDesignTagCount}>
          {String(design.registryTags.length)} tags
        </span>
        <span data-facet-active-design-custom-tags style={styles.activeDesignCustomTags}>
          {customTags}
        </span>
      </div>
      {design.notes.length === 0 ? null : (
        <div style={styles.activeDesignNotes}>
          {design.notes.map((note) => (
            <article data-facet-active-design-note={note.id} key={note.id} style={styles.note}>
              <h2 style={styles.noteTitle}>{note.title}</h2>
              <p style={styles.noteBody}>{note.body}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function assetSectionLabel(section: AssetSection): string {
  if (section === "theme") return "Design System";
  if (section === "components") return "Components";
  return "Screens";
}

function assetTabId(tabSetId: string, section: AssetSection): string {
  return `${tabSetId}-${section}-tab`;
}

function assetPanelId(tabSetId: string, section: AssetSection): string {
  return `${tabSetId}-${section}-panel`;
}

const baseTab: CSSProperties = {
  borderColor: "#d9ccb2",
  borderRadius: "0.375rem",
  borderStyle: "solid",
  borderWidth: "1px",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.875rem",
  fontWeight: 700,
  lineHeight: 1,
  padding: "0.625rem 0.75rem",
  whiteSpace: "nowrap",
};

const styles = {
  explorer: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    overflowWrap: "anywhere",
    width: "100%",
  },
  header: {
    minWidth: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "end",
    justifyContent: "space-between",
    gap: "0.875rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.875rem",
  },
  titleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  title: {
    margin: 0,
    color: "#17140f",
    fontSize: "1.125rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  tabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  sourceFilter: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: "0.25rem",
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    padding: "0.1875rem",
  },
  sourceFilterOption: {
    border: 0,
    borderRadius: "0.25rem",
    background: "transparent",
    color: "#625844",
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.75rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.5rem 0.625rem",
    whiteSpace: "nowrap",
  },
  sourceFilterOptionActive: {
    border: 0,
    borderRadius: "0.25rem",
    background: "#17140f",
    color: "#fffaf0",
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.75rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.5rem 0.625rem",
    whiteSpace: "nowrap",
  },
  tab: {
    ...baseTab,
    background: "#ffffff",
    color: "#625844",
  },
  tabActive: {
    ...baseTab,
    background: "#2e5aa7",
    borderColor: "#2e5aa7",
    color: "#ffffff",
  },
  body: {
    minWidth: 0,
    width: "100%",
  },
  activeDesign: {
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    display: "grid",
    gap: "0.75rem",
    padding: "0.875rem",
  },
  activeDesignMeta: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  activeDesignMode: {
    color: "#171410",
    fontSize: "0.875rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  activeDesignTagCount: {
    border: "1px solid #d9ccb2",
    borderRadius: "9999px",
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.3125rem 0.5rem",
  },
  activeDesignCustomTags: {
    color: "#625844",
    fontSize: "0.8125rem",
    lineHeight: 1.35,
  },
  activeDesignNotes: {
    display: "grid",
    gap: "0.5rem",
  },
  note: {
    borderTop: "1px solid #efe4cc",
    display: "grid",
    gap: "0.25rem",
    paddingTop: "0.625rem",
  },
  noteTitle: {
    color: "#171410",
    fontSize: "0.875rem",
    fontWeight: 750,
    lineHeight: 1.2,
    margin: 0,
  },
  noteBody: {
    color: "#625844",
    fontSize: "0.8125rem",
    lineHeight: 1.4,
    margin: 0,
  },
  panel: {
    minWidth: 0,
  },
  panelHidden: {
    display: "none",
  },
} satisfies Record<string, CSSProperties>;
