import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import type { RunEvidenceV1, VisualVerdict } from "../shared/run-contract.js";
import { createLabApiClient, type BrowserArtifact, type LabApiClient } from "./api-client.js";
import { presentRunDetail, type RunDetailPresentation } from "./run-presenter.js";
import { TracePanel } from "./TracePanel.js";

const MAX_HUMAN_SUMMARY = 2_000;

export interface RunDetailPageProps {
  readonly runId: string;
  readonly api?: LabApiClient;
  readonly onBack?: () => void;
  readonly onExport?: (runId: string, bundle: string) => void;
  readonly onArtifact?: (runId: string, artifactId: string, artifact: BrowserArtifact) => void;
}

type LoadState = "loading" | "ready" | "error";

function saveDownload(data: string | Uint8Array, mediaType: string, filename: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  let part: string | ArrayBuffer;
  if (typeof data === "string") part = data;
  else {
    const copied = new Uint8Array(data.byteLength);
    copied.set(data);
    part = copied.buffer;
  }
  const blob = new Blob([part], { type: mediaType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function actionLabel(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function RunDetailPage({
  runId,
  api: apiProp,
  onBack,
  onExport,
  onArtifact,
}: RunDetailPageProps): ReactNode {
  const api = useMemo(() => apiProp ?? createLabApiClient(), [apiProp]);
  const [evidence, setEvidence] = useState<RunEvidenceV1 | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [humanVerdict, setHumanVerdict] = useState<VisualVerdict>("pass");
  const [humanSummary, setHumanSummary] = useState("");

  const load = async (): Promise<void> => {
    setLoadState("loading");
    try {
      setEvidence(await api.getRun(runId));
      setLoadState("ready");
    } catch {
      setEvidence(null);
      setLoadState("error");
    }
  };

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    void api.getRun(runId).then(
      (result) => {
        if (!active) return;
        setEvidence(result);
        setLoadState("ready");
      },
      () => {
        if (!active) return;
        setEvidence(null);
        setLoadState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [api, runId]);

  const detail = useMemo<RunDetailPresentation | null>(
    () => (evidence === null ? null : presentRunDetail(evidence)),
    [evidence],
  );

  const mutate = async (action: "cancel" | "capture" | "evaluate" | "export"): Promise<void> => {
    if (busy !== null) return;
    setBusy(action);
    setMessage(null);
    try {
      if (action === "cancel") await api.cancelRun(runId);
      else if (action === "capture") await api.captureRun(runId);
      else if (action === "evaluate") await api.evaluateRun(runId, { kind: "recalculate" });
      else {
        const bundle = await api.exportRun(runId);
        if (onExport === undefined)
          saveDownload(bundle, "application/json", `facet-lab-${runId}.json`);
        else onExport(runId, bundle);
      }
      setMessage(`${actionLabel(action)} completed.`);
      if (action !== "export") await load();
    } catch {
      setMessage(`${actionLabel(action)} failed safely. Existing evidence was preserved.`);
    } finally {
      setBusy(null);
    }
  };

  const submitHumanEvaluation = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const summary = humanSummary.trim();
    if (busy !== null || summary.length === 0 || summary.length > MAX_HUMAN_SUMMARY) return;
    setBusy("human-evaluation");
    setMessage(null);
    try {
      await api.evaluateRun(runId, {
        kind: "advisory",
        record: {
          id: `human-${crypto.randomUUID()}`,
          evaluator: "human",
          status: "available",
          verdict: humanVerdict,
          summary,
          artifactIds: [],
          createdAt: new Date().toISOString(),
        },
      });
      setHumanSummary("");
      setMessage("Human advisory evaluation appended.");
      await load();
    } catch {
      setMessage("Human evaluation failed safely. Existing evidence was preserved.");
    } finally {
      setBusy(null);
    }
  };

  const openArtifact = async (artifactId: string): Promise<void> => {
    if (busy !== null) return;
    setBusy(`artifact:${artifactId}`);
    setMessage(null);
    try {
      const artifact = await api.getArtifact(runId, artifactId);
      if (onArtifact === undefined) {
        const extension =
          artifact.mediaType === "image/png"
            ? "png"
            : artifact.mediaType === "application/json"
              ? "json"
              : "txt";
        saveDownload(artifact.data, artifact.mediaType, `${artifactId}.${extension}`);
      } else onArtifact(runId, artifactId, artifact);
      setMessage(`Artifact ${artifactId} downloaded.`);
    } catch {
      setMessage("Artifact could not be loaded.");
    } finally {
      setBusy(null);
    }
  };

  if (loadState === "loading")
    return (
      <main aria-busy="true">
        <p role="status">Loading run detail.</p>
      </main>
    );
  if (loadState === "error" || detail === null) {
    return (
      <main>
        <p role="alert">Run detail could not be loaded.</p>
        <button type="button" onClick={() => void load()}>
          Retry run detail
        </button>
      </main>
    );
  }

  return (
    <main aria-labelledby="run-detail-heading">
      <header>
        {onBack === undefined ? null : (
          <button type="button" onClick={onBack}>
            Back to runs
          </button>
        )}
        <h1 id="run-detail-heading">Run {detail.runId}</h1>
        <p>
          <strong>{detail.statusLabel}</strong> · generation {detail.generation}
        </p>
        <p>{detail.scenarioId}</p>
      </header>

      <section aria-labelledby="evidence-states-heading">
        <h2 id="evidence-states-heading">Evidence states</h2>
        <dl>
          <dt>Completion</dt>
          <dd>{detail.states.completion}</dd>
          <dt>Provider usage</dt>
          <dd>{detail.states.usage}</dd>
          <dt>Visual evidence</dt>
          <dd>{detail.states.visual}</dd>
          <dt>Redaction</dt>
          <dd>{detail.states.redaction}</dd>
          <dt>Overflow</dt>
          <dd>{detail.states.overflow}</dd>
        </dl>
        {detail.states.completion === "incomplete" ? (
          <p role="status">This run ended with incomplete evidence.</p>
        ) : null}
        {detail.states.redaction === "present" ? (
          <p>One or more sensitive values were redacted at capture.</p>
        ) : null}
        {detail.states.overflow === "present" ? (
          <p>Evidence reached a configured bound; later trace items may be missing.</p>
        ) : null}
      </section>

      <section aria-labelledby="provenance-heading">
        <h2 id="provenance-heading">Provenance</h2>
        <dl>
          <dt>Mode</dt>
          <dd>{detail.provenance.mode}</dd>
          <dt>Provider</dt>
          <dd>{detail.provenance.provider}</dd>
          <dt>Model</dt>
          <dd>{detail.provenance.model}</dd>
          <dt>Viewport</dt>
          <dd>{detail.provenance.viewport}</dd>
          <dt>Color mode</dt>
          <dd>{detail.provenance.colorMode}</dd>
          <dt>Assets</dt>
          <dd>
            {detail.provenance.assetSource} · {detail.provenance.assetDigest}
          </dd>
          <dt>Created</dt>
          <dd>{detail.provenance.createdAt}</dd>
          <dt>Completed</dt>
          <dd>{detail.provenance.completedAt ?? "Not completed"}</dd>
        </dl>
        <details>
          <summary>Inspect prompt</summary>
          <p>{detail.prompt}</p>
        </details>
      </section>

      <section aria-labelledby="run-actions-heading">
        <h2 id="run-actions-heading">Run actions</h2>
        {detail.actions
          .filter((action) => action !== "inspect")
          .map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate(action)}
            >
              {actionLabel(action)}
            </button>
          ))}
        {message === null ? null : (
          <p role="status" aria-live="polite">
            {message}
          </p>
        )}
      </section>

      <TracePanel trace={detail.trace} />

      <section aria-labelledby="contract-heading">
        <h2 id="contract-heading">Blocking contract verdict: {detail.contract.verdict}</h2>
        <p>{detail.contract.blockingFailureCount} blocking checks did not pass.</p>
        <ul>
          {detail.contract.checks.map((check) => (
            <li key={check.id}>
              <details>
                <summary>
                  {check.label}: {check.status}
                </summary>
                <p>{check.details ?? "No details."}</p>
              </details>
            </li>
          ))}
        </ul>
        {detail.contract.advisoryChecks.length > 0 ? (
          <details>
            <summary>Non-blocking contract observations</summary>
            <ul>
              {detail.contract.advisoryChecks.map((check) => (
                <li key={check.id}>
                  {check.label}: {check.status}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="visual-heading">
        <h2 id="visual-heading">Advisory visual evidence</h2>
        <p>{detail.visual.label} Visual evidence never changes the blocking contract verdict.</p>
        {detail.visual.items.length === 0 ? (
          <p>Visual evidence is missing.</p>
        ) : (
          <ul>
            {detail.visual.items.map((visual) => (
              <li key={visual.id}>
                <details>
                  <summary>
                    {visual.evaluator}: {visual.state}
                    {visual.verdict === null ? "" : ` / ${visual.verdict}`}
                  </summary>
                  <p>{visual.summary}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(event) => void submitHumanEvaluation(event)}>
          <fieldset disabled={busy !== null}>
            <legend>Append human advisory evaluation</legend>
            <label>
              Verdict
              <select
                value={humanVerdict}
                onChange={(event) =>
                  setHumanVerdict(event.currentTarget.value === "fail" ? "fail" : "pass")
                }
              >
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            </label>
            <label>
              Summary
              <textarea
                required
                maxLength={MAX_HUMAN_SUMMARY}
                value={humanSummary}
                onChange={(event) => setHumanSummary(event.currentTarget.value)}
              />
            </label>
            <button type="submit">Append advisory evaluation</button>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="artifacts-heading">
        <h2 id="artifacts-heading">Artifacts</h2>
        {detail.artifacts.length === 0 ? (
          <p>No artifacts were captured.</p>
        ) : (
          <ul>
            {detail.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void openArtifact(artifact.id)}
                >
                  {artifact.id}
                </button>{" "}
                · {artifact.viewport}/{artifact.colorMode} · {artifact.bytes} bytes
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.warnings.length === 0 ? null : (
        <section aria-labelledby="warnings-heading">
          <h2 id="warnings-heading">Warnings</h2>
          <ul>
            {detail.warnings.map((warning) => (
              <li key={`${warning.classification}:${warning.code}`}>
                <details>
                  <summary>
                    {warning.classification}: {warning.code}
                  </summary>
                  <p>{warning.message}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
