/**
 * The served page (spec Decision 3) — the browser entry tsup bundles to
 * `dist/page/app.js` at package build time (react + @facet/client + @facet/react
 * inlined; the quickstart server streams it as `/app.js`).
 *
 * Same-origin by construction: the transport talks to `""` (its own origin), so
 * the page only ever speaks the existing SSE+POST protocol back to the wrapper
 * that served it — no new client network capability (invariant #7).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { FacetAction, VisitorContext } from "@facet/core";
import { browserVisitorId, SseTransport } from "@facet/client";
import { ChatDock, StageRenderer, useFacet, type ChatMessage } from "@facet/react";

function makeVisitor(): VisitorContext {
  const referrer = document.referrer;
  const locale = navigator.language;
  return {
    visitorId: browserVisitorId(),
    ...(referrer !== "" ? { referrer } : {}),
    ...(locale !== "" ? { locale } : {}),
  };
}

function Page(): ReactNode {
  const visitor = useMemo(makeVisitor, []);
  const transport = useMemo(() => new SseTransport("", visitor), [visitor]);
  const { tree, chat, send } = useFacet(transport);
  const [log, setLog] = useState<readonly ChatMessage[]>([]);
  const seen = useRef(0);

  // Fire the initial visit → first paint.
  useEffect(() => {
    send({ kind: "visit", visitor });
  }, [send, visitor]);

  // Fold new agent says into the conversation log; a server reset shrinks
  // `chat`, in which case rebuild instead of appending duplicates.
  useEffect(() => {
    if (chat.length > seen.current) {
      const fresh = chat.slice(seen.current).map((text): ChatMessage => ({ who: "Agent", text }));
      seen.current = chat.length;
      setLog((current) => [...current, ...fresh]);
    } else if (chat.length < seen.current) {
      seen.current = chat.length;
      setLog(chat.map((text): ChatMessage => ({ who: "Agent", text })));
    }
  }, [chat]);

  const onAction = (action: FacetAction, fields?: Readonly<Record<string, string>>): void => {
    // Conditional construction: exactOptionalPropertyTypes forbids an explicit
    // `fields: undefined` on the event (the Decision-2 shape).
    send(fields === undefined ? { kind: "action", action } : { kind: "action", action, fields });
  };

  const onSend = (text: string): void => {
    setLog((current) => [...current, { who: "You", text }]);
    send({ kind: "message", text });
  };

  return (
    <div style={styles.page}>
      <div style={styles.stage}>
        <StageRenderer tree={tree} onAction={onAction} />
      </div>
      <ChatDock messages={log} onSend={onSend} />
    </div>
  );
}

const styles = {
  page: {
    maxWidth: "760px",
    margin: "0 auto",
    minHeight: "100vh",
    boxSizing: "border-box",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  stage: { flex: 1 },
} as const;

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<Page />);
}
