import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FacetAction, VisitorContext } from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { StageRenderer, useFacet } from "@facet/react";
import { LocalTransport } from "@facet/client";
import { nova } from "./nova.js";
import { Gallery } from "./gallery.js";
import { GeneratedView } from "./generated.js";
import { LiveView } from "./live.js";

type View = "gallery" | "generated" | "live" | "visitors";

const SUBTITLES: Record<View, string> = {
  gallery:
    "Six very different pages — all from four bricks (box/text/image/field) + tokens. No LLM.",
  generated:
    "The page an LLM just built from the four bricks via the CLI generator, validated and rendered.",
  live: "Talk to a real @facet/server: type a request and the LLM agent builds the page live over SSE.",
  visitors:
    "One agent (Nova), two visitors. Rule-based — no LLM. Type in a chat dock and watch only that visitor's stage rebuild.",
};

const ALICE: VisitorContext = {
  visitorId: "alice",
  referrer: "https://twitter.com/x",
  locale: "en-US",
};
const BOB: VisitorContext = { visitorId: "bob", locale: "ko-KR" };

/**
 * The playground: two independent visitors of the SAME agent link, side by side.
 * They diverge on first paint and each pane's chat only mutates its own stage —
 * that isolation is the whole point of Facet.
 */
export function App(): React.ReactNode {
  const [view, setView] = useState<View>("gallery");
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Facet playground</h1>
        <p style={styles.subtitle}>{SUBTITLES[view]}</p>
        <nav style={styles.nav}>
          <button
            type="button"
            style={view === "gallery" ? styles.tabActive : styles.tab}
            onClick={() => setView("gallery")}
          >
            Brick gallery
          </button>
          <button
            type="button"
            style={view === "generated" ? styles.tabActive : styles.tab}
            onClick={() => setView("generated")}
          >
            LLM-generated
          </button>
          <button
            type="button"
            style={view === "live" ? styles.tabActive : styles.tab}
            onClick={() => setView("live")}
          >
            Live (server)
          </button>
          <button
            type="button"
            style={view === "visitors" ? styles.tabActive : styles.tab}
            onClick={() => setView("visitors")}
          >
            Two visitors
          </button>
        </nav>
      </header>
      {view === "gallery" ? (
        <Gallery />
      ) : view === "generated" ? (
        <GeneratedView />
      ) : view === "live" ? (
        <LiveView />
      ) : (
        <div style={styles.panes}>
          <VisitorPane title="Alice — came from Twitter" visitor={ALICE} />
          <VisitorPane title="Bob — direct visit" visitor={BOB} />
        </div>
      )}
    </div>
  );
}

interface LogLine {
  readonly who: "You" | "Nova";
  readonly text: string;
}

function VisitorPane({
  title,
  visitor,
}: {
  title: string;
  visitor: VisitorContext;
}): React.ReactNode {
  const transport = useMemo(() => {
    const runtime = new FacetRuntime({ agentId: "nova", agent: nova });
    return new LocalTransport(runtime, visitor);
  }, [visitor]);

  const { tree, chat, send } = useFacet(transport);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const [draft, setDraft] = useState("");
  const seen = useRef(0);

  // Fire the initial visit → first paint.
  useEffect(() => {
    send({ kind: "visit", visitor });
  }, [send, visitor]);

  // Fold new agent replies into the conversation log.
  useEffect(() => {
    if (chat.length > seen.current) {
      const fresh = chat.slice(seen.current).map((text): LogLine => ({ who: "Nova", text }));
      seen.current = chat.length;
      setLog((current) => [...current, ...fresh]);
    }
  }, [chat]);

  const onAction = (action: FacetAction): void => {
    send({ kind: "action", action });
  };

  const submit = (): void => {
    const text = draft.trim();
    if (text === "") return;
    setLog((current) => [...current, { who: "You", text }]);
    send({ kind: "message", text });
    setDraft("");
  };

  return (
    <section style={styles.pane}>
      <div style={styles.paneHeader}>{title}</div>

      {/* The Stage — dynamic, agent-owned */}
      <div style={styles.stage}>
        <StageRenderer tree={tree} onAction={onAction} />
      </div>

      {/* The Chat dock — persistent, app chrome, not agent-generated */}
      <div style={styles.dock}>
        <div style={styles.log}>
          {log.map((line, index) => (
            <div key={index} style={styles.logLine}>
              <span style={line.who === "You" ? styles.you : styles.nova}>{line.who}:</span>{" "}
              {line.text}
            </div>
          ))}
        </div>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            value={draft}
            placeholder='try "pricing"…'
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <button style={styles.sendButton} type="button" onClick={submit}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    margin: 0,
    background: "#0f1115",
    color: "#e8eaed",
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: "32px",
    boxSizing: "border-box",
  },
  header: { maxWidth: "1100px", margin: "0 auto 24px" },
  title: { margin: "0 0 4px", fontSize: "24px" },
  subtitle: { margin: "0 0 12px", color: "#9aa0aa", fontSize: "14px" },
  nav: { display: "flex", gap: "8px" },
  tab: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #2a2e37",
    background: "transparent",
    color: "#9aa0aa",
    fontSize: "13px",
    cursor: "pointer",
  },
  tabActive: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #4f46e5",
    background: "#4f46e5",
    color: "#fff",
    fontSize: "13px",
    cursor: "pointer",
  },
  panes: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
    maxWidth: "960px",
    margin: "0 auto",
  },
  pane: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid #2a2e37",
    borderRadius: "14px",
    overflow: "hidden",
    background: "#fff",
    color: "#1a1d23",
    minHeight: "520px",
  },
  paneHeader: {
    padding: "10px 14px",
    background: "#f6f7f9",
    borderBottom: "1px solid #e2e5ea",
    fontSize: "13px",
    fontWeight: 600,
    color: "#6b7280",
  },
  stage: { flex: 1, overflowY: "auto" },
  dock: { borderTop: "1px solid #e2e5ea", background: "#fbfbfc" },
  log: { maxHeight: "120px", overflowY: "auto", padding: "10px 14px", fontSize: "13px" },
  logLine: { marginBottom: "4px" },
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
  sendButton: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
};
