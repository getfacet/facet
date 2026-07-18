import {
  MAX_DIAGNOSTIC_ITEM_BYTES,
  MAX_EVIDENCE_ITEMS_PER_RUN,
  RUN_STATUSES,
  type AcceptedFrameEvidenceV1,
  type EvidenceRecordV1,
  type RunStatus,
} from "../shared/run-contract.js";

export interface RunStreamIdentity {
  readonly runId: string;
  readonly generation: number;
}

export type RunEvidenceStreamItem = EvidenceRecordV1 | AcceptedFrameEvidenceV1;
export type RunStreamConnection =
  "idle" | "connecting" | "open" | "reconnecting" | "terminal" | "error";

export interface RunStreamState {
  readonly selected: RunStreamIdentity | null;
  readonly connection: RunStreamConnection;
  readonly cursor: number;
  readonly items: readonly RunEvidenceStreamItem[];
  readonly lastHeartbeatAt: number | null;
  readonly terminalStatus: RunStatus | null;
  readonly error: "invalid-event" | "stream-limit" | null;
}

export type RunStreamEvent =
  | { readonly type: "connecting" }
  | { readonly type: "open" }
  | { readonly type: "reconnecting" }
  | { readonly type: "invalid" }
  | { readonly type: "evidence"; readonly item: RunEvidenceStreamItem }
  | { readonly type: "heartbeat"; readonly ordinal: number; readonly at: number }
  | { readonly type: "terminal"; readonly status: RunStatus; readonly ordinal: number };

export interface RunEvidenceStreamOptions {
  readonly onState: (state: RunStreamState) => void;
  readonly eventSourceFactory?: (url: string) => EventSource;
  readonly now?: () => number;
}

