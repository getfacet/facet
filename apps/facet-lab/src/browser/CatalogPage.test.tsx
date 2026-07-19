// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DEFAULT_THEME } from "@facet/assets";

import { createCatalogModel } from "../catalog/catalog-model.js";
import { CatalogPage } from "./CatalogPage.js";

afterEach(cleanup);

describe("CatalogPage", () => {
  it("explains the vocabulary and separates readable item names from source data", () => {
    render(
      <CatalogPage
        status="ready"
        catalog={{ ...createCatalogModel(), assetDigest: "sha256:test-catalog" }}
        theme={DEFAULT_THEME}
      />,
    );

    expect(screen.getByRole("heading", { name: "Only Bricks render on the stage" })).toBeTruthy();
    expect(screen.getByText("Bricks are the UI.")).toBeTruthy();
    expect(screen.getByText("Presets style one Brick.")).toBeTruthy();
    expect(screen.getByText("Patterns stay outside the stage.")).toBeTruthy();

    const box = screen.getByRole("button", { name: "Inspect Brick box" });
    expect(within(box).getByText("Brick")).toBeTruthy();
    expect(within(box).getByText("box")).toBeTruthy();
    expect(within(box).queryByText("render")).toBeNull();

    expect(screen.getByRole("heading", { name: "This frame is rendered by Facet." })).toBeTruthy();
    expect(screen.getByText("Box content")).toBeTruthy();
    expect(screen.getByLabelText("box preview").textContent).toContain(
      "The catalog controls around it are the Lab’s React shell.",
    );

    const sourceData = screen.getByText("Validated source data (advanced)").closest("details");
    expect(sourceData?.hasAttribute("open")).toBe(false);
    expect(
      screen.getByText(/Core and agent tools read this contract to know which content fields/u),
    ).toBeTruthy();
    expect(screen.getByText(/This JSON is from the @facet\/core Brick contract/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Presets (43/43)" }));
    expect(screen.getByText(/The renderer applies this data when a/u)).toBeTruthy();
    expect(
      screen.getByText(/currently selected Theme asset snapshot used for this item/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Patterns (17/17)" }));
    expect(screen.getByText(/Agents can read and adapt this validated example tree/u)).toBeTruthy();
    expect(
      screen.getByText(/currently selected Pattern asset snapshot used for this item/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Token values (106/106)" }));
    expect(
      screen.getByRole("heading", { name: "This value changes how a Brick is allowed to render." }),
    ).toBeTruthy();
    expect(screen.getByText(/Themes give this token a concrete value/u)).toBeTruthy();
    expect(
      screen.getByText(/This JSON is from the @facet\/core style-value contract/u),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fixed choices (39/39)" }));
    expect(screen.getByText(/Core accepts this exact choice in the/u)).toBeTruthy();
  });
});
