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
  const form = screen
    .getByRole("button", { name: /Use package defaults|Validate and use custom assets/ })
    .closest("form");
  if (form === null) throw new Error("asset form is missing");
  fireEvent.submit(form);
}

describe("AssetImportPanel", () => {
  it("keeps every asset control disabled under an external run-start lock", () => {
    const selectDefaultAssets = vi.fn();
    render(
      <AssetImportPanel
        api={{ getAssets: vi.fn(), selectDefaultAssets, importAssets: vi.fn() }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
        onAssetsUnavailable={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("group", { name: "Assets for new runs" })).toHaveProperty(
      "disabled",
      true,
    );
    submitForm();
    expect(selectDefaultAssets).not.toHaveBeenCalled();
  });

  it("keeps the custom bundle control hidden until custom assets are selected", () => {
    render(
      <AssetImportPanel
        api={{ getAssets: vi.fn(), selectDefaultAssets: vi.fn(), importAssets: vi.fn() }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
        onAssetsUnavailable={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Custom asset JSON bundle")).toBeNull();
    expect(screen.getByRole("button", { name: "Use package defaults" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Custom Theme and Patterns" }));

    expect(screen.getByLabelText("Custom asset JSON bundle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Validate and use custom assets" })).toBeTruthy();
  });

  it("rejects an oversized file in the browser before calling the API", async () => {
    const importAssets = vi.fn();
    render(
      <AssetImportPanel
        api={{ getAssets: vi.fn(), selectDefaultAssets: vi.fn(), importAssets }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
        onAssetsUnavailable={vi.fn()}
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
    const onBusyChange = vi.fn();
    render(
      <AssetImportPanel
        api={{ getAssets: vi.fn(), selectDefaultAssets: vi.fn(), importAssets }}
        current={currentAssets()}
        onAssetsChanged={onAssetsChanged}
        onAssetsUnavailable={vi.fn()}
        onBusyChange={onBusyChange}
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
    expect(importAssets).toHaveBeenCalledWith({}, { signal: expect.anything() });
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("status").textContent).toBe(
      "Custom assets were validated and selected for future runs.",
    );
  });

  it("reconciles with the server when a mutation response is interrupted", async () => {
    const recovered = JSON.parse(
      JSON.stringify({ source: "custom", digest: "sha256:recovered", theme: DEFAULT_THEME }),
    ) as JsonValue;
    const onAssetsChanged = vi.fn();
    const onAssetsUnavailable = vi.fn();
    render(
      <AssetImportPanel
        api={{
          getAssets: vi.fn().mockResolvedValue(recovered),
          selectDefaultAssets: vi.fn(),
          importAssets: vi.fn().mockRejectedValue(new Error("response lost")),
        }}
        current={currentAssets()}
        onAssetsChanged={onAssetsChanged}
        onAssetsUnavailable={onAssetsUnavailable}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Custom Theme and Patterns" }));
    const originalFileInput = screen.getByLabelText("Custom asset JSON bundle") as HTMLInputElement;
    fireEvent.change(originalFileInput, {
      target: {
        files: fileList(new File(["{}"], "assets.json", { type: "application/json" })),
      },
    });
    submitForm();

    await waitFor(() =>
      expect(onAssetsChanged).toHaveBeenCalledWith({
        source: "custom",
        digest: "sha256:recovered",
        theme: DEFAULT_THEME,
      }),
    );
    expect(onAssetsUnavailable).not.toHaveBeenCalled();
    const recoveredFileInput = screen.getByLabelText(
      "Custom asset JSON bundle",
    ) as HTMLInputElement;
    expect(recoveredFileInput).not.toBe(originalFileInput);
    expect(recoveredFileInput.files?.length).toBe(0);
    expect(screen.getByRole("status").textContent).toBe(
      "The asset response was interrupted. The current server selection was restored.",
    );
  });

  it("blocks future runs when an interrupted mutation cannot be reconciled", async () => {
    const onAssetsUnavailable = vi.fn();
    render(
      <AssetImportPanel
        api={{
          getAssets: vi.fn().mockRejectedValue(new Error("still offline")),
          selectDefaultAssets: vi.fn().mockRejectedValue(new Error("response lost")),
          importAssets: vi.fn(),
        }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
        onAssetsUnavailable={onAssetsUnavailable}
      />,
    );

    submitForm();

    await waitFor(() => expect(onAssetsUnavailable).toHaveBeenCalledTimes(1));
  });

  it("times out a stalled mutation and releases the global busy lock", async () => {
    const onAssetsUnavailable = vi.fn();
    const onBusyChange = vi.fn();
    const selectDefaultAssets = vi.fn(
      (options?: { readonly signal?: AbortSignal }): Promise<JsonValue> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    render(
      <AssetImportPanel
        api={{
          getAssets: vi.fn().mockRejectedValue(new Error("still offline")),
          selectDefaultAssets,
          importAssets: vi.fn(),
        }}
        current={currentAssets()}
        onAssetsChanged={vi.fn()}
        onAssetsUnavailable={onAssetsUnavailable}
        onBusyChange={onBusyChange}
        requestTimeoutMs={5}
      />,
    );

    submitForm();

    await waitFor(() => expect(onAssetsUnavailable).toHaveBeenCalledTimes(1));
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
});
