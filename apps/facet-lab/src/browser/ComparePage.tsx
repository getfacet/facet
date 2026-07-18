import type { ReactNode } from "react";

import { StageRenderer } from "@facet/react";

import type { RunEvidenceV1 } from "../shared/run-contract.js";
import { presentComparison } from "./replay-presenter.js";

export interface ComparePageProps {
  readonly runs?: readonly RunEvidenceV1[] | null;
}

export function ComparePage({ runs }: ComparePageProps): ReactNode {
  const presentation = presentComparison(runs);
  const runById = new Map((runs ?? []).map((run) => [run.run.runId, run] as const));

  return (
    <main aria-labelledby="compare-page-title">
      <header>
        <h1 id="compare-page-title">Immutable run comparison</h1>
        <p>
          Compare two to four recorded runs without starting providers or changing source evidence.
        </p>
      </header>
      <p role={presentation.state === "error" ? "alert" : "status"} aria-live="polite">
        {presentation.statusMessage}
      </p>

      {presentation.state !== "ready" ? null : (
        <>
          <section aria-labelledby="comparison-render-title">
            <h2 id="comparison-render-title">Rendered stages and evidence</h2>
            <div data-comparison-columns={presentation.columns.length}>
              {presentation.columns.map((column) => {
                const source = runById.get(column.runId);
                return (
                  <article key={column.runId} aria-labelledby={`compare-column-${column.runId}`}>
                    <h3 id={`compare-column-${column.runId}`}>{column.scenarioId}</h3>
                    <p>{column.runId}</p>
                    <dl>
                      <dt>Status</dt>
                      <dd>{column.status}</dd>
                      <dt>Provider and model</dt>
                      <dd>
                        {column.provider} · {column.model}
                      </dd>
                      <dt>Recorded evidence items</dt>
                      <dd>
                        {column.evidence.availability === "available"
                          ? column.evidence.itemCount
                          : "Not recorded"}
                      </dd>
                    </dl>

                    <section aria-label={`${column.scenarioId} final render`}>
                      {column.render.availability === "unavailable" ||
                      column.render.tree === null ||
                      source === undefined ? (
                        <p>Final render unavailable: not recorded.</p>
                      ) : (
                        <StageRenderer
                          tree={column.render.tree}
                          theme={source.assets.theme}
                          colorMode={column.colorMode}
                        />
                      )}
                    </section>

                    <section aria-labelledby={`compare-gaps-${column.runId}`}>
                      <h4 id={`compare-gaps-${column.runId}`}>Explicit gaps</h4>
                      {column.gaps.length === 0 ? (
                        <p>No render, evidence, or provenance gaps detected.</p>
                      ) : (
                        <ul>
                          {column.gaps.map((gap, index) => (
                            <li key={`${gap.kind}:${String(index)}`}>
                              <strong>{gap.kind}</strong>: {gap.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="comparison-provenance-title">
            <h2 id="comparison-provenance-title">Evidence and provenance matrix</h2>
            <div tabIndex={0} role="region" aria-label="Scrollable run comparison table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    {presentation.columns.map((column) => (
                      <th key={column.runId} scope="col">
                        {column.scenarioId} · {column.runId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {presentation.rows.map((row) => (
                    <tr key={row.dimension}>
                      <th scope="row">{row.label}</th>
                      {row.cells.map((cell, index) => (
                        <td
                          key={`${row.dimension}:${String(index)}`}
                          data-availability={cell.availability}
                          data-gap-kind={cell.gapKind}
                        >
                          {cell.display}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
