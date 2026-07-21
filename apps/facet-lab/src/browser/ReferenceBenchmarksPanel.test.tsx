// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenariosPage } from "./ScenariosPage.js";
import { ReferenceComparisonView } from "./ReferenceComparisonView.js";
import { ReferenceBenchmarksPanel } from "./ReferenceBenchmarksPanel.js";
import { presentReferenceBenchmarks } from "./reference-benchmark-presenter.js";
import { presentReferenceComparison } from "./reference-comparison-presenter.js";
import type { LabCapabilities } from "./run-config.js";
import {
  REFERENCE_BENCHMARK_IDS,
  REFERENCE_BENCHMARKS,
} from "../scenarios/reference-benchmarks.js";

const CAPABILITIES: LabCapabilities = {
  deterministic: {
    mode: "deterministic",
    provider: "openai",
    available: true,
    models: ["facet-lab-deterministic-v1"],
    defaultModel: "facet-lab-deterministic-v1",
  },
  providers: {
    openai: { provider: "openai", available: true, models: ["gpt-test"], defaultModel: "gpt-test" },
    anthropic: {
      provider: "anthropic",
      available: false,
      models: ["claude-test"],
      defaultModel: "claude-test",
    },
  },
};

afterEach(cleanup);

describe("ReferenceBenchmarksPanel", () => {
  it("selects all static benchmark previews without a Lab client or provider run", () => {
    const onViewChange = vi.fn();
    render(<ReferenceBenchmarksPanel onViewChange={onViewChange} />);

    expect(screen.getByRole("heading", { name: "Reference benchmarks" })).toBeTruthy();
    expect(screen.getByText(/0 product-grade candidates/u)).toBeTruthy();
    expect(screen.getByText(/Renderable only means the Facet document validates/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start new run" })).toBeNull();

    const catalog = screen.getByLabelText("Reference benchmark catalog");
    const buttons = within(catalog).getAllByRole("button");
    expect(buttons).toHaveLength(REFERENCE_BENCHMARK_IDS.length);
    for (const button of buttons) {
      fireEvent.click(button);
      const benchmarkName = button.querySelector("span")?.textContent ?? "";
      const detail = screen.getByRole("heading", {
        name: benchmarkName,
      });
      expect(detail).toBeTruthy();
      expect(screen.getByText("Authoring protocol")).toBeTruthy();
      expect(screen.getByText("Product-grade status")).toBeTruthy();
      expect(screen.getByText(/Not product-grade/u)).toBeTruthy();
      expect(screen.getByText("Known fidelity gaps")).toBeTruthy();
      expect(screen.getByText("Design QA checklist")).toBeTruthy();
      expect(screen.getByLabelText(/benchmark preview/u)).toBeTruthy();
    }
    expect(onViewChange).not.toHaveBeenCalled();
  }, 20_000);

  it("updates viewport and color mode as local preview state", () => {
    const onViewChange = vi.fn();
    render(<ReferenceBenchmarksPanel onViewChange={onViewChange} />);

    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "mobile" } });
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "dark" } });

    const preview = screen.getByLabelText(/benchmark preview/u);
    expect(preview.getAttribute("data-reference-preview-viewport")).toBe("mobile");
    expect(preview.getAttribute("data-reference-preview-color-mode")).toBe("dark");
    expect(screen.getByText("supabase-table-editor")).toBeTruthy();
    expect(screen.getByText("Rendered with benchmark-specific custom assets")).toBeTruthy();
    expect(onViewChange).toHaveBeenLastCalledWith({
      benchmarkId: "supabase-table-editor",
      viewport: "mobile",
      colorMode: "dark",
    });
  });

  it("opens visual comparison mode with chrome-free reference and Facet panels", () => {
    render(<ReferenceBenchmarksPanel initialBenchmarkId="google-search-console-performance" />);

    fireEvent.click(screen.getByRole("button", { name: "Open visual comparison" }));

    const comparison = screen.getByTestId("reference-comparison");
    expect(comparison.getAttribute("data-reference-comparison-viewport")).toBe("desktop");
    expect(comparison.getAttribute("data-reference-comparison-status")).toBe("ready");
    const reference = within(comparison).getByRole("img", { name: /Google Search Console/u });
    const facet = within(comparison).getByTestId("reference-comparison-facet-surface");
    expect(reference.style.maxWidth).toBe("1440px");
    expect(facet.style.maxWidth).toBe("1440px");
    expect(facet.style.aspectRatio).toBe("1440 / 900");
    expect(comparison.querySelector(".lab-topbar")).toBeNull();
    expect(comparison.querySelector(".lab-primary-nav")).toBeNull();
  });

  it("keeps the Facet panel visible when the reference snapshot is unavailable", () => {
    render(<ReferenceBenchmarksPanel initialBenchmarkId="supabase-table-editor" />);

    fireEvent.click(screen.getByRole("button", { name: "Open visual comparison" }));

    const comparison = screen.getByTestId("reference-comparison");
    expect(within(comparison).getByText("Reference unavailable for this viewport")).toBeTruthy();
    expect(within(comparison).getByTestId("reference-comparison-facet-surface")).toBeTruthy();
  });

  it("uses closed local classification controls and latest viewport state", () => {
    render(<ReferenceBenchmarksPanel initialBenchmarkId="google-search-console-performance" />);

    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "mobile" } });
    fireEvent.click(screen.getByRole("button", { name: "Open visual comparison" }));
    fireEvent.change(screen.getByLabelText("Comparison verdict"), {
      target: { value: "major-drift" },
    });

    const comparison = screen.getByTestId("reference-comparison");
    expect(comparison.getAttribute("data-reference-comparison-viewport")).toBe("mobile");
    expect(screen.getByTestId("reference-comparison-facet-surface").style.maxWidth).toBe("390px");
    expect((screen.getByLabelText("Comparison verdict") as HTMLSelectElement).value).toBe(
      "major-drift",
    );
    expect(within(comparison).getByText(/The render departs materially/u)).toBeTruthy();
    expect(within(comparison).getByText("Reference unavailable for this viewport")).toBeTruthy();
  });

  it("shows a panel-scoped diagnostic if comparison rendering fails", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const selected = presentReferenceBenchmarks({
      benchmarks: REFERENCE_BENCHMARKS,
      selectedId: "google-search-console-performance",
    }).selected;
    const comparison = presentReferenceComparison({
      selected,
      viewport: "desktop",
      classification: "blocked",
    });

    try {
      render(
        <ReferenceComparisonView
          comparison={comparison}
          onClassificationChange={() => undefined}
          renderFacet={() => {
            throw new Error("Renderer failed.");
          }}
        />,
      );

      expect(screen.getByRole("alert").textContent).toContain(
        "Facet render unavailable in comparison mode.",
      );
      expect(screen.getByRole("img", { name: /Google Search Console/u })).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps reference benchmarks separate from official scenario run configuration", async () => {
    render(<ScenariosPage capabilities={CAPABILITIES} />);

    expect(screen.getByRole("heading", { name: "Official scenarios" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reference benchmarks" })).toBeTruthy();
    expect(
      within(screen.getByLabelText("Official scenario catalog")).getAllByRole("article"),
    ).toHaveLength(8);
    expect(
      within(screen.getByLabelText("Reference benchmark catalog")).getAllByRole("button"),
    ).toHaveLength(REFERENCE_BENCHMARK_IDS.length);
    expect(screen.getByLabelText("Scenario").textContent).not.toContain(
      "Commerce product and checkout",
    );
  });
});
