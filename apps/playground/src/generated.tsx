import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { EMPTY_TREE, validateTree, type FacetAction, type FacetTree } from "@facet/core";
import { StageRenderer } from "@facet/react";

type Status = "loading" | "ok" | "empty" | "error";

/**
 * Renders whatever the CLI generator last produced (apps/playground/generated/
 * latest.json). It runs the fetched JSON through validateTree again in the
 * browser — the same fail-safe boundary the CLI used — so an untrusted tree can
 * never break this view.
 */
export function GeneratedView(): React.ReactNode {
  const [tree, setTree] = useState<FacetTree>(EMPTY_TREE);
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [lastAction, setLastAction] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus("loading");
    try {
      const response = await fetch(`/generated/latest.json?t=${String(Date.now())}`);
      if (!response.ok) {
        setStatus("empty");
        return;
      }
      const json: unknown = await response.json();
      const result = validateTree(json);
      setTree(result.tree);
      setIssues(result.issues);
      setStatus("ok");
    } catch {
      setStatus("empty");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onAction = (action: FacetAction): void => {
    setLastAction(action.name);
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.bar}>
        <span style={styles.hint}>
          Renders <code>apps/playground/generated/latest.json</code> — run{" "}
          <code>pnpm --filter @facet/playground gen "…"</code> then reload.
        </span>
        <button type="button" style={styles.reload} onClick={() => void load()}>
          ↻ Reload
        </button>
      </div>

      {status === "empty" ? (
        <div style={styles.empty}>
          Nothing generated yet. Run the generator, then hit Reload:
          <pre style={styles.pre}>
            pnpm --filter @facet/playground gen "a landing page for a bakery"
          </pre>
        </div>
      ) : (
        <div style={styles.frame}>
          <StageRenderer tree={tree} onAction={onAction} />
        </div>
      )}

      {lastAction !== null ? (
        <div style={styles.action}>
          Pressed action: <strong>{lastAction}</strong>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div style={styles.issues}>
          <strong>{issues.length} issue(s) repaired by validateTree:</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: "760px", margin: "0 auto" },
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },
  hint: { color: "#9aa0aa", fontSize: "13px" },
  reload: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #4f46e5",
    background: "#4f46e5",
    color: "#fff",
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  frame: {
    background: "#fff",
    color: "#1a1d23",
    border: "1px solid #2a2e37",
    borderRadius: "14px",
    overflow: "hidden",
    minHeight: "300px",
  },
  empty: { color: "#9aa0aa", fontSize: "14px", padding: "40px 0", textAlign: "center" },
  pre: {
    color: "#c7ccd4",
    background: "#16181d",
    padding: "12px",
    borderRadius: "8px",
    marginTop: "12px",
    overflowX: "auto",
  },
  action: { marginTop: "12px", color: "#c7ccd4", fontSize: "13px" },
  issues: { marginTop: "12px", color: "#d97706", fontSize: "13px" },
};
