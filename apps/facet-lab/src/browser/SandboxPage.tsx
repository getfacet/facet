import { useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { DEFAULT_THEME } from "@facet/assets";
import type { FacetTheme } from "@facet/core";
import { StageRenderer } from "@facet/react";

import { createLabApiClient, type LabApiClient } from "./api-client.js";
import {
  createSandboxEditorFromTreeText,
  SANDBOX_CONTROL_LABELS,
  type SandboxDiagnostic,
  type SandboxEditProjection,
  type SandboxEditor,
  type SandboxSnapshotProjection,
} from "./sandbox-presenter.js";

export interface SandboxPageProps {
  readonly client?: LabApiClient;
  readonly theme?: FacetTheme;
  readonly initialRunId?: string;
}

const STARTER_TREE = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["message"] },
    message: { id: "message", type: "text", value: "Safe sandbox" },
  },
} as const;

function treeText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function genericDiagnostic(target: "session" | "tree", message: string): SandboxDiagnostic {
  return Object.freeze({ code: "invalid-session", target, message });
}

export function SandboxPage({
  client: providedClient,
  theme: initialTheme = DEFAULT_THEME,
  initialRunId = "",
}: SandboxPageProps = {}): ReactNode {
  const client = useMemo(() => providedClient ?? createLabApiClient(), [providedClient]);
  const sequence = useRef(0);
  const [theme, setTheme] = useState<FacetTheme>(initialTheme);
  const [sourceRunId, setSourceRunId] = useState(initialRunId);
  const [treeDocument, setTreeDocument] = useState(treeText(STARTER_TREE));
  const [patchDocument, setPatchDocument] = useState(
    '[\n  { "op": "replace", "path": "/nodes/message/value", "value": "Edited safely" }\n]',
  );
  const [viewDocument, setViewDocument] = useState('{\n  "screen": "sandbox"\n}');
  const [expectedRevision, setExpectedRevision] = useState("0");
  const [editor, setEditor] = useState<SandboxEditor | null>(null);
  const [snapshot, setSnapshot] = useState<SandboxSnapshotProjection | null>(null);
  const [diagnostic, setDiagnostic] = useState<SandboxDiagnostic | null>(null);
  const [cloning, setCloning] = useState(false);

  const installEditor = (next: SandboxEditor, nextTheme: FacetTheme): void => {
    const nextSnapshot = next.snapshot();
    setEditor(next);
    setSnapshot(nextSnapshot);
    setTheme(nextTheme);
    setExpectedRevision(String(nextSnapshot.revision));
    setDiagnostic(null);
  };

  const createNew = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    sequence.current += 1;
    const created = createSandboxEditorFromTreeText({
      id: `browser-sandbox-${String(sequence.current)}`,
      theme,
      text: treeDocument,
      source: { kind: "new" },
    });
    if (!created.ok) {
      setDiagnostic(created.diagnostic);
      return;
    }
    installEditor(created.editor, theme);
  };

  const cloneRun = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (sourceRunId.length === 0) return;
    setCloning(true);
    setDiagnostic(null);
    try {
      const evidence = await client.getRun(sourceRunId);
      const sourceTree = evidence.finalTree ?? evidence.initialTree;
      const latestCheckpoint = evidence.checkpoints.at(-1);
      const sourceRevision = latestCheckpoint?.stageVersion ?? 0;
      sequence.current += 1;
      const created = createSandboxEditorFromTreeText({
        id: `browser-sandbox-${String(sequence.current)}`,
        theme: evidence.assets.theme,
        text: treeText(sourceTree),
        source: { kind: "clone", runId: evidence.run.runId, revision: sourceRevision },
      });
      if (!created.ok) {
        setDiagnostic(created.diagnostic);
        return;
      }
      setTreeDocument(treeText(sourceTree));
      installEditor(created.editor, evidence.assets.theme);
    } catch {
      setDiagnostic(
        genericDiagnostic(
          "session",
          "The source run could not be cloned. The source and current sandbox were not changed.",
        ),
      );
    } finally {
      setCloning(false);
    }
  };

  const acceptEdit = (result: SandboxEditProjection): void => {
    setSnapshot(result.snapshot);
    setDiagnostic(result.diagnostic);
    if (result.status === "applied") setExpectedRevision(String(result.snapshot.revision));
  };

  const applyPatches = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (editor === null) return;
    acceptEdit(editor.applyPatches(Number(expectedRevision), patchDocument));
  };

  const checkpointView = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (editor === null) return;
    acceptEdit(editor.checkpointView(Number(expectedRevision), viewDocument));
  };

  return (
    <section className="lab-page lab-sandbox-page" aria-labelledby="sandbox-title">
      <header className="lab-page-header">
        <h1 id="sandbox-title">Contract Sandbox</h1>
        <p>
          Create an isolated Facet tree or clone a saved run. Sandbox edits never write to the
          source run.
        </p>
      </header>

      <form className="lab-sandbox-tree-form" onSubmit={createNew}>
        <fieldset>
          <legend>Create an isolated sandbox</legend>
          <label htmlFor="sandbox-tree">{SANDBOX_CONTROL_LABELS.tree}</label>
          <textarea
            id="sandbox-tree"
            value={treeDocument}
            rows={16}
            spellCheck={false}
            onChange={(event) => setTreeDocument(event.target.value)}
          />
          <button type="submit">Create from safe tree</button>
        </fieldset>
      </form>

      <form onSubmit={(event) => void cloneRun(event)}>
        <fieldset className="lab-inline-fieldset" disabled={cloning}>
          <legend>Clone a saved or live run</legend>
          <label htmlFor="sandbox-source-run">{SANDBOX_CONTROL_LABELS.sourceRun}</label>
          <input
            id="sandbox-source-run"
            value={sourceRunId}
            required
            placeholder="00000000-0000-4000-8000-000000000000"
            onChange={(event) => setSourceRunId(event.target.value)}
          />
          <button type="submit">{cloning ? "Cloning…" : "Clone into sandbox"}</button>
        </fieldset>
      </form>

      {diagnostic === null ? null : (
        <section
          className="lab-page-section"
          role="alert"
          aria-labelledby="sandbox-diagnostic-title"
        >
          <h2 id="sandbox-diagnostic-title">Sandbox diagnostic</h2>
          <p>
            <strong>{diagnostic.target}</strong>: {diagnostic.message}
          </p>
          <p>The last safe preview remains active.</p>
        </section>
      )}

      {snapshot === null ? (
        <p className="lab-status-line" role="status">
          Create or clone a sandbox to begin editing.
        </p>
      ) : (
        <section className="lab-page-section" aria-labelledby="sandbox-editor-title">
          <h2 id="sandbox-editor-title">Isolated editor</h2>
          <dl>
            <dt>Sandbox</dt>
            <dd>{snapshot.id}</dd>
            <dt>Revision</dt>
            <dd>{snapshot.revision}</dd>
            <dt>Source</dt>
            <dd>
              {snapshot.source.kind === "new"
                ? "New isolated tree"
                : `Clone of ${snapshot.source.runId} at revision ${String(snapshot.source.revision)}`}
            </dd>
          </dl>

          <label htmlFor="sandbox-expected-revision">
            {SANDBOX_CONTROL_LABELS.expectedRevision}
          </label>
          <input
            id="sandbox-expected-revision"
            type="number"
            min={0}
            step={1}
            value={expectedRevision}
            onChange={(event) => setExpectedRevision(event.target.value)}
          />

          <form onSubmit={applyPatches}>
            <label htmlFor="sandbox-patches">{SANDBOX_CONTROL_LABELS.patches}</label>
            <textarea
              id="sandbox-patches"
              value={patchDocument}
              rows={10}
              spellCheck={false}
              onChange={(event) => setPatchDocument(event.target.value)}
            />
            <button type="submit">Apply patches with revision check</button>
          </form>

          <form onSubmit={checkpointView}>
            <label htmlFor="sandbox-view">{SANDBOX_CONTROL_LABELS.view}</label>
            <textarea
              id="sandbox-view"
              value={viewDocument}
              rows={6}
              spellCheck={false}
              onChange={(event) => setViewDocument(event.target.value)}
            />
            <button type="submit">Save separate view checkpoint</button>
          </form>

          <section className="lab-page-section" aria-labelledby="sandbox-preview-title">
            <h3 id="sandbox-preview-title">Last safe preview</h3>
            <StageRenderer tree={snapshot.previewTree} theme={theme} />
          </section>

          <details>
            <summary>Original immutable tree</summary>
            <pre>{treeText(snapshot.originalTree)}</pre>
          </details>
          <details>
            <summary>Separate view checkpoint</summary>
            <pre>{snapshot.view === undefined ? "Unavailable" : treeText(snapshot.view)}</pre>
          </details>
        </section>
      )}
    </section>
  );
}
