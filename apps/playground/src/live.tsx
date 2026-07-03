import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FacetAction, VisitorContext } from "@facet/core";
import { ChatDock, StageRenderer, useFacet } from "@facet/react";
import { browserVisitorId, SseTransport } from "@facet/client";

const SERVER = "http://localhost:5291";
// A stable anonymous id for this browser (persisted in localStorage), so a
// refresh or a return visit re-hydrates the same page.
const VISITOR: VisitorContext = { visitorId: browserVisitorId(), locale: "en-US" };

type LogLine = { readonly who: "You" | "Nova"; readonly text: string };

/**
 * Live tab: talks to the real @facet/server over SSE. Type a request and the
 * server's LLM agent generates a page and streams it back. Requires the server:
 *   pnpm --filter @facet/playground serve
 */
export function LiveView(): React.ReactNode {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`${SERVER}/health`)
      .then((res) => alive && setOnline(res.ok))
      .catch(() => alive && setOnline(false));
    return () => {
      alive = false;
    };
  }, []);

  const transport = useMemo(() => new SseTransport(SERVER, VISITOR), []);
  const { tree, chat, send } = useFacet(transport);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const [pending, setPending] = useState(false);
  const seen = useRef(0);

  useEffect(() => {
    send({ kind: "visit", visitor: VISITOR });
  }, [send]);

  useEffect(() => {
    if (chat.length > seen.current) {
      const fresh = chat.slice(seen.current).map((text): LogLine => ({ who: "Nova", text }));
      seen.current = chat.length;
      setLog((current) => [...current, ...fresh]);
      setPending(false);
    }
  }, [chat]);

  useEffect(() => {
    setPending(false);
  }, [tree]);

  const onSend = (text: string): void => {
    setLog((current) => [...current, { who: "You", text }]);
    setPending(true);
    send({ kind: "message", text });
  };

  const onAction = (action: FacetAction, fields?: Readonly<Record<string, string>>): void => {
    // Conditional construction: exactOptionalPropertyTypes forbids an explicit
    // `fields: undefined` on the event.
    send(fields === undefined ? { kind: "action", action } : { kind: "action", action, fields });
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.status}>
        {online === null
          ? "Checking server…"
          : online
            ? "● Server online (localhost:5291) — try “a landing page for a bakery”."
            : "○ Server offline. Run: pnpm --filter @facet/playground serve"}
      </div>

      <div style={styles.stage}>
        <StageRenderer tree={tree} onAction={onAction} />
      </div>

      <ChatDock messages={log} onSend={onSend} pending={pending} placeholder="describe a page…" />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    maxWidth: "760px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  status: { color: "#9aa0aa", fontSize: "13px" },
  stage: {
    background: "#fff",
    color: "#1a1d23",
    border: "1px solid #2a2e37",
    borderRadius: "14px",
    overflow: "auto",
    minHeight: "300px",
  },
  dock: {
    border: "1px solid #2a2e37",
    borderRadius: "14px",
    overflow: "hidden",
    background: "#fbfbfc",
    color: "#1a1d23",
  },
  log: { maxHeight: "140px", overflowY: "auto", padding: "10px 14px", fontSize: "13px" },
  logLine: { marginBottom: "4px" },
  thinking: { color: "#6b7280", fontStyle: "italic" },
  you: { fontWeight: 600, color: "#4f46e5" },
  nova: { fontWeight: 600, color: "#16a34a" },
  inputRow: { display: "flex", gap: "8px", padding: "10px 14px", borderTop: "1px solid #eceef1" },
  input: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #d7dbe0",
    fontSize: "14px",
  },
  send: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
};
