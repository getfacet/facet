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
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { browserSessionKey, SseTransport } from "@facet/client";
import { validateTheme, validateVisitorText } from "@facet/core";
import type {
  VisitorEvent,
  ComponentDocument,
  ConversationMessage,
  FacetStage,
  FacetTheme,
  MountedComponent,
  StageRevision,
} from "@facet/core";
import { ConversationSurface, StageRenderer, useFacet } from "@facet/react";
import type { ComponentRegistry } from "@facet/react";

import {
  resolveQuickstartPageActiveDesign,
  type QuickstartPageActiveDesign,
  type QuickstartPageActiveDesignError,
} from "./active-design.js";
import { AssetExplorer } from "./asset-explorer.js";
import type { QuickstartDesignOverlay } from "../design-overlay.js";

declare global {
  interface Window {
    __FACET_THEME__?: unknown;
    __FACET_INITIAL_STAGE__?: unknown;
    __FACET_POST_TIMEOUT_MS__?: unknown;
  }
}

type QuickstartSpace = "live" | "assets";

const EMPTY_DATA: FacetStage["data"] = Object.freeze({});
const QUICKSTART_SPACES: readonly QuickstartSpace[] = ["live", "assets"];
const QUICKSTART_POST_TIMEOUT_MS = 130_250;
const CHAT_SURFACE_CSS = `
[data-facet-chat-conversation] [data-facet-conversation] {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  max-height: min(14rem, calc(100vh - 18rem));
  overflow-y: auto;
  padding: 0.125rem;
}

[data-facet-chat-conversation] [data-facet-message-role],
[data-facet-chat-conversation] [data-facet-conversation-error] {
  box-sizing: border-box;
  max-width: 86%;
  border-radius: 0.5rem;
  padding: 0.625rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-facet-chat-conversation] [data-facet-message-role="visitor"] {
  align-self: flex-end;
  background: #1f4f52;
  color: #ffffff;
}

[data-facet-chat-conversation] [data-facet-message-role="assistant"] {
  align-self: flex-start;
  background: #f6ead2;
  color: #171410;
}

[data-facet-chat-conversation] [data-facet-conversation-error] {
  align-self: stretch;
  max-width: 100%;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}
`;
let localEventId = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWindowValue(
  key: "__FACET_THEME__" | "__FACET_INITIAL_STAGE__" | "__FACET_POST_TIMEOUT_MS__",
): unknown {
  try {
    return window[key];
  } catch {
    return undefined;
  }
}

function readPostTimeoutMs(): number {
  const raw = readWindowValue("__FACET_POST_TIMEOUT_MS__");
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 1
    ? raw
    : QUICKSTART_POST_TIMEOUT_MS;
}

