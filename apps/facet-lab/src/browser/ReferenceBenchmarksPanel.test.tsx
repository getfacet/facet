// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenariosPage } from "./ScenariosPage.js";
import { ReferenceBenchmarksPanel } from "./ReferenceBenchmarksPanel.js";
import type { LabCapabilities } from "./run-config.js";
import { REFERENCE_BENCHMARK_IDS } from "../scenarios/reference-benchmarks.js";

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
  }, 10_000);

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
