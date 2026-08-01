/**
 * The served page (spec Decision 3) — the browser entry tsup bundles to
 * `dist/page/app.js` at package build time (react + @facet/client + @facet/react
 * inlined; the quickstart server streams it as `/app.js`).
 *
 * Same-origin by construction: the transport talks to `""` (its own origin), so
 * the page only ever speaks the existing SSE+POST protocol back to the wrapper
 * that served it — no new client network capability (invariant #7).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { browserVisitorId, SseTransport } from "@facet/client";
import { validateVisitorText } from "@facet/core";
import type {
  VisitorEvent,
  ComponentDocument,
  ConversationMessage,
  FacetStage,
  FacetTheme,
  StageRevision,
} from "@facet/core";
import { bootstrapRenderer, ConversationSurface, StageRenderer, useFacet } from "@facet/react";
import type { RendererBootstrap } from "@facet/react";

declare global {
  interface Window {
    __FACET_THEME__?: unknown;
    __FACET_INITIAL_STAGE__?: unknown;
  }
}

type AcceptedBootstrap = Extract<RendererBootstrap, { readonly ok: true }>;

const EMPTY_DATA: FacetStage["data"] = Object.freeze({});
let localEventId = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWindowValue(key: "__FACET_THEME__" | "__FACET_INITIAL_STAGE__"): unknown {
  try {
    return window[key];
  } catch {
    return undefined;
  }
}

function readInitialDocument(): ComponentDocument | undefined {
  const raw = readWindowValue("__FACET_INITIAL_STAGE__");
  if (!isRecord(raw)) {
    return undefined;
  }
  if (
    typeof raw["entry"] !== "string" ||
    !Array.isArray(raw["screens"]) ||
    !raw["screens"].every((screen) => typeof screen === "string") ||
    !isRecord(raw["nodes"])
  ) {
    return undefined;
  }
  return raw as unknown as ComponentDocument;
}

function resolvedBootstrap(): AcceptedBootstrap {
  const rawTheme = readWindowValue("__FACET_THEME__");
  const theme = isRecord(rawTheme) ? (rawTheme as unknown as FacetTheme) : DEFAULT_THEME;
  const candidate = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry: DEFAULT_REGISTRY,
    theme,
  });
  if (candidate.ok) {
    return candidate;
  }
  const fallback = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry: DEFAULT_REGISTRY,
    theme: DEFAULT_THEME,
  });
  if (fallback.ok) {
    return fallback;
  }
  throw new Error("Facet quickstart default renderer bootstrap failed.");
}

function nextEventId(prefix: string): string {
  localEventId += 1;
  return `${prefix}-${randomEventSuffix()}-${localEventId}`;
}

function randomEventSuffix(): string {
  const cryptoProvider = globalThis.crypto;
  if (typeof cryptoProvider?.randomUUID === "function") {
    return cryptoProvider.randomUUID();
  }
  if (typeof cryptoProvider?.getRandomValues === "function") {
    const bytes = new Uint8Array(8);
    cryptoProvider.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function visitorEvent(
  eventName: string,
  screen: string,
  stageRevision: StageRevision,
): VisitorEvent {
  return Object.freeze({
    eventId: nextEventId(eventName),
    eventName,
    sourceNodeId: "visitor",
    screen,
    stageRevision,
    collect: Object.freeze({}),
  });
}

function Page(): ReactNode {
  const sessionKey = useMemo(() => browserVisitorId(), []);
  const initialDocument = useMemo(readInitialDocument, []);
  const bootstrap = useMemo(resolvedBootstrap, []);
  const transport = useMemo(() => new SseTransport("", sessionKey), [sessionKey]);
  const [draft, setDraft] = useState("");
  const [initialPending, setInitialPending] = useState(false);
  const stageRevisionRef = useRef<StageRevision>(0);
  const visitSent = useRef(false);

  const sendVisitorEvent = useCallback(
    (event: VisitorEvent): Promise<void> =>
      transport.send(event).catch((error: unknown) => {
        console.error("[facet] event send failed:", error);
        throw error;
      }),
    [transport],
  );
  const sendVisitorMessage = useCallback(
    (message: ConversationMessage): Promise<void> =>
      transport
        .sendMessage({
          messageId: message.turnId,
          text: message.text,
          screen: "home",
          stageRevision: stageRevisionRef.current,
        })
        .catch((error: unknown) => {
          console.error("[facet] message send failed:", error);
          throw error;
        }),
    [transport],
  );

  const facet = useFacetWithStableInitialStage(
    transport,
    initialDocument,
    sendVisitorEvent,
    sendVisitorMessage,
  );

  useEffect(() => {
    stageRevisionRef.current = facet.transition.stageRevision;
  }, [facet.transition.stageRevision]);

  useEffect(() => {
    document.body.style.background = bootstrap.theme.color.background;
    document.body.style.color = bootstrap.theme.color.text;
  }, [bootstrap.theme]);

  useEffect(() => {
    if (visitSent.current) {
      return;
    }
    visitSent.current = true;
    setInitialPending(true);
    void transport
      .send(
        visitorEvent(
          "visit",
          facet.stage.document?.entry ?? initialDocument?.entry ?? "home",
          facet.transition.stageRevision,
        ),
      )
      .catch((error: unknown) => {
        console.error("[facet] initial visit send failed:", error);
      })
      .finally(() => {
        setInitialPending(false);
      });
  }, [
    facet.stage.document?.entry,
    facet.transition.stageRevision,
    initialDocument?.entry,
    transport,
  ]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const draftIsValid = validateVisitorText(draft);
    if (!draftIsValid) {
      facet.sendMessage(draft);
      return;
    }
    if (facet.pending || initialPending) {
      return;
    }
    facet.sendMessage(draft);
    setDraft("");
  };
  const pageStyle = useMemo(
    () => ({ ...styles.page, fontFamily: bootstrap.theme.fontFamily.sans }),
    [bootstrap.theme.fontFamily.sans],
  );

  return (
    <div style={pageStyle}>
      <div
        style={styles.stage}
        data-facet-stage
        data-facet-stage-revision={facet.transition.stageRevision}
      >
        <StageRenderer
          bootstrap={bootstrap}
          document={facet.stage.document}
          data={facet.stage.data}
          onEvent={facet.sendEvent}
        />
      </div>
      <section style={styles.conversationPanel}>
        <ConversationSurface items={facet.conversation} validationError={facet.validationError} />
        <form data-facet-message-form style={styles.messageForm} onSubmit={onSubmit}>
          <textarea
            aria-label="Message"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            style={styles.messageInput}
          />
          <button
            type="submit"
            disabled={facet.pending || initialPending}
            style={styles.messageButton}
          >
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

function useFacetWithStableInitialStage(
  transport: SseTransport,
  initialDocument: ComponentDocument | undefined,
  onVisitorEvent: (event: VisitorEvent) => Promise<void>,
  onVisitorMessage: (message: ConversationMessage) => Promise<void>,
) {
  const initialStage = useMemo(
    (): FacetStage | undefined =>
      initialDocument === undefined
        ? undefined
        : Object.freeze({ document: initialDocument, data: EMPTY_DATA }),
    [initialDocument],
  );
  return useFacet({
    transport,
    ...(initialStage === undefined ? {} : { initialStage }),
    onVisitorEvent,
    onVisitorMessage,
  });
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
  },
  stage: { flex: 1 },
  conversationPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    borderTop: `1px solid ${DEFAULT_THEME.color.border}`,
    paddingTop: "1rem",
  },
  messageForm: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "flex-start",
  },
  messageInput: {
    flex: 1,
    minHeight: "4rem",
    boxSizing: "border-box",
    font: "inherit",
  },
  messageButton: {
    font: "inherit",
  },
} as const;

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<Page />);
}
