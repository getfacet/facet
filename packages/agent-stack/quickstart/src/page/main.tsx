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
import { isTreeShaped } from "@facet/core";
import type { FacetAction, FacetTheme, FacetTree, FieldValues, VisitorContext } from "@facet/core";
import { browserVisitorId, SseTransport } from "@facet/client";
import {
  ChatDock,
  DEFAULT_THEME,
  resolveTheme,
  StageRenderer,
  useFacet,
  type ChatMessage,
} from "@facet/react";

declare global {
  interface Window {
    __FACET_THEMES__?: unknown;
    __FACET_INITIAL_STAGE__?: unknown;
  }
}

/**
 * Read the boot-shipped theme map (Decision 2 seam). Floor-guarded: only an
 * array of objects carrying a string `name` survives — anything else (absent,
 * a non-array, JSON junk) becomes `undefined`, so `StageRenderer` falls back to
 * the default theme. `validateTheme` remains the real security boundary; this is
 * a shape floor after the JSON round trip.
 */
function readThemes(): readonly FacetTheme[] | undefined {
  const raw = window.__FACET_THEMES__;
  if (!Array.isArray(raw)) return undefined;
  const themes = raw.filter(
    (t): t is FacetTheme =>
      typeof t === "object" && t !== null && typeof (t as { name?: unknown }).name === "string",
  );
  return themes.length > 0 ? themes : undefined;
}

/**
 * Read the boot-shipped seed stage (Decision 4 / Fix A seam) so the first paint
 * doesn't wait for the first model turn. Floor-guarded with the shared
 * `isTreeShaped` check — only a `{ root: string, nodes: object }` survives, so
 * JSON junk becomes `undefined` and `useFacet` falls back to `EMPTY_TREE`. The
 * host `validateTree`d this tree server-side before inlining it; this is the
 * shape floor after the JSON round trip (mirrors `readThemes`' posture).
 */
function readInitialStage(): FacetTree | undefined {
  const raw = window.__FACET_INITIAL_STAGE__;
  return isTreeShaped(raw) ? raw : undefined;
}

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
  const themes = useMemo(readThemes, []);
  const initialTree = useMemo(readInitialStage, []);
  const transport = useMemo(() => new SseTransport("", visitor), [visitor]);
  // Conditional spread: exactOptionalPropertyTypes forbids an explicit
  // `initialTree: undefined` — an absent seed must keep the EMPTY_TREE default.
  const { tree, chat, send, record, transition } = useFacet(
    transport,
    initialTree !== undefined ? { initialTree } : {},
  );
  const [log, setLog] = useState<readonly ChatMessage[]>([]);
  const seen = useRef(0);

  // Fire the initial visit → first paint.
  useEffect(() => {
    send({ kind: "visit", visitor });
  }, [send, visitor]);

  // Paint the page CANVAS (document.body, outside the tree) with the resolved
  // theme's bg/fg so a dark theme actually darkens the whole page, not just the
  // token-styled bricks. StageRenderer/ChatDock are untouched — the spec keeps
  // the dock on the default palette. The default theme resolves to white/near-
  // black, visually identical to today. Guard the tree read the way StageRenderer
  // does (a raw-path tree can be null/primitive), then let `resolveTheme`
  // floor-guard the name.
  useEffect(() => {
    const themeName: unknown =
      typeof tree === "object" && tree !== null
        ? (tree as { readonly theme?: unknown }).theme
        : undefined;
    const resolved = resolveTheme(themeName, themes);
    document.body.style.background = resolved.color.bg;
    document.body.style.color = resolved.color.fg;
  }, [tree, themes]);

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

  const onAction = (action: FacetAction, fields?: FieldValues): void => {
    // Conditional construction: exactOptionalPropertyTypes forbids an explicit
    // `fields: undefined` on the event (the Decision-2 shape).
    send(fields === undefined ? { kind: "tap", action } : { kind: "tap", action, fields });
  };

  const onSend = (text: string): void => {
    setLog((current) => [...current, { who: "You", text }]);
    send({ kind: "message", text });
  };

  return (
    <div style={styles.page}>
      {/* data-facet-stage marks the agent-drawn stage region (excludes the
          ChatDock) so the live-journey e2e tier can wait for a real stage
          paint/edit rather than a chat-dock change. Inert marker, no behavior. */}
      <div style={styles.stage} data-facet-stage>
        <StageRenderer
          tree={tree}
          onAction={onAction}
          onRecord={record}
          transition={transition}
          {...(themes !== undefined ? { themes } : {})}
        />
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
    fontFamily: DEFAULT_THEME.fontFamily?.sans ?? "sans-serif",
  },
  stage: { flex: 1 },
} as const;

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<Page />);
}
