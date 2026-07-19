import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, KeyboardEvent, ReactNode } from "react";

import { validateTheme } from "@facet/core";

import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { CatalogPage } from "./CatalogPage.js";
import { ComparePage } from "./ComparePage.js";
import { GeneratePage } from "./GeneratePage.js";
import { ReplayPage } from "./ReplayPage.js";
import { RunDetailPage } from "./RunDetailPage.js";
import { RunsPage } from "./RunsPage.js";
import { SandboxPage } from "./SandboxPage.js";
import { ScenariosPage } from "./ScenariosPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { AssetImportPanel, type AssetSelectionView } from "./AssetImportPanel.js";
import { createLabApiClient, type LabApiClient } from "./api-client.js";
import {
  LAB_ROUTES,
  PRODUCT_AREAS,
  isProductAreaActive,
  moveProductAreaFocus,
  pathForRun,
  resolveLabRoute,
  type ProductAreaId,
  type ResolvedLabRoute,
} from "./navigation.js";
import type { LabCapabilities } from "./run-config.js";

type Resource<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "error" };

type ChromeTheme = "light" | "dark";

export interface AppProps {
  readonly api?: LabApiClient;
  readonly initialPath?: string;
}

interface ShellErrorBoundaryProps {
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface ShellErrorBoundaryState {
  readonly failed: boolean;
}

class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  override state: ShellErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ShellErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Product pages already bound and classify expected failures. This boundary keeps an
    // unexpected render failure inside the selected route without exposing a stack.
  }

  override componentDidUpdate(previous: ShellErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="lab-fault" role="alert" aria-labelledby="lab-fault-title">
          <p className="lab-eyebrow">Bounded route failure</p>
          <h1 id="lab-fault-title">This workbench view could not be rendered.</h1>
          <p>
            Saved runs and the last valid stages were not changed. Choose another area to continue.
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}

function initialBrowserPath(initialPath: string | undefined): string {
  if (initialPath !== undefined) return initialPath;
  return typeof window === "undefined" ? "/catalog" : window.location.pathname;
}

function initialChromeTheme(): ChromeTheme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("facet-lab-chrome-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
}

function routeOwnsMain(route: ResolvedLabRoute): boolean {
  return (
    route.id === "catalog" ||
    route.id === "runs" ||
    route.id === "run-detail" ||
    route.id === "replay" ||
    route.id === "compare"
  );
}

function ResourceFailure({
  label,
  retry,
}: {
  readonly label: string;
  readonly retry: () => void;
}): ReactNode {
  return (
    <section className="lab-resource-state" role="alert">
      <p className="lab-eyebrow">Local API unavailable</p>
      <h1>{label} could not be loaded.</h1>
      <p>The workbench kept its current route and did not change saved evidence.</p>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </section>
  );
}

function ResourceLoading({ label }: { readonly label: string }): ReactNode {
  return (
    <section className="lab-resource-state" aria-busy="true">
      <p role="status">Loading {label}…</p>
    </section>
  );
}

function assetSelection(value: unknown): AssetSelectionView | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    (record["source"] !== "default" && record["source"] !== "custom") ||
    typeof record["digest"] !== "string" ||
    record["digest"].length === 0 ||
    record["digest"].length > 200
  ) {
    return undefined;
  }
  const theme = validateTheme(record["theme"]).theme;
  return theme === undefined
    ? undefined
    : Object.freeze({ source: record["source"], digest: record["digest"], theme });
}

