// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_THEME } from "@facet/assets";

import { MAX_ASSET_BUNDLE_BYTES, type JsonValue } from "../shared/run-contract.js";
import { AssetImportPanel } from "./AssetImportPanel.js";

afterEach(cleanup);

function currentAssets() {
  return {
    source: "default" as const,
    digest: "sha256:default",
    theme: DEFAULT_THEME,
  };
}

function fileList(file: File): FileList {
  return {
    0: file,
    length: 1,
    item: (index: number) => (index === 0 ? file : null),
    [Symbol.iterator]: () => [file][Symbol.iterator](),
  };
}

function submitForm(): void {
  const form = screen.getByRole("button", { name: "Apply asset source" }).closest("form");
  if (form === null) throw new Error("asset form is missing");
  fireEvent.submit(form);
}

describe("AssetImportPanel", () => {
  it("rejects an oversized file in the browser before calling the API", async () => {
    const importAssets = vi.fn();
    render(
      <AssetImportPanel
        api={{ selectDefaultAssets: vi.fn(), importAssets }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Custom Theme and Patterns" }));
    const file = new File([new Uint8Array(MAX_ASSET_BUNDLE_BYTES + 1)], "assets.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Custom asset JSON bundle"), {
      target: { files: fileList(file) },
    });
    submitForm();

    expect((await screen.findByRole("status")).textContent).toBe(
      "The asset bundle is empty or exceeds the 24 MiB limit.",
    );
    expect(importAssets).not.toHaveBeenCalled();
  });

  it("propagates one validated successful selection to future runs", async () => {
    const imported = JSON.parse(
      JSON.stringify({
        accepted: true,
        snapshot: { source: "custom", digest: "sha256:custom", theme: DEFAULT_THEME },
        issues: [],
      }),
    ) as JsonValue;
    const importAssets = vi.fn().mockResolvedValue(imported);
    const onAssetsChanged = vi.fn();
    render(
      <AssetImportPanel
        api={{ selectDefaultAssets: vi.fn(), importAssets }}
        current={currentAssets()}
        onAssetsChanged={onAssetsChanged}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Custom Theme and Patterns" }));
    fireEvent.change(screen.getByLabelText("Custom asset JSON bundle"), {
      target: {
        files: fileList(new File(["{}"], "assets.json", { type: "application/json" })),
      },
    });
    submitForm();

    await waitFor(() =>
      expect(onAssetsChanged).toHaveBeenCalledWith({
        source: "custom",
        digest: "sha256:custom",
        theme: DEFAULT_THEME,
      }),
    );
    expect(importAssets).toHaveBeenCalledWith({});
    expect(screen.getByRole("status").textContent).toBe(
      "Custom assets were validated and selected for future runs.",
    );
  });
});
