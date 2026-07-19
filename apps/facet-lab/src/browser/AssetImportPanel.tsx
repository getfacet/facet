import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { validateTheme, type FacetTheme } from "@facet/core";

import { MAX_ASSET_BUNDLE_BYTES, type JsonValue } from "../shared/run-contract.js";
import type { LabApiClient } from "./api-client.js";

export interface AssetSelectionView {
  readonly source: "default" | "custom";
  readonly digest: string;
  readonly theme: FacetTheme;
}

export interface AssetImportPanelProps {
  readonly api: Pick<LabApiClient, "getAssets" | "selectDefaultAssets" | "importAssets">;
  readonly current: AssetSelectionView;
  readonly onAssetsChanged: (assets: AssetSelectionView) => void;
  readonly onAssetsUnavailable: () => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly disabled?: boolean;
  readonly requestTimeoutMs?: number;
}

interface ImportIssueView {
  readonly code: string;
  readonly message: string;
}

const DEFAULT_ASSET_REQUEST_TIMEOUT_MS = 30_000;

async function withRequestTimeout<T>(
  milliseconds: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selection(value: JsonValue): AssetSelectionView | undefined {
  if (
    !isRecord(value) ||
    (value.source !== "default" && value.source !== "custom") ||
    typeof value.digest !== "string" ||
    value.digest.length === 0 ||
    value.digest.length > 200
  ) {
    return undefined;
  }
  const theme = validateTheme(value.theme).theme;
  return theme === undefined
    ? undefined
    : Object.freeze({ source: value.source, digest: value.digest, theme });
}

function issues(value: unknown): readonly ImportIssueView[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(
    value.flatMap((candidate): readonly ImportIssueView[] => {
      if (
        !isRecord(candidate) ||
        typeof candidate.code !== "string" ||
        candidate.code.length === 0 ||
        candidate.code.length > 200 ||
        typeof candidate.message !== "string" ||
        candidate.message.length === 0 ||
        candidate.message.length > 20_000
      ) {
        return [];
      }
      return [Object.freeze({ code: candidate.code, message: candidate.message })];
    }),
  );
}

export function AssetImportPanel({
  api,
  current,
  onAssetsChanged,
  onAssetsUnavailable,
  onBusyChange,
  disabled = false,
  requestTimeoutMs = DEFAULT_ASSET_REQUEST_TIMEOUT_MS,
}: AssetImportPanelProps): ReactNode {
  const [source, setSource] = useState<AssetSelectionView["source"]>(current.source);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("The current selection will be used for new runs.");
  const [importIssues, setImportIssues] = useState<readonly ImportIssueView[]>([]);
  const [fileInputVersion, setFileInputVersion] = useState(0);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    onBusyChange?.(true);
    setImportIssues([]);
    try {
      if (source === "default") {
        const result = selection(
          await withRequestTimeout(requestTimeoutMs, (signal) =>
            api.selectDefaultAssets({ signal }),
          ),
        );
        if (result === undefined) throw new Error("invalid default asset response");
        onAssetsChanged(result);
        setMessage("Package default assets are selected for future runs.");
        return;
      }

      if (file === null) {
        setMessage("Choose a JSON Theme and Pattern bundle before importing.");
        return;
      }
      if (file.size === 0 || file.size > MAX_ASSET_BUNDLE_BYTES) {
        setMessage("The asset bundle is empty or exceeds the 24 MiB limit.");
        return;
      }
      let bundle: unknown;
      try {
        bundle = JSON.parse(await file.text()) as unknown;
      } catch {
        setMessage("The selected asset bundle is not valid JSON.");
        return;
      }
      const response = await withRequestTimeout(requestTimeoutMs, (signal) =>
        api.importAssets(bundle, { signal }),
      );
      if (!isRecord(response) || typeof response.accepted !== "boolean") {
        throw new Error("invalid custom asset response");
      }
      const nextIssues = issues(response.issues);
      setImportIssues(nextIssues);
      if (!response.accepted) {
        setMessage("Import was rejected. The current asset selection was not changed.");
        return;
      }
      const snapshot = selection(response.snapshot as JsonValue);
      if (snapshot === undefined || snapshot.source !== "custom") {
        throw new Error("invalid imported asset snapshot");
      }
      onAssetsChanged(snapshot);
      setMessage("Custom assets were validated and selected for future runs.");
    } catch {
      try {
        const recovered = selection(
          await withRequestTimeout(requestTimeoutMs, (signal) => api.getAssets({ signal })),
        );
        if (recovered === undefined) throw new Error("invalid recovered asset response");
        onAssetsChanged(recovered);
        setSource(recovered.source);
        setFile(null);
        setFileInputVersion((version) => version + 1);
        setMessage(
          "The asset response was interrupted. The current server selection was restored.",
        );
      } catch {
        onAssetsUnavailable();
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <section className="asset-import-panel" aria-label="Asset source">
      <p className="asset-current-selection">
        Current assets:{" "}
        <strong>{current.source === "default" ? "Package defaults" : "Custom"}</strong>
      </p>
      <code className="asset-snapshot-digest">{current.digest}</code>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy || disabled}>
          <legend>Assets for new runs</legend>
          <label className="asset-source-option">
            <input
              className="facet-lab-focusable"
              type="radio"
              name="asset-source"
              value="default"
              checked={source === "default"}
              onChange={() => setSource("default")}
            />
            <span>Package defaults</span>
          </label>
          <label className="asset-source-option">
            <input
              className="facet-lab-focusable"
              type="radio"
              name="asset-source"
              value="custom"
              checked={source === "custom"}
              onChange={() => setSource("custom")}
            />
            <span>Custom Theme and Patterns</span>
          </label>

          {source === "custom" ? (
            <label htmlFor="asset-bundle-file">
              Custom asset JSON bundle
              <input
                key={fileInputVersion}
                id="asset-bundle-file"
                className="facet-lab-focusable"
                type="file"
                accept="application/json,.json"
                required
                disabled={busy}
                onChange={(event) => setFile(event.currentTarget.files?.item(0) ?? null)}
              />
            </label>
          ) : null}

          <button className="facet-lab-focusable" type="submit" disabled={busy}>
            {busy
              ? "Validating assets…"
              : source === "default"
                ? "Use package defaults"
                : "Validate and use custom assets"}
          </button>
        </fieldset>
      </form>

      <p role="status" aria-live="polite">
        {message}
      </p>
      {importIssues.length === 0 ? null : (
        <section aria-labelledby="asset-import-diagnostics" role="alert">
          <h3 id="asset-import-diagnostics">Import diagnostics</h3>
          <ul>
            {importIssues.map((issue, index) => (
              <li key={`${issue.code}:${String(index)}`}>
                <strong>{issue.code}</strong>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
