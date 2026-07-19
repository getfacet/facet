import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import type { ColorMode, ViewportName } from "../shared/run-contract.js";
import {
  presentCatalog,
  type CatalogPresenterInput,
  type PresentedCatalogCategoryId,
  type PresentedCatalogItem,
  type PresentedCatalogItemKind,
} from "./catalog-presenter.js";

type StageTheme = ComponentProps<typeof StageRenderer>["theme"];

export interface CatalogPageProps {
  readonly status: CatalogPresenterInput["status"];
  readonly catalog?: unknown;
  readonly errorMessage?: string;
  readonly theme?: StageTheme;
  readonly initialViewport?: ViewportName;
  readonly initialColorMode?: ColorMode;
  readonly onViewChange?: (view: {
    readonly viewport: ViewportName;
    readonly colorMode: ColorMode;
  }) => void;
}

const VIEWPORTS: readonly ViewportName[] = ["mobile", "tablet", "desktop"];
const COLOR_MODES: readonly ColorMode[] = ["light", "dark"];

const CATEGORY_META: Readonly<
  Record<PresentedCatalogCategoryId, { readonly singular: string; readonly description: string }>
> = {
  bricks: {
    singular: "Brick",
    description: "The 11 safe UI building blocks an agent can place on a Facet stage.",
  },
  presets: {
    singular: "Preset",
    description: "Named, reusable styling for one specific Brick type.",
  },
  patterns: {
    singular: "Pattern",
    description: "Validated example layouts composed entirely from ordinary Bricks.",
  },
  "token-values": {
    singular: "Token",
    description: "Theme-aware style names whose concrete value can change by theme and color mode.",
  },
  "fixed-choices": {
    singular: "Fixed choice",
    description: "Closed, non-theme choices such as row or column that Core accepts exactly.",
  },
};

const KIND_LABELS: Readonly<Record<PresentedCatalogItemKind, string>> = {
  brick: "Brick",
  preset: "Preset",
  pattern: "Pattern",
  token: "Token",
  fixed: "Fixed choice",
};

function definitionText(item: PresentedCatalogItem): string {
  if (item.outcome.status !== "render") return "";
  return JSON.stringify(item.outcome.definition, null, 2);
}

function itemContext(item: PresentedCatalogItem): string | null {
  if (item.qualifier === null || item.qualifier === item.name) return null;
  if (item.kind === "preset") return `Styles the ${item.qualifier} Brick`;
  if (item.kind === "token") return `${item.qualifier} token domain`;
  if (item.kind === "fixed") return `${item.qualifier} fixed-choice domain`;
  return item.qualifier;
}

function sourceDataUsage(item: PresentedCatalogItem): string {
  switch (item.kind) {
    case "brick":
      return "Core and agent tools read this contract to know which content fields and style properties the Brick accepts. Values outside that closed contract are rejected.";
    case "preset":
      return `The renderer applies this data when a ${item.qualifier ?? "matching"} Brick names the “${item.name}” preset. A Brick can still override allowed style fields directly.`;
    case "pattern":
      return "Agents can read and adapt this validated example tree. A Pattern demonstrates a reusable Brick arrangement; it does not add a new UI element type.";
    case "token":
      return "Themes give this token a concrete value. Presets and Brick styles refer to the token name instead of sending raw CSS.";
    case "fixed":
      return `Core accepts this exact choice in the ${item.qualifier ?? "matching"} domain. Values outside the closed list are rejected.`;
  }
}

function sourceDataOrigin(item: PresentedCatalogItem): string {
  switch (item.kind) {
    case "brick":
      return "@facet/core Brick contract";
    case "preset":
      return "currently selected Theme asset snapshot";
    case "pattern":
      return "currently selected Pattern asset snapshot";
    case "token":
    case "fixed":
      return "@facet/core style-value contract";
  }
}

