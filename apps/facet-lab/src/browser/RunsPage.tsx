import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import {
  MAX_EVIDENCE_BUNDLE_BYTES,
  PROVIDERS,
  RUN_MODES,
  RUN_STATUSES,
  type RunEvidenceV1,
} from "../shared/run-contract.js";
import { createLabApiClient, type LabApiClient } from "./api-client.js";
import { presentRunHistory, type RunAction, type RunHistoryFilters } from "./run-presenter.js";

export interface RunsPageProps {
  readonly api?: LabApiClient;
  readonly initialFilters?: RunHistoryFilters;
  readonly onInspect: (runId: string) => void;
  readonly onExport?: (runId: string, bundle: string) => void;
}

type LoadState = "loading" | "ready" | "error";

export function RunsPage({
  api: apiProp,
  initialFilters = {},
  onInspect,
  onExport,
}: RunsPageProps): ReactNode {
  const api = useMemo(() => apiProp ?? createLabApiClient(), [apiProp]);
  const [runs, setRuns] = useState<readonly RunEvidenceV1[]>([]);
  const [filters, setFilters] = useState<RunHistoryFilters>(initialFilters);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoadState("loading");
    try {
      setRuns(await api.listRuns({ limit: 100 }));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };

  useEffect(() => {
    let active = true;
    void api.listRuns({ limit: 100 }).then(
      (history) => {
        if (!active) return;
        setRuns(history);
        setLoadState("ready");
      },
      () => {
        if (active) setLoadState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const presentation = useMemo(() => presentRunHistory(runs, filters), [runs, filters]);

  const updateFilter =
    (key: keyof RunHistoryFilters) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      const value = event.currentTarget.value;
      setFilters((current) => ({ ...current, [key]: value.length === 0 ? undefined : value }));
    };

  const runAction = async (runId: string, action: RunAction): Promise<void> => {
    if (actionRunId !== null) return;
    if (action === "inspect") {
      onInspect(runId);
      return;
    }
    setActionRunId(runId);
    setMessage(null);
    try {
      if (action === "cancel") await api.cancelRun(runId);
      else if (action === "capture") await api.captureRun(runId);
      else if (action === "evaluate") await api.evaluateRun(runId, { kind: "recalculate" });
      else {
        const bundle = await api.exportRun(runId);
        onExport?.(runId, bundle);
      }
      setMessage(`${action} completed for run ${runId}.`);
      if (action !== "export") await load();
    } catch {
      setMessage(`${action} failed safely. The saved run was not changed.`);
    } finally {
      setActionRunId(null);
    }
  };

  const importRun = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (importing || actionRunId !== null) return;
    if (
      importFile === null ||
      importFile.size === 0 ||
      importFile.size > MAX_EVIDENCE_BUNDLE_BYTES
    ) {
      setMessage("Choose a non-empty Facet Lab run bundle no larger than 32 MiB.");
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      await api.importRun(await importFile.text());
      setImportFile(null);
      setMessage("Run bundle imported under a new local identity.");
      await load();
    } catch {
      setMessage("Run import failed safely. Trusted history was not changed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <main aria-labelledby="runs-heading">
      <header>
        <h1 id="runs-heading">Run history</h1>
        <p>Saved evidence is immutable. Actions append or derive new evidence.</p>
      </header>

      <form aria-label="Run history filters" onSubmit={(event) => event.preventDefault()}>
        <label>
          Search
          <input value={filters.query ?? ""} onChange={updateFilter("query")} type="search" />
        </label>
        <label>
          Status
          <select value={filters.status ?? ""} onChange={updateFilter("status")}>
            <option value="">All statuses</option>
            {RUN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode
          <select value={filters.mode ?? ""} onChange={updateFilter("mode")}>
            <option value="">All modes</option>
            {RUN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <select value={filters.provider ?? ""} onChange={updateFilter("provider")}>
            <option value="">All providers</option>
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
      </form>

      <form aria-label="Import run evidence" onSubmit={(event) => void importRun(event)}>
        <label htmlFor="run-import-file">Import a Facet Lab run bundle</label>
        <input
          id="run-import-file"
          type="file"
          accept="application/json,.json"
          disabled={importing || actionRunId !== null}
          onChange={(event) => setImportFile(event.currentTarget.files?.item(0) ?? null)}
        />
        <button type="submit" disabled={importing || actionRunId !== null}>
          {importing ? "Validating import…" : "Import run"}
        </button>
      </form>

      <p role="status" aria-live="polite">
        {loadState === "loading"
          ? "Loading run history."
          : loadState === "error"
            ? "Run history could not be loaded."
            : `${String(presentation.visible)} of ${String(presentation.total)} runs shown.`}
      </p>
      {message === null ? null : <p role="status">{message}</p>}
      {loadState === "error" ? <button onClick={() => void load()}>Retry history</button> : null}

      {loadState === "ready" && presentation.rows.length === 0 ? (
        <p>{presentation.emptyLabel}</p>
      ) : null}
      {presentation.rows.length > 0 ? (
        <table>
          <caption>Immutable Facet Lab runs</caption>
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Scenario</th>
              <th>Provider</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {presentation.rows.map((row) => (
              <tr key={`${row.runId}:${String(row.generation)}`}>
                <th scope="row">
                  <button onClick={() => onInspect(row.runId)}>{row.runId}</button>
                </th>
                <td>{row.statusLabel}</td>
                <td>{row.scenarioId}</td>
                <td>
                  {row.mode} · {row.provider} · {row.model}
                </td>
                <td>{row.createdAt}</td>
                <td>
                  {row.actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={actionRunId !== null}
                      onClick={() => void runAction(row.runId, action)}
                    >
                      {action}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
