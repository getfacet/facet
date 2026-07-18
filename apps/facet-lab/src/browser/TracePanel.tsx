import type { ReactNode } from "react";

import type { TraceItemPresentation, TracePresentation } from "./run-presenter.js";

export interface TracePanelProps {
  readonly trace: TracePresentation;
  readonly className?: string;
}

function traceStateLabel(item: TraceItemPresentation): string {
  switch (item.state) {
    case "available":
      return "Available";
    case "truncated":
      return "Truncated at the evidence boundary";
    case "redacted":
      return "Sensitive value redacted";
    case "overflow":
      return "Evidence overflow";
  }
}

export function TracePanel({ trace, className }: TracePanelProps): ReactNode {
  return (
    <section className={className} aria-labelledby="run-trace-heading">
      <header>
        <h2 id="run-trace-heading">Correlated trace</h2>
        <p role="status">
          Trace {trace.completeness}. Usage {trace.usage.state}.
        </p>
        {trace.usage.state === "available" ? (
          <p>
            {trace.usage.inputTokens ?? "Unknown"} input tokens ·{" "}
            {trace.usage.outputTokens ?? "Unknown"} output tokens
          </p>
        ) : (
          <p>Provider token usage was not reported.</p>
        )}
        {trace.missingKinds.length > 0 ? (
          <p>Missing trace categories: {trace.missingKinds.join(", ")}.</p>
        ) : null}
      </header>

      <ol aria-label="Run trace timeline">
        {trace.items.map((item) => (
          <li key={item.id} data-trace-kind={item.kind} data-trace-state={item.state}>
            <details>
              <summary>
                <span>{item.label}</span>{" "}
                <span aria-label={`Trace state: ${traceStateLabel(item)}`}>
                  {traceStateLabel(item)}
                </span>
              </summary>
              <dl>
                <dt>Category</dt>
                <dd>{item.kind}</dd>
                <dt>Ordinal</dt>
                <dd>{item.ordinal ?? "Run-level"}</dd>
                <dt>Turn</dt>
                <dd>{item.turnId ?? "Not correlated to a turn"}</dd>
                <dt>Call correlation</dt>
                <dd>
                  {item.correlationId === null
                    ? "Not a tool call"
                    : `${item.correlationId}${item.phase === null ? "" : ` (${item.phase})`}`}
                </dd>
                <dt>Evidence</dt>
                <dd>{item.summary}</dd>
                <dt>Timestamp</dt>
                <dd>{item.timestamp ?? "Not recorded"}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
