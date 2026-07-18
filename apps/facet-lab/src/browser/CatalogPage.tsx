import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import type { ColorMode, ViewportName } from "../shared/run-contract.js";
import {
  presentCatalog,
  type CatalogPresenterInput,
  type PresentedCatalogCategoryId,
  type PresentedCatalogItem,
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

function definitionText(item: PresentedCatalogItem): string {
  if (item.outcome.status !== "render") return "";
  return JSON.stringify(item.outcome.definition, null, 2);
}

function ItemInspector({
  item,
  theme,
  viewport,
  colorMode,
}: {
  readonly item: PresentedCatalogItem;
  readonly theme?: StageTheme;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
}): ReactNode {
  return (
    <article aria-labelledby="catalog-inspector-title" data-catalog-item={item.id}>
      <header>
        <p>{item.kind}</p>
        <h2 id="catalog-inspector-title">{item.name}</h2>
        {item.qualifier === null ? null : <p>{item.qualifier}</p>}
      </header>
      <dl>
        <dt>Description</dt>
        <dd>{item.description ?? "No description supplied."}</dd>
        <dt>Use when</dt>
        <dd>{item.useWhen ?? "No usage guidance supplied."}</dd>
        <dt>Avoid when</dt>
        <dd>{item.avoidWhen ?? "No avoidance guidance supplied."}</dd>
      </dl>

      {item.outcome.status === "diagnostic" ? (
        <section aria-labelledby="catalog-diagnostics-title" role="alert">
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
          <section
            aria-label={`${item.name} preview`}
            data-preview-viewport={viewport}
            data-preview-color-mode={colorMode}
          >
            {item.outcome.previewTree === null ? (
              <p>This value is inspected through its closed definition.</p>
            ) : (
              <StageRenderer
                tree={item.outcome.previewTree}
                colorMode={colorMode}
                {...(theme === undefined ? {} : { theme })}
              />
            )}
          </section>
          <details open>
            <summary className="facet-lab-focusable">Definition</summary>
            <pre>{definitionText(item)}</pre>
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

  const updateView = (nextViewport: ViewportName, nextColorMode: ColorMode): void => {
    setViewport(nextViewport);
    setColorMode(nextColorMode);
    onViewChange?.({ viewport: nextViewport, colorMode: nextColorMode });
  };

  return (
    <main aria-labelledby="catalog-page-title">
      <header>
        <h1 id="catalog-page-title">Catalog</h1>
        <p>
          Inspect the complete validated Brick, Preset, Pattern, token, and fixed-choice vocabulary.
        </p>
        {presentation.sourceName === null ? null : <p>Source: {presentation.sourceName}</p>}
        {presentation.assetDigest === null ? null : <p>Assets: {presentation.assetDigest}</p>}
      </header>

      <label htmlFor="catalog-search">Search the catalog</label>
      <input
        id="catalog-search"
        className="facet-lab-focusable"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        autoComplete="off"
      />

      <nav aria-label="Catalog categories">
        <ul>
          {presentation.categories.map((category) => (
            <li key={category.id}>
              <button
                className="facet-lab-focusable"
                type="button"
                aria-current={category.id === categoryId ? "page" : undefined}
                onClick={() => {
                  setCategoryId(category.id);
                  setSelectedItemId(undefined);
                }}
              >
                {category.label} ({String(category.visible)}/{String(category.total)})
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <p role={presentation.state === "error" ? "alert" : "status"} aria-live="polite">
        {presentation.statusMessage}
      </p>
      {presentation.diagnostics.length === 0 ? null : (
        <section aria-labelledby="catalog-global-diagnostics" role="alert">
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
        <div>
          <section aria-labelledby="catalog-results-title">
            <h2 id="catalog-results-title">{activeCategory?.label ?? "Catalog items"}</h2>
            {activeCategory?.items.length === 0 ? (
              <p>No items in this category match the current search.</p>
            ) : (
              <ul>
                {activeCategory?.items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="facet-lab-focusable"
                      type="button"
                      aria-pressed={presentation.selectedItem?.id === item.id}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <span>{item.name}</span>
                      <span>{item.kind}</span>
                      <span>{item.outcome.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside aria-label="Catalog preview and definition">
            <fieldset>
              <legend>Preview view</legend>
              <label htmlFor="catalog-preview-viewport">Viewport</label>
              <select
                id="catalog-preview-viewport"
                className="facet-lab-focusable"
                value={viewport}
                onChange={(event) =>
                  updateView(event.currentTarget.value as ViewportName, colorMode)
                }
              >
                {VIEWPORTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <label htmlFor="catalog-preview-color">Color mode</label>
              <select
                id="catalog-preview-color"
                className="facet-lab-focusable"
                value={colorMode}
                onChange={(event) => updateView(viewport, event.currentTarget.value as ColorMode)}
              >
                {COLOR_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </fieldset>
            {presentation.selectedItem === null ? (
              <p>Select an item to inspect its safe definition.</p>
            ) : (
              <ItemInspector
                item={presentation.selectedItem}
                viewport={viewport}
                colorMode={colorMode}
                {...(theme === undefined ? {} : { theme })}
              />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
