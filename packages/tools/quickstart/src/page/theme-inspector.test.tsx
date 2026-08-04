// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_CSS_VARS,
  DEFAULT_THEME_TOKEN_ROWS,
  type AssetTokenLayer,
  type AssetTokenRow,
  type AssetTokenVisualKind,
} from "./asset-token-model.js";
import { ThemeInspector } from "./theme-inspector.js";

const LAYERS: readonly AssetTokenLayer[] = ["foundation", "semantic", "recipe"];

function renderThemeInspector(rows: readonly AssetTokenRow[]): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ThemeInspector rows={rows} />);
  return host;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function rowsFor(layer: AssetTokenLayer, rows: readonly AssetTokenRow[]): readonly AssetTokenRow[] {
  return rows.filter((row) => row.layer === layer);
}

function visualKinds(rows: readonly AssetTokenRow[]): readonly AssetTokenVisualKind[] {
  return [...new Set(rows.map((row) => row.visual.kind))].sort();
}

function tokenRow(container: ParentNode, path: string): HTMLElement {
  const row = container.querySelector(`[data-token-path="${path}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing rendered token row for ${path}`);
  }
  return row;
}

function region(container: ParentNode, accessibleName: string): HTMLElement {
  for (const candidate of container.querySelectorAll('[role="region"]')) {
    if (
      candidate.getAttribute("aria-label") === accessibleName &&
      candidate instanceof HTMLElement
    ) {
      return candidate;
    }
  }
  throw new Error(`Missing region: ${accessibleName}`);
}

function textIn(container: ParentNode, selector: string, text: string): HTMLElement {
  for (const candidate of container.querySelectorAll(selector)) {
    if (candidate.textContent === text && candidate instanceof HTMLElement) {
      return candidate;
    }
  }
  throw new Error(`Missing ${selector} text: ${text}`);
}

function sampleFor(container: ParentNode, path: string): HTMLElement {
  for (const candidate of container.querySelectorAll("[aria-label]")) {
    if (
      candidate.getAttribute("aria-label") === `Visual sample for ${path}` &&
      candidate instanceof HTMLElement
    ) {
      return candidate;
    }
  }
  throw new Error(`Missing visual sample for ${path}`);
}

function sampleRows(): readonly AssetTokenRow[] {
  const selectedPaths = new Set<string>();
  for (const kind of visualKinds(DEFAULT_THEME_TOKEN_ROWS)) {
    const row = DEFAULT_THEME_TOKEN_ROWS.find((candidate) => candidate.visual.kind === kind);
    if (row !== undefined) {
      selectedPaths.add(row.path);
    }
  }
  for (const layer of LAYERS) {
    const row = DEFAULT_THEME_TOKEN_ROWS.find((candidate) => candidate.layer === layer);
    if (row !== undefined) {
      selectedPaths.add(row.path);
    }
  }
  return DEFAULT_THEME_TOKEN_ROWS.filter((row) => selectedPaths.has(row.path));
}

describe("ThemeInspector", () => {
  it("uses every default token row when no rows are injected", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ThemeInspector />);

    expect(host.querySelectorAll("[data-theme-token-row]")).toHaveLength(
      DEFAULT_THEME_TOKEN_ROWS.length,
    );
    expect(host.querySelector("[data-theme-overview]")?.textContent).toContain(
      "Default design system",
    );
    expect(host.querySelector('[data-theme-overview-panel="system-map"]')?.textContent).toContain(
      "Foundation",
    );
    expect(host.querySelector('[data-theme-overview-panel="recipe-map"]')?.textContent).toContain(
      "Button.tone",
    );
    expect(
      host.querySelector('[data-theme-overview-panel="screen-result"]')?.textContent,
    ).toContain("Revenue overview");
    expect(host.querySelector('[data-token-path="recipe.button.primaryBg"]')).not.toBeNull();
  }, 15_000);

  it("renders visual samples and token values for every default theme layer", () => {
    const rows = sampleRows();
    const container = renderThemeInspector(rows);
    const root = container.querySelector("[data-facet-theme-inspector]");

    expect(root).toBeInstanceOf(HTMLElement);
    expect((root as HTMLElement).style.display).toBe("grid");
    expect((root as HTMLElement).style.gridTemplateColumns).toContain("minmax");
    expect((root as HTMLElement).style.getPropertyValue("--facet-semantic-action-primary-bg")).toBe(
      DEFAULT_THEME_CSS_VARS["--facet-semantic-action-primary-bg"],
    );

    for (const layer of LAYERS) {
      const layerRows = rowsFor(layer, rows);
      const section = region(container, `${titleCase(layer)} theme tokens`);
      expect(section.getAttribute("data-token-layer")).toBe(layer);
      expect(section.querySelectorAll("[data-theme-token-row]")).toHaveLength(layerRows.length);

      for (const row of layerRows) {
        const renderedRow = tokenRow(section, row.path);
        expect(renderedRow.getAttribute("data-token-kind")).toBe(row.visual.kind);
        expect(renderedRow.getAttribute("data-token-group")).toBe(
          row.layer === "recipe" ? row.namespace : row.group,
        );
        expect(textIn(renderedRow, "code", row.path)).toBeTruthy();
        expect(textIn(renderedRow, "code", row.value)).toBeTruthy();

        const sample = sampleFor(renderedRow, row.path);
        expect(sample.getAttribute("data-token-visual-kind")).toBe(row.visual.kind);
        expect(sample.getAttribute("data-token-visual-value")).toBe(row.visual.value);
        expect(sample.getAttribute("data-token-css-variable")).toBe(row.cssVariable);
        expect(sample.getAttribute("data-token-css-reference")).toBe(row.cssReference);
        expect((sample as HTMLElement).style.cssText.length).toBeGreaterThan(0);
      }
    }

    for (const kind of visualKinds(rows)) {
      expect(container.querySelector(`[data-token-visual-kind="${kind}"]`)).toBeTruthy();
    }
  });

  it("renders length tokens as visible usage samples", () => {
    const container = renderThemeInspector(DEFAULT_THEME_TOKEN_ROWS);

    const fontSizeSample = sampleFor(container, "recipe.text.titleFontSize");
    expect(fontSizeSample.textContent).toBe("Ag");
    expect(fontSizeSample.getAttribute("style")).toContain("font-size:");

    const radiusSample = sampleFor(container, "recipe.empty.radius");
    expect(radiusSample.textContent).toBe("r");
    expect(radiusSample.getAttribute("style")).toContain("border-radius:");

    const paddingSample = sampleFor(container, "recipe.empty.padding");
    expect(paddingSample.textContent).toBe("pad");
    expect(paddingSample.getAttribute("style")).toContain("box-shadow:");

    const strokeSample = sampleFor(container, "semantic.focus.ringWidth");
    expect(strokeSample.textContent).toBe("line");
    expect(strokeSample.getAttribute("style")).toContain("border-width:");

    const colorSample = sampleFor(container, "semantic.canvas.inverse");
    expect(colorSample.textContent).toBe("");
  }, 30_000);

  it("imports only React and the theme token model", () => {
    const source = readFileSync("packages/tools/quickstart/src/page/theme-inspector.tsx", "utf8");
    const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    );

    expect(new Set(importSpecifiers)).toEqual(new Set(["react", "./asset-token-model.js"]));
    expect(source).not.toMatch(
      /\b(?:fetch|SseTransport|LocalTransport|StageRenderer|useFacet|sendEvent|sendMessage)\b/,
    );
    expect(source).not.toMatch(/["']@facet\/(?:server|client|runtime|react|agent-client)["']/);
  });
});