export interface RunEvidenceStream {
  select(identity: RunStreamIdentity, evidenceUrl: string): void;
  close(): void;
  snapshot(): RunStreamState;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL_STATUSES = new Set<RunStatus>(["complete", "failed", "cancelled", "incomplete"]);

function sameIdentity(left: RunStreamIdentity | null, right: RunStreamIdentity): boolean {
  return left?.runId === right.runId && left.generation === right.generation;
}

function validIdentity(identity: RunStreamIdentity): boolean {
  return (
    UUID.test(identity.runId) &&
    Number.isSafeInteger(identity.generation) &&
    identity.generation >= 1
  );
}

export function createInitialRunStreamState(): RunStreamState {
  return Object.freeze({
    selected: null,
    connection: "idle",
    cursor: -1,
    items: Object.freeze([]),
    lastHeartbeatAt: null,
    terminalStatus: null,
    error: null,
  });
}

/** Selecting a different identity clears the prior generation instead of merging stages/traces. */
export function selectRunStream(
  state: RunStreamState,
  identity: RunStreamIdentity,
): RunStreamState {
  if (!validIdentity(identity)) throw new Error("invalid run stream identity");
  if (sameIdentity(state.selected, identity)) return state;
  return Object.freeze({
    selected: Object.freeze({ ...identity }),
    connection: "connecting",
    cursor: -1,
    items: Object.freeze([]),
    lastHeartbeatAt: null,
    terminalStatus: null,
    error: null,
  });
}

/** A callback belonging to an old run/generation is an identity-preserving no-op. */
export function applyRunStreamEvent(
  state: RunStreamState,
  identity: RunStreamIdentity,
  event: RunStreamEvent,
): RunStreamState {
  if (!sameIdentity(state.selected, identity) || state.connection === "terminal") return state;

  if (event.type === "connecting" || event.type === "open" || event.type === "reconnecting") {
    return Object.freeze({ ...state, connection: event.type, error: null });
  }
  if (event.type === "invalid") {
    return Object.freeze({ ...state, connection: "error", error: "invalid-event" });
  }
  if (event.type === "heartbeat") {
    if (!Number.isSafeInteger(event.ordinal) || event.ordinal < state.cursor || event.at < 0) {
      return Object.freeze({ ...state, connection: "error", error: "invalid-event" });
    }
    return Object.freeze({
      ...state,
      connection: "open",
      cursor: event.ordinal,
      lastHeartbeatAt: event.at,
    });
  }
  if (event.type === "terminal") {
    if (
      !TERMINAL_STATUSES.has(event.status) ||
      !Number.isSafeInteger(event.ordinal) ||
      event.ordinal < state.cursor
    ) {
      return Object.freeze({ ...state, connection: "error", error: "invalid-event" });
    }
    return Object.freeze({
      ...state,
      connection: "terminal",
      cursor: event.ordinal,
      terminalStatus: event.status,
      error: null,
    });
  }

  const { item } = event;
  if (
    item.runId !== identity.runId ||
    item.generation !== identity.generation ||
    !Number.isSafeInteger(item.ordinal) ||
    item.ordinal < 0
  ) {
    return Object.freeze({ ...state, connection: "error", error: "invalid-event" });
  }
  if (item.ordinal <= state.cursor) return state;
  if (state.items.length >= MAX_EVIDENCE_ITEMS_PER_RUN) {
    return Object.freeze({ ...state, connection: "error", error: "stream-limit" });
  }
  return Object.freeze({
    ...state,
    connection: "open",
    cursor: item.ordinal,
    items: Object.freeze([...state.items, item]),
    error: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonEvent(event: Event): unknown {
  const data = "data" in event ? Reflect.get(event, "data") : undefined;
  if (
    typeof data !== "string" ||
    new TextEncoder().encode(data).byteLength > MAX_DIAGNOSTIC_ITEM_BYTES
  ) {
    return undefined;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

function parseEvidenceItem(value: unknown): RunEvidenceStreamItem | undefined {
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    !Number.isSafeInteger(value.generation) ||
    !Number.isSafeInteger(value.ordinal)
  ) {
    return undefined;
  }
  const recordKind = value.kind;
  if (
    recordKind === "ui-in" ||
    recordKind === "diagnostic" ||
    recordKind === "overflow" ||
    recordKind === "status"
  ) {
    return value as unknown as EvidenceRecordV1;
  }
  return Array.isArray(value.patches) &&
    Array.isArray(value.says) &&
    Number.isSafeInteger(value.stageVersion)
    ? (value as unknown as AcceptedFrameEvidenceV1)
    : undefined;
}

function parseOrdinal(value: unknown): number | undefined {
  return isRecord(value) && Number.isSafeInteger(value.ordinal) && Number(value.ordinal) >= -1
    ? Number(value.ordinal)
    : undefined;
}

function parseTerminal(
  value: unknown,
): { readonly status: RunStatus; readonly ordinal: number } | undefined {
  if (!isRecord(value) || typeof value.status !== "string") return undefined;
  const ordinal = parseOrdinal(value);
  const status = RUN_STATUSES.find((candidate) => candidate === value.status);
  return ordinal === undefined || status === undefined || !TERMINAL_STATUSES.has(status)
    ? undefined
    : { status, ordinal };
}

function evidenceTarget(raw: string, identity: RunStreamIdentity, cursor: number): string {
  const browserOrigin = typeof window === "undefined" ? undefined : window.location.origin;
  const base = browserOrigin ?? "http://facet-lab.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new Error("invalid evidence stream URL");
  }
  if (
    (browserOrigin !== undefined && url.origin !== browserOrigin) ||
    (browserOrigin === undefined && url.origin !== base) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname !== `/api/runs/${identity.runId}/evidence` ||
    url.search !== ""
  ) {
    throw new Error("evidence stream URL must be same-origin and run-owned");
  }
  url.searchParams.set("after", String(cursor));
  return browserOrigin === undefined ? `${url.pathname}${url.search}` : url.href;
}

export function createRunEvidenceStream(options: RunEvidenceStreamOptions): RunEvidenceStream {
  const eventSourceFactory = options.eventSourceFactory ?? ((url: string) => new EventSource(url));
  const now = options.now ?? Date.now;
  const cursors = new Map<string, number>();
  let state = createInitialRunStreamState();
  let activeSource: EventSource | undefined;

  const publish = (identity: RunStreamIdentity, event: RunStreamEvent): void => {
    const next = applyRunStreamEvent(state, identity, event);
    if (next === state) return;
    state = next;
    cursors.set(`${identity.runId}:${String(identity.generation)}`, state.cursor);
    options.onState(state);
    if (state.connection === "terminal" || state.error === "stream-limit") {
      activeSource?.close();
      activeSource = undefined;
    }
  };

  return Object.freeze({
    select(identity: RunStreamIdentity, evidenceUrl: string) {
      if (!validIdentity(identity)) throw new Error("invalid run stream identity");
      activeSource?.close();
      const key = `${identity.runId}:${String(identity.generation)}`;
      state = selectRunStream(state, identity);
      const cursor = cursors.get(key) ?? -1;
      if (cursor >= 0) state = Object.freeze({ ...state, cursor });
      options.onState(state);

      const source = eventSourceFactory(evidenceTarget(evidenceUrl, identity, cursor));
      activeSource = source;
      const isCurrent = (): boolean =>
        activeSource === source && sameIdentity(state.selected, identity);
      source.onopen = () => {
        if (isCurrent()) publish(identity, { type: "open" });
      };
      source.onerror = () => {
        if (isCurrent()) publish(identity, { type: "reconnecting" });
      };
      source.addEventListener("evidence", (event) => {
        if (!isCurrent()) return;
        const item = parseEvidenceItem(parseJsonEvent(event));
        publish(identity, item === undefined ? { type: "invalid" } : { type: "evidence", item });
      });
      source.addEventListener("heartbeat", (event) => {
        if (!isCurrent()) return;
        const ordinal = parseOrdinal(parseJsonEvent(event));
        publish(
          identity,
          ordinal === undefined ? { type: "invalid" } : { type: "heartbeat", ordinal, at: now() },
        );
      });
      source.addEventListener("terminal", (event) => {
        if (!isCurrent()) return;
        const terminal = parseTerminal(parseJsonEvent(event));
        publish(
          identity,
          terminal === undefined ? { type: "invalid" } : { type: "terminal", ...terminal },
        );
      });
    },
    close() {
      activeSource?.close();
      activeSource = undefined;
      state = createInitialRunStreamState();
    },
    snapshot: () => state,
  });
}
