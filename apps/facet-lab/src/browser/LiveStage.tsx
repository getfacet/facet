import { useEffect, useMemo, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import { SseTransport } from "@facet/client";
import { StageRenderer, useFacet } from "@facet/react";

import type { ColorMode } from "../shared/run-contract.js";

type RendererProps = ComponentProps<typeof StageRenderer>;
type ViewSnapshot = Parameters<NonNullable<RendererProps["onViewSnapshot"]>>[0];
type Action = Parameters<NonNullable<RendererProps["onAction"]>>[0];
type Fields = Parameters<NonNullable<RendererProps["onAction"]>>[1];
type LocalTap = Parameters<NonNullable<RendererProps["onRecord"]>>[0];

export interface LiveStageIdentity {
  readonly runId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly generation: number;
  readonly streamUrl: string;
}

export interface LiveStageMessage {
  /** Stable UI activation id. Re-renders with the same id cannot duplicate a turn. */
  readonly id: string;
  readonly text: string;
}

export interface LiveStageViewEvidence {
  readonly runId: string;
  readonly generation: number;
  readonly view: ViewSnapshot;
}

export interface LiveStageProps {
  readonly run: LiveStageIdentity;
  readonly theme?: RendererProps["theme"];
  readonly colorMode?: ColorMode;
  readonly message?: LiveStageMessage | null;
  readonly className?: string;
  readonly onViewEvidence?: (evidence: LiveStageViewEvidence) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function liveStageIdentityKey(run: LiveStageIdentity): string {
  if (
    !UUID.test(run.runId) ||
    !UUID.test(run.sessionId) ||
    !UUID.test(run.visitorId) ||
    !Number.isSafeInteger(run.generation) ||
    run.generation < 1
  ) {
    throw new Error("invalid live stage identity");
  }
  return `${run.runId}:${run.sessionId}:${run.visitorId}:${String(run.generation)}`;
}

function transportBaseUrl(run: LiveStageIdentity): string {
  const browserOrigin =
    typeof window === "undefined" ? "http://facet-lab.invalid" : window.location.origin;
  let stream: URL;
  try {
    stream = new URL(run.streamUrl, browserOrigin);
  } catch {
    throw new Error("invalid live stage stream URL");
  }
  if (
    stream.origin !== browserOrigin ||
    stream.username !== "" ||
    stream.password !== "" ||
    stream.hash !== "" ||
    stream.pathname !== "/stream" ||
    stream.searchParams.size !== 1 ||
    stream.searchParams.get("visitorId") !== run.visitorId
  ) {
    throw new Error("live stage stream must be same-origin and visitor-owned");
  }
  return typeof window === "undefined" ? "" : window.location.origin;
}

function withView<T extends LocalTap>(event: T, view: ViewSnapshot | undefined): T {
  return (view === undefined ? event : { ...event, view }) as T;
}

function LiveStageSession({
  run,
  theme,
  colorMode,
  message,
  className,
  onViewEvidence,
}: LiveStageProps): ReactNode {
  const visitor = useMemo(() => Object.freeze({ visitorId: run.visitorId }), [run.visitorId]);
  const transport = useMemo(
    () => new SseTransport(transportBaseUrl(run), visitor),
    [run.runId, run.sessionId, run.visitorId, run.generation, run.streamUrl, visitor],
  );
  const facet = useFacet(transport);
  const latestView = useRef<ViewSnapshot | undefined>(undefined);
  const pendingLocalTaps = useRef<LocalTap[]>([]);
  const sentMessageId = useRef<string | undefined>(undefined);

  useEffect(() => {
    facet.send({
      kind: "visit",
      visitor,
      ...(latestView.current === undefined ? {} : { view: latestView.current }),
    });
  }, [facet.send, visitor]);

  useEffect(() => {
    if (message === null || message === undefined || message.id === sentMessageId.current) return;
    if (message.id.length === 0 || message.id.length > 200 || message.text.length > 20_000) return;
    sentMessageId.current = message.id;
    facet.send({
      kind: "message",
      text: message.text,
      ...(latestView.current === undefined ? {} : { view: latestView.current }),
    });
  }, [facet.send, message]);

  const handleAction = (action: Action, fields?: Fields): void => {
    facet.send({
      kind: "tap",
      action,
      ...(fields === undefined ? {} : { fields }),
      ...(latestView.current === undefined ? {} : { view: latestView.current }),
    });
  };
  const handleRecord = (tap: LocalTap): void => {
    pendingLocalTaps.current.push(tap);
  };
  const handleView = (view: ViewSnapshot): void => {
    latestView.current = view;
    const taps = pendingLocalTaps.current.splice(0);
    for (const tap of taps) {
      facet.record(withView(tap, view));
    }
    onViewEvidence?.({ runId: run.runId, generation: run.generation, view });
  };

  return (
    <section
      className={className}
      data-run-id={run.runId}
      data-run-generation={run.generation}
      aria-label="Live Facet stage"
    >
      <StageRenderer
        tree={facet.tree}
        transition={facet.transition}
        onAction={handleAction}
        onRecord={handleRecord}
        onViewSnapshot={handleView}
        {...(theme === undefined ? {} : { theme })}
        {...(colorMode === undefined ? {} : { colorMode })}
      />
      <div aria-live="polite" aria-label="Agent messages">
        {facet.chat.map((text, index) => (
          <p key={`${String(index)}:${text}`}>{text}</p>
        ))}
      </div>
    </section>
  );
}

/**
 * Remounts the complete Facet subscription on identity change. Content has no local setter:
 * it can enter only through SseTransport → useFacet → StageRenderer.
 */
export function LiveStage(props: LiveStageProps): ReactNode {
  return <LiveStageSession key={liveStageIdentityKey(props.run)} {...props} />;
}