function readShellTheme(): FacetTheme {
  const rawTheme = readWindowValue("__FACET_THEME__");
  if (!isRecord(rawTheme)) {
    return DEFAULT_THEME;
  }
  const theme = validateTheme(rawTheme, { catalog: DEFAULT_CATALOG });
  return theme.ok ? theme.theme : DEFAULT_THEME;
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

function quickstartRegistry(onOpenAssets: () => void): ComponentRegistry {
  const DefaultModal = DEFAULT_REGISTRY["Modal"];
  if (DefaultModal === undefined) {
    return DEFAULT_REGISTRY;
  }
  const QuickstartModal: MountedComponent<ReactNode, ReactNode> = function QuickstartModal(mount) {
    return (
      <DefaultModal {...mount}>
        {mount.children}
        <button
          type="button"
          data-facet-open-assets-from-modal
          style={styles.modalAssetsButton}
          onClick={onOpenAssets}
        >
          Open Assets
        </button>
      </DefaultModal>
    );
  };
  return Object.freeze({ ...DEFAULT_REGISTRY, Modal: QuickstartModal });
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

export interface PageProps {
  readonly assetExplorer?: ReactNode;
  readonly overlay?: QuickstartDesignOverlay;
}

export interface QuickstartDesignPageMountOptions {
  readonly overlay?: QuickstartDesignOverlay;
}

export function Page({ assetExplorer, overlay }: PageProps = {}): ReactNode {
  const [activeSpace, setActiveSpaceState] = useState<QuickstartSpace>("live");
  const assetsTabRef = useRef<HTMLButtonElement>(null);
  const openAssets = useCallback((): void => {
    setActiveSpaceState("assets");
    assetsTabRef.current?.focus();
  }, []);
  const setActiveSpace = useCallback((space: QuickstartSpace): void => {
    setActiveSpaceState(space);
  }, []);
  const shellTheme = useMemo(readShellTheme, []);
  const registry = useMemo(() => quickstartRegistry(openAssets), [openAssets]);
  const activeDesign = useMemo(
    () =>
      resolveQuickstartPageActiveDesign({
        ...(overlay === undefined ? {} : { overlay }),
        defaultRegistry: registry,
        theme: shellTheme,
      }),
    [overlay, registry, shellTheme],
  );

  if (!activeDesign.ok) {
    return <QuickstartActiveDesignErrorView error={activeDesign.error} />;
  }

  return (
    <QuickstartPageContent
      activeDesign={activeDesign.design}
      activeSpace={activeSpace}
      assetExplorer={assetExplorer}
      assetsTabRef={assetsTabRef}
      openAssets={openAssets}
      setActiveSpace={setActiveSpace}
    />
  );
}

interface QuickstartPageContentProps {
  readonly activeDesign: QuickstartPageActiveDesign;
  readonly activeSpace: QuickstartSpace;
  readonly assetExplorer?: ReactNode;
  readonly assetsTabRef: RefObject<HTMLButtonElement | null>;
  readonly openAssets: () => void;
  readonly setActiveSpace: (space: QuickstartSpace) => void;
}

function QuickstartPageContent({
  activeDesign,
  activeSpace,
  assetExplorer,
  assetsTabRef,
  openAssets,
  setActiveSpace,
}: QuickstartPageContentProps): ReactNode {
  const sessionKey = useMemo(() => browserSessionKey(), []);
  const initialDocument = useMemo(readInitialDocument, []);
  const [draft, setDraft] = useState("");
  const [initialPending, setInitialPending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const stageRevisionRef = useRef<StageRevision>(0);
  const visitSent = useRef(false);
  const bootstrap = activeDesign.bootstrap;
  const postTimeoutMs = useMemo(readPostTimeoutMs, []);
  const transport = useMemo(
    () => new SseTransport("", sessionKey, { postTimeoutMs }),
    [postTimeoutMs, sessionKey],
  );

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
    document.body.style.background = bootstrap.theme.semantic.canvas.background;
    document.body.style.color = bootstrap.theme.semantic.text.default;
  }, [bootstrap.theme]);

  useEffect(() => {
    if (visitSent.current || initialDocument !== undefined) {
      return;
    }
    visitSent.current = true;
    setInitialPending(true);
    void transport
      .send(
        visitorEvent(
          "visit",
          facet.stage.document?.entry ?? "home",
          facet.transition.stageRevision,
        ),
      )
      .catch((error: unknown) => {
        console.error("[facet] initial visit send failed:", error);
      })
      .finally(() => {
        setInitialPending(false);
      });
  }, [facet.stage.document?.entry, facet.transition.stageRevision, initialDocument, transport]);

  const draftHasContent = draft.trim().length > 0;
  const sendDisabled = !draftHasContent || facet.pending || initialPending;
  const submitDraft = useCallback((): void => {
    if (draft.trim().length === 0) {
      return;
    }
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
  }, [draft, facet, initialPending]);
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitDraft();
  };
  const onMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    submitDraft();
  };
  const pageStyle = useMemo(
    () => ({ ...styles.page, fontFamily: bootstrap.theme.foundation.typography.fontFamilySans }),
    [bootstrap.theme.foundation.typography.fontFamilySans],
  );

  return (
    <div style={pageStyle}>
      <style>{CHAT_SURFACE_CSS}</style>
      <header style={styles.pageHeader}>
        <div aria-label="Quickstart spaces" role="group" style={styles.spaceTabs}>
          {QUICKSTART_SPACES.map((space) => (
            <button
              aria-pressed={activeSpace === space}
              data-facet-quickstart-tab={space}
              key={space}
              onClick={() => {
                if (space === "assets") {
                  openAssets();
                  return;
                }
                setActiveSpace(space);
              }}
              ref={space === "assets" ? assetsTabRef : undefined}
              style={activeSpace === space ? styles.spaceTabActive : styles.spaceTab}
              type="button"
            >
              {space === "live" ? "Live" : "Assets"}
            </button>
          ))}
        </div>
      </header>
      <div
        data-facet-live-space
        hidden={activeSpace !== "live"}
        style={activeSpace === "live" ? styles.spacePanel : styles.spacePanelHidden}
      >
        <div
          style={styles.stage}
          data-facet-stage
          data-facet-stage-revision={facet.transition.stageRevision}
        >
          <StageRenderer
            bootstrap={bootstrap}
            document={facet.stage.document}
            data={facet.stage.data}
            suppressModals={activeSpace !== "live"}
            onEvent={facet.sendEvent}
          />
        </div>
        <button
          aria-controls="facet-quickstart-chat"
          aria-expanded={chatOpen}
          aria-label={chatOpen ? "Close chat" : "Open chat"}
          data-facet-chat-toggle
          onClick={() => {
            setChatOpen((open) => !open);
          }}
          style={styles.chatToggle}
          title={chatOpen ? "Close chat" : "Open chat"}
          type="button"
        >
          {chatOpen ? (
            <span aria-hidden="true" style={styles.closeToggleIcon}>
              <span style={styles.closeToggleLineA} />
              <span style={styles.closeToggleLineB} />
            </span>
          ) : (
            <span aria-hidden="true" style={styles.chatIcon}>
              <span style={styles.chatIconLineWide} />
              <span style={styles.chatIconLine} />
              <span style={styles.chatIconTail} />
            </span>
          )}
        </button>
        <section
          aria-hidden={!chatOpen}
          aria-label="Chat"
          data-facet-chat-drawer
          id="facet-quickstart-chat"
          style={chatOpen ? styles.conversationPanel : styles.conversationPanelClosed}
        >
          <div style={styles.chatHeader}>
            <div style={styles.chatIdentity}>
              <div>
                <div style={styles.chatTitle}>Facet agent</div>
              </div>
            </div>
            <div style={styles.chatHeaderActions}>
              <span
                data-facet-chat-status
                style={facet.pending ? styles.chatStatusBusy : styles.chatStatus}
              >
                {facet.pending ? "Working" : "Ready"}
              </span>
            </div>
          </div>
          {facet.conversation.length > 0 || facet.validationError !== undefined ? (
            <div data-facet-chat-conversation style={styles.chatConversation}>
              <ConversationSurface
                items={facet.conversation}
                validationError={facet.validationError}
              />
            </div>
          ) : null}
          <form data-facet-message-form style={styles.messageForm} onSubmit={onSubmit}>
            <div style={styles.composerBox}>
              <textarea
                aria-label="Message"
                placeholder="Ask Facet to build or revise this live page..."
                ref={messageInputRef}
                tabIndex={chatOpen ? 0 : -1}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={onMessageKeyDown}
                style={styles.messageInput}
              />
              <div style={styles.composerActions}>
                <div style={styles.composerMeta}>
                  <span style={styles.composerHint}>
                    {initialPending ? "Connecting..." : "Enter to send, Shift+Enter for newline"}
                  </span>
                </div>
                <button
                  aria-label="Send message"
                  type="submit"
                  disabled={sendDisabled || !chatOpen}
                  style={
                    sendDisabled || !chatOpen ? styles.messageButtonDisabled : styles.messageButton
                  }
                >
                  <span style={styles.visuallyHidden}>Send</span>
                  <span aria-hidden="true" style={styles.sendArrow}>
                    <span style={styles.sendArrowStem} />
                    <span style={styles.sendArrowHead} />
                  </span>
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
      <div
        data-facet-assets-space
        hidden={activeSpace !== "assets"}
        style={activeSpace === "assets" ? styles.spacePanel : styles.spacePanelHidden}
      >
        {assetExplorer ?? (
          <AssetExplorer
            activeDesign={activeDesign}
            suppressPreviewModals={activeSpace !== "assets"}
          />
        )}
      </div>
    </div>
  );
}

