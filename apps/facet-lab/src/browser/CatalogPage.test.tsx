// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DEFAULT_THEME } from "@facet/assets";

import { createCatalogModel } from "../catalog/catalog-model.js";
import { CatalogPage } from "./CatalogPage.js";

afterEach(cleanup);

describe("CatalogPage", () => {
  it("connects each preview to its Facet document and separate package definition", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CatalogPage
        status="ready"
        catalog={{ ...createCatalogModel(), assetDigest: "sha256:test-catalog" }}
        theme={DEFAULT_THEME}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Only Bricks render on the stage" })).toBeNull();

    const bricksCategory = screen.getByRole("button", { name: "Bricks (11/11)" });
    expect(within(bricksCategory).getByText("Bricks")).toBeTruthy();
    expect(within(bricksCategory).getByText("11/11")).toBeTruthy();
    expect(within(bricksCategory).queryByText(/safe UI building blocks/u)).toBeNull();

    const box = screen.getByRole("button", { name: "Inspect Brick box" });
    expect(within(box).getByText("Brick")).toBeTruthy();
    expect(within(box).getByText("box")).toBeTruthy();
    expect(within(box).queryByText(/sole container Brick/u)).toBeNull();
    expect(within(box).queryByText("render")).toBeNull();

    expect(screen.getByRole("heading", { name: "This frame is rendered by Facet." })).toBeTruthy();
    expect(screen.getByText("Box content")).toBeTruthy();
    expect(screen.getByLabelText("box preview").textContent).toContain(
      "The catalog controls around it are the Lab’s React shell.",
    );

    const previewTab = screen.getByRole("tab", { name: "Preview" });
    const documentTab = screen.getByRole("tab", { name: "Facet document" });
    const definitionTab = screen.getByRole("tab", { name: "Package definition" });
    expect(previewTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(documentTab);
    expect(documentTab.getAttribute("aria-selected")).toBe("true");
    const documentPanel = screen.getByRole("tabpanel", { name: "Facet document" });
    expect(
      within(documentPanel).getByRole("heading", { name: "Validated Facet document" }),
    ).toBeTruthy();
    expect(within(documentPanel).getByText("Passed")).toBeTruthy();
    expect(within(documentPanel).getByLabelText("Facet document JSON").textContent).toContain(
      '"root": "root"',
    );
    fireEvent.click(within(documentPanel).getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]?.[0]).toContain('"root": "root"');
    expect(within(documentPanel).getByText("Copied to clipboard.")).toBeTruthy();

    fireEvent.click(definitionTab);
    expect(definitionTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByText(/Core and agent tools read this contract to know which content fields/u),
    ).toBeTruthy();
    expect(screen.getByText(/This JSON is from the @facet\/core Brick contract/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Presets (43/43)" }));
    fireEvent.click(screen.getByRole("tab", { name: "Package definition" }));
    expect(screen.getByText(/The renderer applies this data when a/u)).toBeTruthy();
    expect(screen.getByText(/This JSON is from the @facet\/assets default Theme/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Patterns (17/17)" }));
    fireEvent.click(screen.getByRole("tab", { name: "Package definition" }));
    expect(screen.getByText(/Agents can read and adapt this validated example tree/u)).toBeTruthy();
    expect(screen.getByText(/This JSON is from the @facet\/assets default Patterns/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Token values (106/106)" }));
    expect(screen.getByRole("heading", { name: "This frame is rendered by Facet." })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Facet document" }));
    expect(screen.getByLabelText("Facet document JSON").textContent).toContain('"style"');
    fireEvent.click(screen.getByRole("tab", { name: "Package definition" }));
    expect(screen.getByText(/Themes give this token a concrete value/u)).toBeTruthy();
    expect(
      screen.getByText(/This JSON is from the @facet\/core style-value contract/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fixed choices (51/51)" }));
    expect(screen.getByRole("heading", { name: "This frame is rendered by Facet." })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Package definition" }));
    expect(screen.getByText(/Core accepts this exact choice in the/u)).toBeTruthy();
  });
});
