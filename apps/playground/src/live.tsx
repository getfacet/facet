import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CollectedEvent,
  FacetAction,
  FieldValues,
  ViewSnapshot,
  VisitorContext,
} from "@facet/core";
import { ChatDock, StageRenderer, useFacet } from "@facet/react";
import { browserVisitorId, SseTransport, withView } from "@facet/client";

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
  const { tree, chat, send, record, transition } = useFacet(transport);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const [pending, setPending] = useState(false);
  const seen = useRef(0);

  // Latest renderer-published view snapshot, sampled at send time. Storing
  // only — a snapshot change never sends.
  const viewRef = useRef<ViewSnapshot | undefined>(undefined);
  const onViewSnapshot = useCallback((snap: ViewSnapshot): void => {
    viewRef.current = snap;
  }, []);

  useEffect(() => {
    send(withView({ kind: "visit", visitor: VISITOR }, viewRef.current));
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
    send(withView({ kind: "message", text }, viewRef.current));
  };

  const onAction = (action: FacetAction, fields?: FieldValues): void => {
    // Conditional spread: exactOptionalPropertyTypes forbids an explicit
    // `fields: undefined` / `view: undefined` on the event — absent stays absent.
    send(
      withView(
        {
          kind: "tap",
          action,
          ...(fields !== undefined ? { fields } : {}),
        },
        viewRef.current,
      ),
    );
  };

  const onRecord = (event: CollectedEvent): void => {
    record(withView(event, viewRef.current));
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
        <StageRenderer
          tree={tree}
          onAction={onAction}
          onRecord={onRecord}
          transition={transition}
          onViewSnapshot={onViewSnapshot}
        />
      </div>

      <ChatDock messages={log} onSend={onSend} pending={pending} placeholder="describe a page…" />
    </div>
  );
}

// Only wrap/status/stage are read — the dock/log/input keys were leftovers from a
// hand-rolled dock replaced by <ChatDock />. Keyed union so future drift is caught.
const styles: Record<"wrap" | "status" | "stage", CSSProperties> = {
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
};
