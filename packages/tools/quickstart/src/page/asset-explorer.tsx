import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { ComponentInspector } from "./component-inspector.js";
import { ScreenGallery } from "./screen-gallery.js";
import { ThemeInspector } from "./theme-inspector.js";

type AssetSection = "theme" | "components" | "screens";

const ASSET_SECTIONS: readonly AssetSection[] = ["theme", "components", "screens"];

export interface AssetExplorerProps {
  readonly themeInspector?: ReactNode;
  readonly componentInspector?: ReactNode;
  readonly screenGallery?: ReactNode;
  readonly suppressPreviewModals?: boolean;
}

export function AssetExplorer({
  themeInspector,
  componentInspector,
  screenGallery,
  suppressPreviewModals,
}: AssetExplorerProps = {}): ReactNode {
  const [activeSection, setActiveSection] = useState<AssetSection>("theme");
  const tabSetId = useId();

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
      </header>
      <div data-facet-asset-explorer-body style={styles.body}>
        <div
          aria-labelledby={assetTabId(tabSetId, "theme")}
          data-facet-asset-panel="theme"
          hidden={activeSection !== "theme"}
          id={assetPanelId(tabSetId, "theme")}
          role="tabpanel"
          style={activeSection === "theme" ? styles.panel : styles.panelHidden}
        >
          {themeInspector ?? <ThemeInspector />}
        </div>
        <div
          aria-labelledby={assetTabId(tabSetId, "components")}
          data-facet-asset-panel="components"
          hidden={activeSection !== "components"}
          id={assetPanelId(tabSetId, "components")}
          role="tabpanel"
          style={activeSection === "components" ? styles.panel : styles.panelHidden}
        >
          {componentInspector ?? (
            <ComponentInspector
              suppressPreviewModals={
                suppressPreviewModals === true || activeSection !== "components"
              }
            />
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
          {screenGallery ?? (
            <ScreenGallery
              suppressPreviewModals={suppressPreviewModals === true || activeSection !== "screens"}
            />
          )}
        </div>
      </div>
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
  panel: {
    minWidth: 0,
  },
  panelHidden: {
    display: "none",
  },
} satisfies Record<string, CSSProperties>;