function QuickstartActiveDesignErrorView({
  error,
}: {
  readonly error: QuickstartPageActiveDesignError;
}): ReactNode {
  const at = error.at.length === 0 ? "" : ` at ${error.at}`;
  return (
    <main data-facet-active-design-error style={styles.activeDesignError}>
      <h1 style={styles.activeDesignErrorTitle}>Active design failed</h1>
      <p style={styles.activeDesignErrorBody}>
        {error.code}
        {at}: {error.detail}
      </p>
    </main>
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
    maxWidth: "1120px",
    margin: "0 auto",
    minHeight: "100vh",
    boxSizing: "border-box",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  pageHeader: {
    display: "flex",
    justifyContent: "flex-start",
  },
  spaceTabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  spaceTab: {
    border: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
    borderRadius: "0.375rem",
    background: "#ffffff",
    color: DEFAULT_THEME.semantic.text.default,
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.625rem 0.75rem",
  },
  spaceTabActive: {
    border: "1px solid #1f4f52",
    borderRadius: "0.375rem",
    background: "#1f4f52",
    color: "#ffffff",
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.625rem 0.75rem",
  },
  spacePanel: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  spacePanelHidden: {
    display: "none",
  },
  stage: { flex: 1, minWidth: 0 },
  chatToggle: {
    position: "fixed",
    right: "1.5rem",
    bottom: "1.5rem",
    zIndex: 21,
    width: "3.25rem",
    height: "3.25rem",
    border: "1px solid #1f4f52",
    borderRadius: "9999px",
    background: "#1f4f52",
    color: "#ffffff",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.2)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    transition: "transform 180ms ease, box-shadow 180ms ease, background 180ms ease",
  },
  chatIcon: {
    position: "relative",
    width: "1.45rem",
    height: "1.1rem",
    border: "2px solid #ffffff",
    borderRadius: "0.375rem",
    boxSizing: "border-box",
    display: "block",
  },
  chatIconLineWide: {
    position: "absolute",
    left: "0.25rem",
    right: "0.25rem",
    top: "0.25rem",
    height: "2px",
    borderRadius: "9999px",
    background: "#ffffff",
  },
  chatIconLine: {
    position: "absolute",
    left: "0.25rem",
    right: "0.45rem",
    top: "0.55rem",
    height: "2px",
    borderRadius: "9999px",
    background: "#ffffff",
  },
  chatIconTail: {
    position: "absolute",
    right: "0.15rem",
    bottom: "-0.35rem",
    width: "0.45rem",
    height: "0.45rem",
    borderRight: "2px solid #ffffff",
    borderBottom: "2px solid #ffffff",
    background: "#1f4f52",
    transform: "rotate(45deg)",
  },
  closeToggleIcon: {
    position: "relative",
    width: "1.25rem",
    height: "1.25rem",
    display: "block",
  },
  closeToggleLineA: {
    position: "absolute",
    left: "0.125rem",
    right: "0.125rem",
    top: "0.5625rem",
    height: "2px",
    borderRadius: "9999px",
    background: "#ffffff",
    transform: "rotate(45deg)",
  },
  closeToggleLineB: {
    position: "absolute",
    left: "0.125rem",
    right: "0.125rem",
    top: "0.5625rem",
    height: "2px",
    borderRadius: "9999px",
    background: "#ffffff",
    transform: "rotate(-45deg)",
  },
  conversationPanel: {
    position: "fixed",
    right: "1.5rem",
    bottom: "5.25rem",
    zIndex: 19,
    width: "min(28rem, calc(100vw - 2rem))",
    maxHeight: "min(30rem, calc(100vh - 7rem))",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxSizing: "border-box",
    border: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
    borderRadius: "0.5rem",
    background: DEFAULT_THEME.semantic.surface.default,
    boxShadow: "0 24px 80px rgba(23, 20, 16, 0.22)",
    padding: "1rem",
    overflow: "hidden",
    opacity: 1,
    pointerEvents: "auto",
    transform: "translateY(0) scale(1)",
    transformOrigin: "bottom right",
    transition:
      "opacity 160ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1), visibility 180ms ease",
    visibility: "visible",
  },
  conversationPanelClosed: {
    position: "fixed",
    right: "1.5rem",
    bottom: "5.25rem",
    zIndex: 19,
    width: "min(28rem, calc(100vw - 2rem))",
    maxHeight: "min(30rem, calc(100vh - 7rem))",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    boxSizing: "border-box",
    border: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
    borderRadius: "0.5rem",
    background: DEFAULT_THEME.semantic.surface.default,
    boxShadow: "0 12px 40px rgba(23, 20, 16, 0.12)",
    padding: "1rem",
    overflow: "hidden",
    opacity: 0,
    pointerEvents: "none",
    transform: "translateY(0.75rem) scale(0.94)",
    transformOrigin: "bottom right",
    transition:
      "opacity 160ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1), visibility 180ms ease",
    visibility: "hidden",
  },
  chatHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
  },
  chatIdentity: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  chatTitle: {
    color: DEFAULT_THEME.semantic.text.default,
    fontSize: "0.9375rem",
    fontWeight: 900,
    lineHeight: 1.2,
  },
  chatHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  chatStatus: {
    border: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
    borderRadius: "9999px",
    background: DEFAULT_THEME.semantic.surface.muted,
    color: DEFAULT_THEME.semantic.text.muted,
    fontSize: "0.75rem",
    fontWeight: 800,
    lineHeight: 1,
    padding: "0.4375rem 0.625rem",
    whiteSpace: "nowrap",
  },
  chatStatusBusy: {
    border: `1px solid ${DEFAULT_THEME.semantic.status.infoBorder}`,
    borderRadius: "9999px",
    background: DEFAULT_THEME.semantic.status.infoBg,
    color: DEFAULT_THEME.semantic.status.infoText,
    fontSize: "0.75rem",
    fontWeight: 800,
    lineHeight: 1,
    padding: "0.4375rem 0.625rem",
    whiteSpace: "nowrap",
  },
  chatConversation: {
    border: `1px solid ${DEFAULT_THEME.semantic.border.muted}`,
    borderRadius: "0.5rem",
    background: DEFAULT_THEME.semantic.surface.raised,
    padding: "0.75rem",
    overflow: "hidden",
  },
  messageForm: {
    display: "block",
  },
  composerBox: {
    border: `1px solid ${DEFAULT_THEME.semantic.border.strong}`,
    borderRadius: "0.5rem",
    background: "#ffffff",
    boxShadow: "0 1px 2px rgba(23, 20, 16, 0.08)",
    padding: "0.75rem",
  },
  messageInput: {
    width: "100%",
    minHeight: "4rem",
    maxHeight: "8rem",
    boxSizing: "border-box",
    border: 0,
    outline: "none",
    resize: "vertical",
    background: "transparent",
    color: DEFAULT_THEME.semantic.text.default,
    font: "inherit",
    fontSize: "0.9375rem",
    lineHeight: 1.45,
    padding: 0,
  },
  composerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    marginTop: "0.625rem",
  },
  composerMeta: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  composerHint: {
    color: DEFAULT_THEME.semantic.text.subtle,
    fontSize: "0.75rem",
    lineHeight: 1.35,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  messageButton: {
    width: "2.25rem",
    height: "2.25rem",
    border: "1px solid #171410",
    borderRadius: "9999px",
    background: "#171410",
    color: "#ffffff",
    cursor: "pointer",
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
  },
  messageButtonDisabled: {
    width: "2.25rem",
    height: "2.25rem",
    border: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
    borderRadius: "9999px",
    background: DEFAULT_THEME.semantic.disabled.background,
    color: DEFAULT_THEME.semantic.disabled.text,
    cursor: "not-allowed",
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
  },
  sendArrow: {
    position: "relative",
    width: "1rem",
    height: "1rem",
    display: "block",
  },
  sendArrowStem: {
    position: "absolute",
    left: "0.4375rem",
    top: "0.1875rem",
    width: "0.125rem",
    height: "0.625rem",
    borderRadius: "9999px",
    background: "currentColor",
  },
  sendArrowHead: {
    position: "absolute",
    left: "0.3125rem",
    top: "0.1875rem",
    width: "0.4375rem",
    height: "0.4375rem",
    borderLeft: "0.125rem solid currentColor",
    borderTop: "0.125rem solid currentColor",
    transform: "rotate(45deg)",
  },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  activeDesignError: {
    boxSizing: "border-box",
    display: "grid",
    gap: "0.75rem",
    margin: "0 auto",
    maxWidth: "42rem",
    minHeight: "100vh",
    padding: "24px",
    placeContent: "center",
  },
  activeDesignErrorTitle: {
    color: DEFAULT_THEME.semantic.status.dangerText,
    fontSize: "1.25rem",
    fontWeight: 750,
    lineHeight: 1.2,
    margin: 0,
  },
  activeDesignErrorBody: {
    border: `1px solid ${DEFAULT_THEME.semantic.status.dangerBorder}`,
    borderRadius: "0.375rem",
    color: DEFAULT_THEME.semantic.status.dangerText,
    fontSize: "0.875rem",
    lineHeight: 1.45,
    margin: 0,
    padding: "0.875rem",
  },
  modalAssetsButton: {
    alignSelf: "flex-start",
    border: "1px solid #1f4f52",
    borderRadius: "0.375rem",
    background: "#1f4f52",
    color: "#ffffff",
    cursor: "pointer",
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.625rem 0.75rem",
  },
} as const;

export function mountQuickstartDesignPage(options: QuickstartDesignPageMountOptions = {}): void {
  const rootElement = document.getElementById("root");
  if (rootElement === null) return;
  const pageProps = options.overlay === undefined ? {} : { overlay: options.overlay };
  createRoot(rootElement).render(<Page {...pageProps} />);
}

function shouldAutoMountQuickstartPage(): boolean {
  const globalScope = globalThis as {
    readonly __FACET_QUICKSTART_DISABLE_AUTOMOUNT__?: boolean;
  };
  return globalScope.__FACET_QUICKSTART_DISABLE_AUTOMOUNT__ !== true;
}

if (shouldAutoMountQuickstartPage()) {
  mountQuickstartDesignPage();
}
