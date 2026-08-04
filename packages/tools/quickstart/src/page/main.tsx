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
import { browserSessionKey, SseTransport } from "@facet/client";
import { validateVisitorText } from "@facet/core";
import type {
  VisitorEvent,
  ComponentDocument,
  ConversationMessage,
  FacetStage,
  FacetTheme,
  MountedComponent,
  StageRevision,
} from "@facet/core";
import { bootstrapRenderer, ConversationSurface, StageRenderer, useFacet } from "@facet/react";
import type { ComponentRegistry, RendererBootstrap } from "@facet/react";

import { AssetExplorer } from "./asset-explorer.js";

declare global {
  interface Window {
    __FACET_THEME__?: unknown;
    __FACET_INITIAL_STAGE__?: unknown;
  }
}

type QuickstartSpace = "live" | "assets";
type AcceptedBootstrap = Extract<RendererBootstrap, { readonly ok: true }>;

const EMPTY_DATA: FacetStage["data"] = Object.freeze({});
const QUICKSTART_SPACES: readonly QuickstartSpace[] = ["live", "assets"];
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

function resolvedBootstrap(registry: ComponentRegistry = DEFAULT_REGISTRY): AcceptedBootstrap {
  const rawTheme = readWindowValue("__FACET_THEME__");
  const theme = isRecord(rawTheme) ? (rawTheme as unknown as FacetTheme) : DEFAULT_THEME;
  const candidate = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry,
    theme,
  });
  if (candidate.ok) {
    return candidate;
  }
  const fallback = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry,
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

export interface PageProps {
  readonly assetExplorer?: ReactNode;
}

export function Page({ assetExplorer }: PageProps = {}): ReactNode {
  const sessionKey = useMemo(() => browserSessionKey(), []);
  const initialDocument = useMemo(readInitialDocument, []);
  const [draft, setDraft] = useState("");
  const [initialPending, setInitialPending] = useState(false);
  const [activeSpace, setActiveSpace] = useState<QuickstartSpace>("live");
  const assetsTabRef = useRef<HTMLButtonElement>(null);
  const stageRevisionRef = useRef<StageRevision>(0);
  const visitSent = useRef(false);
  const openAssets = useCallback((): void => {
    setActiveSpace("assets");
    assetsTabRef.current?.focus();
  }, []);
  const registry = useMemo(() => quickstartRegistry(openAssets), [openAssets]);
  const bootstrap = useMemo(() => resolvedBootstrap(registry), [registry]);
  const transport = useMemo(() => new SseTransport("", sessionKey), [sessionKey]);

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
    () => ({ ...styles.page, fontFamily: bootstrap.theme.foundation.typography.fontFamilySans }),
    [bootstrap.theme.foundation.typography.fontFamilySans],
  );

  return (
    <div style={pageStyle}>
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
      <div
        data-facet-assets-space
        hidden={activeSpace !== "assets"}
        style={activeSpace === "assets" ? styles.spacePanel : styles.spacePanelHidden}
      >
        {assetExplorer ?? <AssetExplorer suppressPreviewModals={activeSpace !== "assets"} />}
      </div>
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
  conversationPanel: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    borderTop: `1px solid ${DEFAULT_THEME.semantic.border.default}`,
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

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<Page />);
}