function ReplayWorkspace({
  runs,
  requestedRunId,
  api,
}: {
  readonly runs: readonly RunEvidenceV1[];
  readonly requestedRunId: string | null;
  readonly api: LabApiClient;
}): ReactNode {
  const [selectedId, setSelectedId] = useState(requestedRunId ?? runs[0]?.run.runId ?? "");
  const [exactRun, setExactRun] = useState<Resource<RunEvidenceV1> | null>(
    requestedRunId === null ? null : { status: "loading" },
  );
  useEffect(() => {
    if (requestedRunId === null) {
      setExactRun(null);
      return;
    }
    let current = true;
    setSelectedId(requestedRunId);
    setExactRun({ status: "loading" });
    void api.getRun(requestedRunId).then(
      (value) => {
        if (current) setExactRun({ status: "ready", value });
      },
      () => {
        if (current) setExactRun({ status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [api, requestedRunId]);
  const availableRuns =
    exactRun?.status === "ready"
      ? [exactRun.value, ...runs.filter(({ run }) => run.runId !== exactRun.value.run.runId)]
      : runs;
  useEffect(() => {
    if (requestedRunId !== null || availableRuns.some(({ run }) => run.runId === selectedId))
      return;
    setSelectedId(availableRuns[0]?.run.runId ?? "");
  }, [availableRuns, requestedRunId, selectedId]);
  const selected = availableRuns.find(({ run }) => run.runId === selectedId) ?? null;
  return (
    <div className="lab-composed-page">
      <section className="lab-context-bar" aria-labelledby="replay-source-title">
        <div>
          <p className="lab-eyebrow">Replay source</p>
          <h2 id="replay-source-title">Choose an immutable run</h2>
        </div>
        <label>
          Recorded run
          <select value={selectedId} onChange={(event) => setSelectedId(event.currentTarget.value)}>
            <option value="">No saved run</option>
            {availableRuns.map(({ run }) => (
              <option key={run.runId} value={run.runId}>
                {run.scenarioId} · {run.runId}
              </option>
            ))}
          </select>
        </label>
      </section>
      {exactRun?.status === "loading" ? (
        <ResourceLoading label="requested replay" />
      ) : exactRun?.status === "error" ? (
        <section role="alert">The requested replay run could not be loaded.</section>
      ) : (
        <ReplayPage evidence={selected} />
      )}
    </div>
  );
}

function CompareWorkspace({ runs }: { readonly runs: readonly RunEvidenceV1[] }): ReactNode {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    runs.slice(0, 2).map(({ run }) => run.runId),
  );
  useEffect(() => {
    setSelectedIds((current) => {
      const retained = current.filter((id) => runs.some(({ run }) => run.runId === id)).slice(0, 4);
      if (retained.length >= 2 || runs.length < 2) return retained;
      return runs.slice(0, 2).map(({ run }) => run.runId);
    });
  }, [runs]);
  const compared = selectedIds.flatMap((id) => {
    const match = runs.find(({ run }) => run.runId === id);
    return match === undefined ? [] : [match];
  });
  const toggle = (runId: string): void => {
    setSelectedIds((current) =>
      current.includes(runId)
        ? current.filter((id) => id !== runId)
        : current.length >= 4
          ? current
          : [...current, runId],
    );
  };
  return (
    <div className="lab-composed-page">
      <section className="lab-context-bar" aria-labelledby="compare-source-title">
        <div>
          <p className="lab-eyebrow">Comparison set</p>
          <h2 id="compare-source-title">Choose two to four runs</h2>
        </div>
        <fieldset>
          <legend>Immutable sources</legend>
          {runs.map(({ run }) => (
            <label key={run.runId}>
              <input
                type="checkbox"
                checked={selectedIds.includes(run.runId)}
                disabled={!selectedIds.includes(run.runId) && selectedIds.length >= 4}
                onChange={() => toggle(run.runId)}
              />
              {run.scenarioId} · {run.runId}
            </label>
          ))}
        </fieldset>
      </section>
      <ComparePage runs={compared} />
    </div>
  );
}

export function App({ api: apiProp, initialPath }: AppProps = {}): ReactNode {
  const api = useMemo(() => apiProp ?? createLabApiClient(), [apiProp]);
  const [route, setRoute] = useState(() => resolveLabRoute(initialBrowserPath(initialPath)));
  const [theme, setTheme] = useState<ChromeTheme>(initialChromeTheme);
  const [catalog, setCatalog] = useState<Resource<unknown>>({ status: "loading" });
  const [assets, setAssets] = useState<Resource<AssetSelectionView>>({ status: "loading" });
  const [activeAssetChanges, setActiveAssetChanges] = useState(0);
  const [activeRunStarts, setActiveRunStarts] = useState(0);
  const [capabilities, setCapabilities] = useState<Resource<LabCapabilities>>({
    status: "loading",
  });
  const [runs, setRuns] = useState<Resource<readonly RunEvidenceV1[]>>({ status: "loading" });
  const mainRef = useRef<HTMLDivElement>(null);
  const areaRefs = useRef(new Map<ProductAreaId, HTMLAnchorElement>());
  const assetsBusy = activeAssetChanges > 0;
  const runStarting = activeRunStarts > 0;
  const handleAssetBusyChange = useCallback((busy: boolean): void => {
    setActiveAssetChanges((count) => Math.max(0, count + (busy ? 1 : -1)));
  }, []);
  const handleRunStartingChange = useCallback((starting: boolean): void => {
    setActiveRunStarts((count) => Math.max(0, count + (starting ? 1 : -1)));
  }, []);

  const loadCatalog = useCallback((): void => {
    setCatalog({ status: "loading" });
    void api.getCatalog().then(
      (value) => setCatalog({ status: "ready", value }),
      () => setCatalog({ status: "error" }),
    );
  }, [api]);
  const loadCapabilities = useCallback((): void => {
    setCapabilities({ status: "loading" });
    void api.getCapabilities().then(
      (value) => setCapabilities({ status: "ready", value }),
      () => setCapabilities({ status: "error" }),
    );
  }, [api]);
  const loadAssets = useCallback((): void => {
    setAssets({ status: "loading" });
    void api.getAssets().then(
      (value) => {
        const selection = assetSelection(value);
        setAssets(
          selection === undefined ? { status: "error" } : { status: "ready", value: selection },
        );
      },
      () => setAssets({ status: "error" }),
    );
  }, [api]);
  const retryAssets = useCallback((): void => {
    loadAssets();
    loadCatalog();
  }, [loadAssets, loadCatalog]);
  const loadRuns = useCallback((): void => {
    setRuns({ status: "loading" });
    void api.listRuns({ limit: 100 }).then(
      (value) => setRuns({ status: "ready", value }),
      () => setRuns({ status: "error" }),
    );
  }, [api]);

  useEffect(() => {
    loadCatalog();
    loadCapabilities();
    loadAssets();
    loadRuns();
  }, [loadAssets, loadCapabilities, loadCatalog, loadRuns]);

  useEffect(() => {
    if (initialPath !== undefined || typeof window === "undefined") return;
    const onPopState = (): void => setRoute(resolveLabRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialPath]);

  useEffect(() => {
    document.documentElement.dataset["labTheme"] = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("facet-lab-chrome-theme", theme);
  }, [theme]);

  const navigate = (path: string, focusMain = true): void => {
    const next = resolveLabRoute(path);
    if (typeof window !== "undefined" && initialPath === undefined)
      window.history.pushState({}, "", path);
    setRoute(next);
    if (focusMain) requestAnimationFrame(() => mainRef.current?.focus());
  };

  const handleAreaKey = (event: KeyboardEvent<HTMLAnchorElement>, current: ProductAreaId): void => {
    const target = moveProductAreaFocus(current, event.key);
    if (target === null) return;
    event.preventDefault();
    areaRefs.current.get(target)?.focus();
  };

  const activeArea = PRODUCT_AREAS.find(({ id }) => id === route.areaId);
  const secondaryRoutes = LAB_ROUTES.filter(
    ({ areaId, id }) => areaId === route.areaId && id !== "run-detail",
  );

  const resourcePage = (): ReactNode => {
    switch (route.id) {
      case "catalog":
        return assets.status === "loading" ? (
          <ResourceLoading label="asset selection" />
        ) : assets.status === "error" ? (
          <ResourceFailure label="Asset selection" retry={retryAssets} />
        ) : (
          <CatalogPage
            status={catalog.status}
            theme={assets.value.theme}
            {...(catalog.status === "ready" ? { catalog: catalog.value } : {})}
            {...(catalog.status === "error"
              ? { errorMessage: "The package catalog could not be loaded." }
              : {})}
          />
        );
      case "generate":
        return capabilities.status === "loading" ? (
          <ResourceLoading label="capabilities" />
        ) : capabilities.status === "error" ? (
          <ResourceFailure label="Run capabilities" retry={loadCapabilities} />
        ) : assets.status === "loading" ? (
          <ResourceLoading label="asset selection" />
        ) : assets.status === "error" ? (
          <ResourceFailure label="Asset selection" retry={retryAssets} />
        ) : (
          <GeneratePage
            client={api}
            capabilities={capabilities.value}
            theme={assets.value.theme}
            onRunStarted={loadRuns}
            assetSettingsBusy={assetsBusy}
            onStartingChange={handleRunStartingChange}
            assetSettings={
              <AssetImportPanel
                api={api}
                current={assets.value}
                disabled={assetsBusy || runStarting}
                onBusyChange={handleAssetBusyChange}
                onAssetsChanged={(next) => {
                  setAssets({ status: "ready", value: next });
                  loadCatalog();
                }}
                onAssetsUnavailable={() => setAssets({ status: "error" })}
              />
            }
          />
        );
      case "scenarios":
        return capabilities.status === "loading" ? (
          <ResourceLoading label="capabilities" />
        ) : capabilities.status === "error" ? (
          <ResourceFailure label="Scenario capabilities" retry={loadCapabilities} />
        ) : assets.status === "loading" ? (
          <ResourceLoading label="asset selection" />
        ) : assets.status === "error" ? (
          <ResourceFailure label="Asset selection" retry={retryAssets} />
        ) : (
          <ScenariosPage
            client={api}
            capabilities={capabilities.value}
            theme={assets.value.theme}
            assetSettingsBusy={assetsBusy}
            onRunStarted={loadRuns}
            onStartingChange={handleRunStartingChange}
          />
        );
      case "runs":
        return <RunsPage api={api} onInspect={(runId) => navigate(pathForRun(runId))} />;
      case "run-detail":
        return route.runId === null ? (
          <ResourceFailure label="Run detail" retry={() => navigate("/runs")} />
        ) : (
          <RunDetailPage
            key={route.runId}
            runId={route.runId}
            api={api}
            onBack={() => navigate("/runs")}
          />
        );
      case "replay":
        return runs.status === "loading" ? (
          <ResourceLoading label="run evidence" />
        ) : runs.status === "error" ? (
          <ResourceFailure label="Replay evidence" retry={loadRuns} />
        ) : (
          <ReplayWorkspace runs={runs.value} requestedRunId={route.runId} api={api} />
        );
      case "compare":
        return runs.status === "loading" ? (
          <ResourceLoading label="run evidence" />
        ) : runs.status === "error" ? (
          <ResourceFailure label="Comparison evidence" retry={loadRuns} />
        ) : (
          <CompareWorkspace runs={runs.value} />
        );
      case "sandbox":
        return <SandboxPage client={api} />;
      case "settings":
        return capabilities.status === "loading" ? (
          <ResourceLoading label="settings" />
        ) : capabilities.status === "error" ? (
          <ResourceFailure label="Settings" retry={loadCapabilities} />
        ) : (
          <SettingsPage client={api} capabilities={capabilities.value} />
        );
      case "not-found":
        return (
          <section className="lab-resource-state">
            <p className="lab-eyebrow">404 / local route</p>
            <h1>Workbench page not found.</h1>
            <p>The requested path is not one of Facet Lab’s named product areas.</p>
            <button type="button" onClick={() => navigate("/catalog")}>
              Open Catalog
            </button>
          </section>
        );
    }
  };

  return (
    <div className="lab-shell">
      <a className="lab-skip-link" href="#lab-main">
        Skip to workbench content
      </a>
      <header className="lab-topbar">
        <a
          className="lab-brand"
          href="/catalog"
          onClick={(event) => {
            event.preventDefault();
            navigate("/catalog");
          }}
          aria-label="Facet Lab home"
        >
          <span className="lab-brand-mark" aria-hidden="true">
            F
          </span>
          <span>
            <strong>Facet Lab</strong>
            <small>Validated interface workbench</small>
          </span>
        </a>
        <div className="lab-topbar-meta">
          <span className="lab-local-badge">
            <i aria-hidden="true" />
            Local process
          </span>
          <button
            className="lab-theme-toggle"
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "◑"}</span>
            {theme === "light" ? "Dark chrome" : "Light chrome"}
          </button>
        </div>
      </header>

      <div className="lab-workbench">
        <nav className="lab-primary-nav" aria-label="Facet Lab product areas">
          <ol>
            {PRODUCT_AREAS.map((area) => (
              <li key={area.id}>
                <a
                  ref={(node) => {
                    if (node === null) areaRefs.current.delete(area.id);
                    else areaRefs.current.set(area.id, node);
                  }}
                  href={area.path}
                  aria-current={isProductAreaActive(area.id, route) ? "page" : undefined}
                  onKeyDown={(event) => handleAreaKey(event, area.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(area.path);
                  }}
                >
                  {area.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section className="lab-stage" aria-label="Selected Facet Lab area">
          {secondaryRoutes.length > 1 ? (
            <div className="lab-stage-toolbar">
              <nav
                className="lab-secondary-nav"
                aria-label={`${activeArea?.label ?? "Area"} views`}
              >
                {secondaryRoutes.map((item) => (
                  <a
                    key={item.id}
                    href={item.path}
                    aria-current={route.id === item.id ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(item.path);
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          ) : null}
          <div
            id="lab-main"
            className="lab-page-frame"
            ref={mainRef}
            tabIndex={-1}
            role={routeOwnsMain(route) ? undefined : "main"}
          >
            <ShellErrorBoundary resetKey={`${route.id}:${route.runId ?? ""}`}>
              {resourcePage()}
            </ShellErrorBoundary>
          </div>
        </section>
      </div>
      <footer className="lab-footer">
        <span>Facet declarative UI contracts</span>
        <span>Loopback · bounded evidence · no browser keys</span>
      </footer>
    </div>
  );
}