function ItemInspector({
  item,
  theme,
  viewport,
  colorMode,
  onViewChange,
}: {
  readonly item: PresentedCatalogItem;
  readonly theme?: StageTheme;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly onViewChange: (viewport: ViewportName, colorMode: ColorMode) => void;
}): ReactNode {
  const context = itemContext(item);
  return (
    <article
      className="catalog-item-inspector"
      aria-labelledby="catalog-inspector-title"
      data-catalog-item={item.id}
    >
      <header className="catalog-item-header">
        <span className="catalog-kind-badge">{KIND_LABELS[item.kind]}</span>
        {context === null ? null : <p className="catalog-item-context">{context}</p>}
        <h2 id="catalog-inspector-title">{item.name}</h2>
        <p className="catalog-item-description">
          {item.description ?? "This package item does not provide a description yet."}
        </p>
      </header>

      <section className="catalog-guidance" aria-label={`${item.name} usage guidance`}>
        <div>
          <h3>Use it when</h3>
          <p>{item.useWhen ?? "No additional usage guidance is declared."}</p>
        </div>
        <div>
          <h3>Choose something else when</h3>
          <p>{item.avoidWhen ?? "No special limitation is declared for this item."}</p>
        </div>
      </section>

      {item.outcome.status === "diagnostic" ? (
        <section
          className="catalog-diagnostics"
          aria-labelledby="catalog-diagnostics-title"
          role="alert"
        >
          <h3 id="catalog-diagnostics-title">Preview diagnostics</h3>
          <ul>
            {item.outcome.diagnostics.map((entry, index) => (
              <li key={`${entry.itemId}:${entry.severity}:${String(index)}`}>
                <strong>{entry.severity}</strong>: {entry.message}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {item.outcome.previewTree === null ? (
            <section className="catalog-effect-note" aria-label={`${item.name} effect`}>
              <p className="catalog-section-label">Not a standalone UI element</p>
              <h3>This value changes how a Brick is allowed to render.</h3>
              <p>
                Tokens and fixed choices appear through Brick styles, so they do not have a useful
                preview on their own.
              </p>
            </section>
          ) : (
            <section
              className="catalog-preview"
              aria-label={`${item.name} preview`}
              data-preview-viewport={viewport}
              data-preview-color-mode={colorMode}
            >
              <header>
                <div>
                  <p className="catalog-section-label">Live Facet preview</p>
                  <h3>This frame is rendered by Facet.</h3>
                  <p>
                    The sample tree inside the frame uses <code>StageRenderer</code>. The catalog
                    controls around it are the Lab’s React shell.
                  </p>
                </div>
                <fieldset className="catalog-preview-controls">
                  <legend>Preview appearance</legend>
                  <label htmlFor="catalog-preview-viewport">
                    Width
                    <select
                      id="catalog-preview-viewport"
                      className="facet-lab-focusable"
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
                  <label htmlFor="catalog-preview-color">
                    Color
                    <select
                      id="catalog-preview-color"
                      className="facet-lab-focusable"
                      value={colorMode}
                      onChange={(event) =>
                        onViewChange(viewport, event.currentTarget.value as ColorMode)
                      }
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
                <div className="catalog-preview-canvas">
                  <StageRenderer
                    key={item.id}
                    tree={item.outcome.previewTree}
                    colorMode={colorMode}
                    {...(theme === undefined ? {} : { theme })}
                  />
                </div>
              </div>
            </section>
          )}

          <details className="catalog-package-data">
            <summary className="facet-lab-focusable">Validated source data (advanced)</summary>
            <div>
              <h3>What this data does</h3>
              <p>{sourceDataUsage(item)}</p>
              <p>
                This JSON is from the {sourceDataOrigin(item)} used for this item. It is shown for
                debugging and authoring; users do not need to read it to understand the preview.
              </p>
              <pre>{definitionText(item)}</pre>
            </div>
          </details>
        </>
      )}
    </article>
  );
}

export function CatalogPage({
  status,
  catalog,
  errorMessage,
  theme,
  initialViewport = "desktop",
  initialColorMode = "light",
  onViewChange,
}: CatalogPageProps): ReactNode {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<PresentedCatalogCategoryId>("bricks");
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(undefined);
  const [viewport, setViewport] = useState<ViewportName>(initialViewport);
  const [colorMode, setColorMode] = useState<ColorMode>(initialColorMode);
  const presentation = useMemo(
    () =>
      presentCatalog({
        status,
        ...(catalog === undefined ? {} : { catalog }),
        ...(errorMessage === undefined ? {} : { errorMessage }),
        query,
        categoryId,
        ...(selectedItemId === undefined ? {} : { selectedItemId }),
      }),
    [catalog, categoryId, errorMessage, query, selectedItemId, status],
  );
  const activeCategory = presentation.categories.find(({ id }) => id === categoryId);
  const activeCategoryMeta = CATEGORY_META[categoryId];

  const updateView = (nextViewport: ViewportName, nextColorMode: ColorMode): void => {
    setViewport(nextViewport);
    setColorMode(nextColorMode);
    onViewChange?.({ viewport: nextViewport, colorMode: nextColorMode });
  };

  return (
    <main className="catalog-page" aria-labelledby="catalog-page-title">
      <header className="catalog-hero">
        <div>
          <p className="catalog-overline">Package vocabulary</p>
          <h1 id="catalog-page-title">Catalog</h1>
          <p className="catalog-lead">
            See what Facet gives an agent, what each item is for, and how it renders—without reading
            package internals first.
          </p>
        </div>
        {presentation.sourceName === null && presentation.assetDigest === null ? null : (
          <dl className="catalog-provenance" aria-label="Catalog source">
            {presentation.sourceName === null ? null : (
              <div>
                <dt>Packages</dt>
                <dd>{presentation.sourceName}</dd>
              </div>
            )}
            {presentation.assetDigest === null ? null : (
              <div>
                <dt>Asset snapshot</dt>
                <dd>
                  <code title={presentation.assetDigest}>{presentation.assetDigest}</code>
                </dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <section className="catalog-reading-guide" aria-labelledby="catalog-reading-guide-title">
        <div>
          <p className="catalog-section-label">How to read the catalog</p>
          <h2 id="catalog-reading-guide-title">Only Bricks render on the stage</h2>
        </div>
        <ol>
          <li>
            <strong>Bricks are the UI.</strong>
            <span>Every visible Facet stage is a safe tree of the 11 Brick types.</span>
          </li>
          <li>
            <strong>Presets style one Brick.</strong>
            <span>A Preset is a named style recipe, never a new component.</span>
          </li>
          <li>
            <strong>Patterns stay outside the stage.</strong>
            <span>An agent can read an example, then author its own ordinary Brick tree.</span>
          </li>
        </ol>
      </section>

      <section className="catalog-toolbar" aria-label="Catalog filters">
        <label className="catalog-search" htmlFor="catalog-search">
          <span>Search all names and guidance</span>
          <input
            id="catalog-search"
            className="facet-lab-focusable"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Try “heading”, “chart”, or “row”"
            autoComplete="off"
          />
        </label>

        <nav className="catalog-categories" aria-label="Catalog categories">
          <ul>
            {presentation.categories.map((category) => (
              <li key={category.id}>
                <button
                  className="facet-lab-focusable"
                  type="button"
                  aria-label={`${category.label} (${String(category.visible)}/${String(category.total)})`}
                  aria-current={category.id === categoryId ? "page" : undefined}
                  onClick={() => {
                    setCategoryId(category.id);
                    setSelectedItemId(undefined);
                  }}
                >
                  <span className="catalog-category-heading">
                    <strong title={category.label}>{category.label}</strong>
                    <span>
                      {String(category.visible)}/{String(category.total)}
                    </span>
                  </span>
                  <small>{CATEGORY_META[category.id].description}</small>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <p
          className="catalog-status"
          role={presentation.state === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {presentation.statusMessage}
        </p>
      </section>

      {presentation.diagnostics.length === 0 ? null : (
        <section
          className="catalog-global-diagnostics"
          aria-labelledby="catalog-global-diagnostics"
          role="alert"
        >
          <h2 id="catalog-global-diagnostics">Catalog diagnostics</h2>
          <ul>
            {presentation.diagnostics.map((entry, index) => (
              <li key={`${entry.itemId}:${entry.severity}:${String(index)}`}>
                <strong>{entry.itemId}</strong>: {entry.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {presentation.state === "loading" || presentation.state === "error" ? null : (
        <div className="catalog-browser">
          <section className="catalog-results" aria-labelledby="catalog-results-title">
            <header>
              <p className="catalog-section-label">Choose one to inspect</p>
              <h2 id="catalog-results-title">{activeCategory?.label ?? "Catalog items"}</h2>
              <p>{activeCategoryMeta.description}</p>
            </header>
            {activeCategory?.items.length === 0 ? (
              <p className="catalog-empty">No items in this category match the current search.</p>
            ) : (
              <ul className="catalog-results-list">
                {activeCategory?.items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="facet-lab-focusable"
                      type="button"
                      aria-label={`Inspect ${CATEGORY_META[item.categoryId].singular} ${item.name}`}
                      aria-pressed={presentation.selectedItem?.id === item.id}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <span className="catalog-result-label">
                        <span>{KIND_LABELS[item.kind]}</span>
                        <strong>{item.name}</strong>
                      </span>
                      <small>{item.description ?? "No description supplied."}</small>
                      {item.outcome.status === "diagnostic" ? (
                        <span className="catalog-result-warning">Needs attention</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside
            className="catalog-inspector"
            aria-label="Catalog preview and validated source data"
          >
            {presentation.selectedItem === null ? (
              <div className="catalog-empty-inspector">
                <h2>Select an item</h2>
                <p>Its purpose, Facet preview, and optional source data will appear here.</p>
              </div>
            ) : (
              <ItemInspector
                item={presentation.selectedItem}
                viewport={viewport}
                colorMode={colorMode}
                onViewChange={updateView}
                {...(theme === undefined ? {} : { theme })}
              />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
