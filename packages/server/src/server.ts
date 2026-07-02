import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  createSerialQueue,
  type AgentEventFrame,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { FacetRuntime, type Sink, type StageStore } from "@facet/runtime";
import { isStaleLateResult } from "./late.js";

/**
 * The reference Facet transport: a tiny Node server carrying events to an agent
 * and streaming patches back — dependency-free (Node http only).
 *
 * Two channels, both SSE + POST so an agent behind NAT only ever dials OUT:
 * - browser side: `GET /stream?visitorId=…` (SSE) + `POST /event`.
 * - agent side:   `GET /agent/stream?agentId=…` (SSE) + `POST /agent/control`.
 *
 * An external agent that holds `/agent/stream` becomes the brain for `agentId`;
 * it is exposed to the runtime as an ordinary `FacetAgent` (see RemoteAgent), so
 * the runtime treats remote and in-process agents identically. If no external
 * agent is connected, the optional in-process `agent` is used as a fallback.
 *
 * TRUST MODEL: this is a REFERENCE transport for local/self-hosted single-operator
 * use with public/anonymous pages — NOT a hardened multi-tenant server. By default
 * the `/agent/*` channel is unauthenticated (set `agentToken` to require a secret)
 * and `visitorId` is trusted verbatim as the session key. Put your own auth in
 * front of it for multi-tenant or sensitive-per-visitor deployments. See SECURITY.md.
 */
export interface FacetServerOptions {
  readonly port: number;
  readonly agentId: string;
  /** In-process fallback used when no external agent is connected. */
  readonly agent?: FacetAgent;
  /** How long to wait for a remote agent's control response (default 120s — a
   * persistent session's cold first turn includes model + MCP startup). A turn
   * that outlives this gets a non-terminal interim note; its real result is
   * delivered late (see the late window) when the agent finally posts it. */
  readonly agentTimeoutMs?: number;
  /** How long an agent stream may go without a heartbeat before it's reaped
   * (default 30s). The reaper polls at `min(10s, agentStaleMs)`. */
  readonly agentStaleMs?: number;
  /** Shared secret required on the `/agent/*` channel. When set, an agent must send a matching `x-facet-token` header. */
  readonly agentToken?: string;
  /** Page shown to a fresh visitor when no agent is connected (the offline face). */
  readonly offlineFace?: FacetTree;
  /** Where the page lives — defaults to in-memory. Pass a durable one to survive restarts. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes — store, forward, or drop. Defaults to in-memory. */
  readonly sink?: Sink;
}

const DEFAULT_OFFLINE_FACE: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      style: { direction: "col", gap: "sm", pad: "2xl", align: "center" },
      children: ["o1", "o2"],
    },
    o1: {
      id: "o1",
      type: "text",
      value: "This page is offline right now",
      style: { size: "xl", weight: "bold" },
    },
    o2: {
      id: "o2",
      type: "text",
      value: "Its agent isn't connected. Check back soon.",
      style: { color: "fg-muted" },
    },
  },
};

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

interface Pending {
  readonly resolve: (messages: readonly ServerMessage[]) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  // The turn's origin, kept so a timed-out request can be re-applied late: a
  // later /agent/control for this id re-injects its messages through the runtime.
  readonly visitor: VisitorContext;
  readonly event: ClientEvent;
  // The per-visitor arrival index of this turn's event, used to detect a NEWER
  // turn that has already applied before a late result lands (see `lastApplied`).
  readonly index: number;
  // The frame-log era at park time. The index space is only meaningful within one
  // era; a re-mint (restart/LRU eviction) invalidates a parked index (see
  // `isStaleLateResult`), so the era is parked alongside it.
  readonly era: string;
}

/** One logged browser frame: its per-session seq and the already-serialized JSON
 * payload (kept as a string so a replay re-emits byte-identical `data:`). */
interface LoggedFrame {
  readonly seq: number;
  readonly json: string;
}

/** A session's replay log: a version token (`era`), the next seq to assign, and a
 * bounded ring of recent frames. `era` is re-minted whenever the entry is created
 * (server restart or LRU eviction), so a stale resume token can never replay
 * against a different history — it fails the era check and full-rehydrates. */
interface FrameLog {
  era: string;
  nextSeq: number;
  frames: LoggedFrame[];
  // Per-visitor event ordering, kept beside the ring so it's bounded by the same
  // LRU. `eventCounter` stamps each /event at arrival; `handlingIndex` is the index
  // of the turn currently being handled (read when a timed-out turn parks);
  // `lastApplied` is the highest index whose apply has completed (-1 = none). A late
  // result whose parked index is below `lastApplied` is stale — a newer turn already
  // mutated the stage, so its patches are dropped (NOT its says). NOTE: this is a
  // separate counter from `nextSeq` on purpose — an interim timeout say bumps
  // `nextSeq` but is not a new event, so `nextSeq` would give false staleness.
  eventCounter: number;
  handlingIndex: number;
  lastApplied: number;
}

/** Ring bound per session: past this many frames the oldest fall off and a
 * reconnect beyond the window full-rehydrates instead of resuming. */
const FRAME_LOG_LIMIT = 200;
/** LRU cap on the session→log map so a server serving many one-off visitors
 * can't grow it without bound (re-insert-on-touch, oldest evicted first). */
const MAX_FRAME_SESSIONS = 1000;
/** FIFO cap on parked timed-out/dropped turns awaiting a late result. Beyond it
 * the oldest entry is dropped and its eventual /agent/control is a silent no-op —
 * the late-delivery guarantee is deliberately bounded. */
const LATE_WINDOW_LIMIT = 100;

/** The non-terminal note delivered when a turn outlives `agentTimeoutMs`: it must
 * NOT read as terminal, because the turn is parked and its real result will still
 * arrive via the late path (A-3). */
const INTERIM_TIMEOUT_SAY =
  "(still working — this is taking longer than usual; the answer will appear here when it's ready)";

let eraCounter = 0;
/** A short version token for a frame log. base36 (no `":"`) so `<era>:<seq>`
 * parses unambiguously; a per-process counter plus randomness keeps eras distinct
 * across re-mints within one run and across restarts. */
function mintEra(): string {
  eraCounter += 1;
  return `${eraCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Last-Event-ID is NOT a CORS-safelisted request header: without it here, a
  // cross-origin EventSource reconnect (which carries the header after the first
  // stamped frame) would fail preflight and never resume. Content-Type covers the
  // POST channels.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
}

/** Write one SSE frame. An optional `id` becomes the `id:` line — used ONLY on the
 * browser channel to carry `<era>:<seq>` for `Last-Event-ID` resume; agent-channel
 * frames pass no id. */
function sse(res: ServerResponse, data: unknown, id?: string): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  res.write(id !== undefined ? `id: ${id}\n${payload}` : payload);
}

/** Write a pre-serialized browser frame with its stamped id — the replay path,
 * which re-emits a logged frame's exact JSON. */
function writeFrame(res: ServerResponse, json: string, id: string): void {
  res.write(`id: ${id}\ndata: ${json}\n\n`);
}

/** Max accepted request body. A single-operator reference transport still shouldn't
 * buffer an unbounded upload into memory, so both POST channels (/event and
 * /agent/control) cap here. Raise it if a legitimate payload (a large stage patch)
 * grows past this; lower it to tighten the DoS surface. */
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB

function readJson(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    // utf8 decoding must happen on the stream (a multibyte char split across
    // two chunks corrupts under per-chunk String()).
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        // Past the cap: stop buffering, shed the rest of the upload, and reject so
        // the caller's existing `.catch` answers 400.
        reject(new Error("request body exceeds size cap"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Shape-check an untrusted browser /event body before trusting it — including
 * the per-kind payload (a kind-only check lets `{kind:"action"}` without an
 * action object crash downstream consumers, e.g. the persistent bridge). */
function isEventBody(body: unknown): body is { visitor: VisitorContext; event: ClientEvent } {
  if (typeof body !== "object" || body === null) return false;
  const { visitor, event } = body as { visitor?: unknown; event?: unknown };
  if (typeof visitor !== "object" || visitor === null) return false;
  if (typeof (visitor as { visitorId?: unknown }).visitorId !== "string") return false;
  if (typeof event !== "object" || event === null) return false;
  const { kind, text, action } = event as { kind?: unknown; text?: unknown; action?: unknown };
  if (kind === "visit") {
    const eventVisitor = (event as { visitor?: unknown }).visitor;
    return (
      typeof eventVisitor === "object" &&
      eventVisitor !== null &&
      typeof (eventVisitor as { visitorId?: unknown }).visitorId === "string"
    );
  }
  if (kind === "message") return typeof text === "string";
  if (kind === "action") {
    if (typeof action !== "object" || action === null) return false;
    if (typeof (action as { name?: unknown }).name !== "string") return false;
    const payload = (action as { payload?: unknown }).payload;
    if (payload === undefined) return true;
    // Mirror core's asAction: the payload must be a plain object (its `isObject`
    // excludes arrays and null), and every value a primitive — otherwise a nested
    // object or an array would pass a kind-only check and reach the agent.
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
    return Object.values(payload).every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
  }
  return false;
}

/** Shape-check an /agent/control body before resolving a pending request with it —
 * per-kind, so a malformed message can't smuggle a non-array `patches` or a
 * non-string `text` into the runtime and the browser. */
function isControlBody(
  body: unknown,
): body is { requestId: number; messages: readonly ServerMessage[] } {
  if (typeof body !== "object" || body === null) return false;
  const { requestId, messages } = body as { requestId?: unknown; messages?: unknown };
  if (typeof requestId !== "number") return false;
  if (!Array.isArray(messages)) return false;
  return messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const { kind, text, patches } = m as { kind?: unknown; text?: unknown; patches?: unknown };
    if (kind === "say") return typeof text === "string";
    if (kind === "patch") return Array.isArray(patches);
    return false;
  });
}

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const timeoutMs = options.agentTimeoutMs ?? 120_000;
  const staleMs = options.agentStaleMs ?? 30_000; // reap an agent quiet this long
  // Fail-fast on a misconfigured knob (config-time, same posture as parseBridgePort):
  // 0/negative would make the reaper interval `min(10s, staleMs)` fire on ~0ms ticks
  // and reap healthy agents. A positive integer of ms is required; sub-second values
  // are the operator's call.
  if (!Number.isInteger(staleMs) || staleMs < 1) {
    throw new Error(
      `agentStaleMs must be a positive integer of milliseconds; got ${String(options.agentStaleMs)}`,
    );
  }
  const browserStreams = new Map<string, Set<ServerResponse>>();
  const pending = new Map<number, Pending>();
  // Parked turns (timed out or dropped) awaiting a late /agent/control result,
  // keyed by requestId, FIFO-bounded.
  const lateWindow = new Map<
    number,
    { visitor: VisitorContext; event: ClientEvent; index: number; era: string }
  >();
  // Per-session replay log (server-local — the Sink is NOT the replay store).
  const frameLog = new Map<string, FrameLog>();
  // Per-visitor delivery lane: serializes {apply → seq-assign → log → fan-out} so
  // apply-order equals delivery-order by construction. Live turns and late applies
  // are lane tasks; the replay/rehydrate paths run synchronously and never assign seqs.
  const lane = createSerialQueue<void>();
  let agentStream: ServerResponse | null = null;
  let lastHeartbeat = 0;
  let requestCounter = 0;

  /** Get-or-create a session's frame log, minting an era on first touch. Touched
   * as LRU (re-insert moves it to newest); oldest evicted past the cap. */
  const logFor = (visitorId: string): FrameLog => {
    let entry = frameLog.get(visitorId);
    if (entry === undefined) {
      entry = {
        era: mintEra(),
        nextSeq: 0,
        frames: [],
        eventCounter: 0,
        handlingIndex: -1,
        lastApplied: -1,
      };
    } else {
      frameLog.delete(visitorId);
    }
    frameLog.set(visitorId, entry);
    if (frameLog.size > MAX_FRAME_SESSIONS) {
      const oldest = frameLog.keys().next().value;
      if (oldest !== undefined) frameLog.delete(oldest);
    }
    return entry;
  };

  /** Deliver messages to a visitor's browser channel — SYNCHRONOUS, no await, the
   * only seq-assigning path. Each message gets `seq = nextSeq++`, is appended to
   * the ring, and written to every live connection as `id: <era>:<seq>`. Frames
   * are logged even with zero connections (that's the late-result-while-disconnected
   * case the resume path replays). Called ONLY from lane tasks. */
  const deliver = (visitorId: string, messages: readonly ServerMessage[]): void => {
    if (messages.length === 0) return;
    const log = logFor(visitorId);
    const connections = browserStreams.get(visitorId);
    for (const message of messages) {
      const seq = log.nextSeq;
      log.nextSeq += 1;
      const json = JSON.stringify(message);
      log.frames.push({ seq, json });
      if (log.frames.length > FRAME_LOG_LIMIT) log.frames.shift();
      if (connections !== undefined) {
        const id = `${log.era}:${seq}`;
        for (const res of connections) writeFrame(res, json, id);
      }
    }
  };

  /** Park a turn's origin for a bounded late-delivery window (FIFO). */
  const parkLate = (
    requestId: number,
    visitor: VisitorContext,
    event: ClientEvent,
    index: number,
    era: string,
  ): void => {
    lateWindow.set(requestId, { visitor, event, index, era });
    if (lateWindow.size > LATE_WINDOW_LIMIT) {
      const oldest = lateWindow.keys().next().value;
      if (oldest !== undefined) lateWindow.delete(oldest);
    }
  };

  /** Record that a visitor's event `index` has finished applying (running max), so a
   * later late result can tell whether a newer turn already mutated the stage. */
  const recordApplied = (visitorId: string, index: number): void => {
    const log = logFor(visitorId);
    if (index > log.lastApplied) log.lastApplied = index;
  };

  const offlineFace = options.offlineFace ?? DEFAULT_OFFLINE_FACE;
  const offline = (text: string): readonly ServerMessage[] => [{ kind: "say", text }];

  /** Does this session already hold a real page (beyond an empty root)? */
  const hasBuiltStage = (session: FacetSession): boolean => {
    const root = session.stage.nodes[session.stage.root];
    if (session.stage.screens !== undefined && Object.keys(session.stage.screens).length > 0) {
      return true;
    }
    return root !== undefined && "children" in root && root.children.length > 0;
  };

  /** What a visitor gets when no agent is connected: the offline face on a FRESH
   * visit, a short note otherwise. A RETURNING visitor's built page must never be
   * overwritten (the offline patch would be persisted over their real stage). */
  const offlineFor = (event: ClientEvent, session?: FacetSession): readonly ServerMessage[] =>
    event.kind === "visit" && (session === undefined || !hasBuiltStage(session))
      ? [{ kind: "patch", patches: [{ op: "replace", path: "", value: offlineFace }] }]
      : [{ kind: "say", text: "This page's agent is offline right now — check back soon." }];

  const dropAgent = (reason: string): void => {
    if (agentStream === null) return;
    agentStream = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      // Resolve the in-flight HTTP wait with the terminal offline note (as before),
      // AND park the turn so an agent that reconnects and posts the finished work
      // still lands it via the late path.
      parkLate(id, p.visitor, p.event, p.index, p.era);
      p.resolve(offline(reason));
      pending.delete(id);
    }
  };

  /** The remote agent, presented to the runtime as a normal FacetAgent. */
  const remoteAgent: FacetAgent = (event: ClientEvent, session: FacetSession) => {
    const stream = agentStream;
    if (stream === null) {
      return offlineFor(event, session);
    }
    const requestId = (requestCounter += 1);
    // The arrival index + era of the turn currently being handled for this visitor
    // (index set by the /event lane task before it awaits the agent) — tagged onto
    // the park so a late result can be compared against newer turns AND detected as
    // stale if the frame log was re-minted (era change) in between.
    const handlingLog = logFor(session.visitor.visitorId);
    const index = handlingLog.handlingIndex;
    const era = handlingLog.era;
    return new Promise<readonly ServerMessage[]>((resolve) => {
      const timer = setTimeout(() => {
        // The turn outlived the wait: resolve it with a NON-terminal interim note
        // and park it, so a later /agent/control still applies + delivers the real
        // answer (late path). Exactly one of {in-time resolve, this} runs per id.
        pending.delete(requestId);
        parkLate(requestId, session.visitor, event, index, era);
        resolve([{ kind: "say", text: INTERIM_TIMEOUT_SAY }]);
      }, timeoutMs);
      pending.set(requestId, { resolve, timer, visitor: session.visitor, event, index, era });
      const frame: AgentEventFrame = {
        type: "event",
        requestId,
        visitorId: session.visitor.visitorId,
        event,
        stage: session.stage,
      };
      sse(stream, frame);
    });
  };

  const agent: FacetAgent = (event, session) =>
    agentStream !== null
      ? remoteAgent(event, session)
      : options.agent !== undefined
        ? options.agent(event, session)
        : offlineFor(event, session);

  const runtime = new FacetRuntime({
    agentId: options.agentId,
    agent,
    ...(options.stageStore !== undefined ? { stageStore: options.stageStore } : {}),
    ...(options.sink !== undefined ? { sink: options.sink } : {}),
  });

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // CORS only on the browser channel — the /agent/* control channel is a
    // server-side (bridge) connection, not for cross-origin browser use, so don't
    // advertise it to arbitrary web origins.
    if (!url.pathname.startsWith("/agent/")) setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const streamHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    };

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(agentStream !== null ? "ok agent=remote" : "ok agent=local");
      return;
    }

    // ── browser side ──────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/stream") {
      const visitorId = url.searchParams.get("visitorId");
      if (visitorId === null) {
        res.writeHead(400);
        res.end();
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": connected\n\n");
      let closed = false;
      req.on("close", () => {
        closed = true;
        const set = browserStreams.get(visitorId);
        set?.delete(res);
        // Prune the empty Set so browserStreams doesn't grow unbounded.
        if (set?.size === 0) browserStreams.delete(visitorId);
      });
      const join = (): void => {
        let set = browserStreams.get(visitorId);
        if (set === undefined) {
          set = new Set();
          browserStreams.set(visitorId, set);
        }
        set.add(res);
      };

      // ── resume ──────────────────────────────────────────────────
      // A valid Last-Event-ID (`<era>:<seq>`, era matches the live log, seq within
      // range, gap still in the ring) joins the fan-out and replays the missed
      // frames in ONE synchronous block. Join-first is safe precisely because
      // there is no await for a live frame to interleave into; the replayed frames
      // carry their original ids, so no seq is re-assigned and no dup is possible.
      // Every invalid token shape degrades to the full rehydrate below — /stream
      // never answers 4xx/5xx for a resume token (the only 400 is a missing visitorId).
      const lastEventId = req.headers["last-event-id"];
      if (typeof lastEventId === "string") {
        const colon = lastEventId.indexOf(":");
        if (colon > 0) {
          const era = lastEventId.slice(0, colon);
          const seqStr = lastEventId.slice(colon + 1);
          const log = frameLog.get(visitorId);
          // Strict integer only: `Number("")` is 0 and hex/exponent/whitespace all
          // coerce, so parse the shape explicitly. `-1` IS valid — it's the base a
          // virgin session's snapshot stamps (`era:N0` with N0 = -1); resuming from
          // it replays the whole ring with no reset (else an idle tab that never
          // received a stamped frame would full-rehydrate on every reconnect).
          if (log !== undefined && era === log.era && /^(-1|0|[1-9]\d*)$/.test(seqStr)) {
            const seq = Number(seqStr);
            const oldest = log.frames[0];
            if (seq <= log.nextSeq - 1 && (oldest === undefined || oldest.seq <= seq + 1)) {
              // Touch the log LRU (a successful resume keeps the session hot) without
              // creating a missing entry.
              frameLog.delete(visitorId);
              frameLog.set(visitorId, log);
              join();
              for (const frame of log.frames) {
                if (frame.seq > seq) writeFrame(res, frame.json, `${log.era}:${frame.seq}`);
              }
              return;
            }
          }
        }
      }

      // ── full rehydrate (out of the lane) ────────────────────────
      // A token-less new tab (or an unresumable token) gets a full snapshot. This
      // runs OUTSIDE the per-visitor lane so it paints immediately instead of
      // blocking behind a mid-flight turn — yet it is still loss-free across its
      // store reads, by construction:
      //   1. capture the watermark (era, N0 = last assigned seq) synchronously,
      //      BEFORE any await;
      //   2. read the stage + history (may await);
      //   3. one synchronous finalization block that FIRST re-checks watermark
      //      continuity — the log entry/era is unchanged AND the ring still retains
      //      everything past N0 (else the captured snapshot can no longer be
      //      stitched to the live stream, so we write nothing and end, the same
      //      fail-safe the store-error path uses) — then writes: unstamped
      //      {kind:"reset"} → snapshot stamped `era:N0` → history says stamped
      //      `era:N0` → replay ring frames with seq > N0 (their own ids) → join.
      // `deliver` and this block are both synchronous, so they cannot interleave;
      // anything delivered during step 2 has seq > N0, lives in the ring, and is
      // replayed before the join — nothing is lost in the snapshot-read→join window.
      // Stamping starts at the SNAPSHOT, never the reset, so a resume token can only
      // exist in a client that received a stage base: if step 2 fails, continuity
      // fails, or the connection drops before step 3, no stamped frame was written,
      // the client holds no token, and its retry performs a full rehydrate.
      const log = logFor(visitorId);
      const capturedEra = log.era;
      const n0 = log.nextSeq - 1;
      void (async () => {
        const stage = await runtime.stageFor(visitorId);
        if (closed) return;
        const history = await runtime.historyFor(visitorId);
        if (closed) return;
        const current = frameLog.get(visitorId);
        if (current !== log || current.era !== capturedEra) {
          // The entry was LRU-evicted and re-minted during the reads: unstitchable.
          res.end();
          return;
        }
        const oldest = current.frames[0];
        if (oldest !== undefined && oldest.seq > n0 + 1) {
          // The head of the gap fell off the ring during a slow read: unstitchable.
          res.end();
          return;
        }
        const stampId = `${current.era}:${n0}`;
        sse(res, { kind: "reset" });
        if (stage !== undefined) {
          sse(
            res,
            { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
            stampId,
          );
        }
        for (const entry of history) {
          for (const message of entry.messages) {
            if (message.kind === "say") sse(res, message, stampId);
          }
        }
        // Replay frames delivered during the reads (seq > N0) so nothing in the
        // snapshot-read→join window is lost. A replayed frame may describe a change
        // the snapshot already holds; that is safe not because ops are idempotent
        // (an array append like `children/-` is NOT — it would double-apply) but
        // because the renderer de-dupes sibling ids and the client's fail-safe drops
        // any batch that no longer applies cleanly to its (already-current) tree.
        for (const frame of current.frames) {
          if (frame.seq > n0) writeFrame(res, frame.json, `${current.era}:${frame.seq}`);
        }
        join();
      })().catch((error: unknown) => {
        // Rehydrate failed BEFORE the connection joined the fan-out set — logging
        // alone would strand the viewer on a healthy-looking SSE stream that never
        // gets patches and never reconnects (the server only pings agent streams).
        // End the response so EventSource auto-reconnects and retries the rehydrate.
        console.error("[facet] rehydrate failed:", error);
        res.end();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      readJson(req)
        .then((body) => {
          if (!isEventBody(body)) {
            res.writeHead(400);
            res.end();
            return;
          }
          const { visitor, event } = body;
          res.writeHead(202);
          res.end();
          // Stamp a per-visitor arrival index NOW (the true order, before any lane
          // hop), so a late result can detect a newer turn that already applied.
          const eventLog = logFor(visitor.visitorId);
          const index = eventLog.eventCounter;
          eventLog.eventCounter += 1;
          // One lane task per turn: {apply → deliver}. `deliver` assigns seqs and
          // fans out synchronously, so this visitor's frames can't cross or reorder
          // (a late apply for the same visitor enqueues behind this task).
          void lane(visitor.visitorId, async () => {
            // Tag the in-flight turn so a timed-out park picks up this index.
            logFor(visitor.visitorId).handlingIndex = index;
            let delivered: readonly ServerMessage[] = [];
            try {
              delivered = await runtime.handle(visitor, event);
              deliver(visitor.visitorId, delivered);
            } catch (error) {
              // Don't leave the visitor staring at a 202 that went nowhere.
              console.error("[facet] handle failed:", error);
              delivered = [{ kind: "say", text: "(the agent hit an error — try again)" }];
              deliver(visitor.visitorId, delivered);
            } finally {
              // Advance lastApplied only if this turn actually MUTATED the stage. A
              // say-only turn, an interim-timeout note, and a failed handle all leave
              // the stage untouched, so an older parked patch can still safely apply
              // after them — bumping lastApplied there would falsely mark it stale.
              if (delivered.some((m) => m.kind === "patch"))
                recordApplied(visitor.visitorId, index);
            }
          });
        })
        .catch(() => {
          res.writeHead(400);
          res.end();
        });
      return;
    }

    // ── agent side ────────────────────────────────────────────────
    // The agent-side channel is a control surface for the link — gate it with the
    // shared token so a third party can't connect or inject control responses.
    if (url.pathname.startsWith("/agent/")) {
      if (options.agentToken !== undefined && req.headers["x-facet-token"] !== options.agentToken) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("forbidden");
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/agent/stream") {
      if (agentStream !== null) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end("agent already connected");
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": agent connected\n\n");
      agentStream = res;
      lastHeartbeat = Date.now();
      req.on("close", () => {
        if (agentStream === res) dropAgent("(agent disconnected)");
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/heartbeat") {
      lastHeartbeat = Date.now();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/control") {
      readJson(req)
        .then((body) => {
          if (!isControlBody(body)) {
            res.writeHead(400);
            res.end();
            return;
          }
          const { requestId, messages } = body;
          const p = pending.get(requestId);
          if (p !== undefined) {
            // In-time: resolve the still-waiting turn; its lane task applies + delivers.
            clearTimeout(p.timer);
            pending.delete(requestId);
            p.resolve(messages);
          } else {
            const late = lateWindow.get(requestId);
            if (late !== undefined) {
              // Late: the turn timed out or its agent dropped. Re-inject through the
              // runtime and deliver, on the SAME per-visitor lane as live turns so it
              // can't race one for that visitor.
              lateWindow.delete(requestId);
              const parked = { era: late.era, index: late.index };
              void lane(late.visitor.visitorId, async () => {
                try {
                  // If a NEWER turn already mutated this visitor's stage (or the frame
                  // log was re-minted since the park), this late result's stage
                  // mutation is stale — applying it (Stage `render` is a root
                  // `replace`) would overwrite the newer stage. Drop its patch
                  // messages but KEEP its says, so the conversational answer still
                  // honors the interim promise without rolling the stage back.
                  const stale = isStaleLateResult(parked, logFor(late.visitor.visitorId));
                  const toApply = stale ? messages.filter((m) => m.kind === "say") : messages;
                  const applied = await runtime.applyMessages(late.visitor, late.event, toApply);
                  deliver(late.visitor.visitorId, applied);
                  // Record only a real stage mutation (mirrors the live path).
                  if (!stale && toApply.some((m) => m.kind === "patch")) {
                    recordApplied(late.visitor.visitorId, parked.index);
                  }
                } catch (error) {
                  // Mirror the live path: a store failure here must not leave the
                  // visitor waiting forever on the interim "it's coming" note.
                  console.error("[facet] late apply failed:", error);
                  deliver(late.visitor.visitorId, [
                    { kind: "say", text: "(the agent hit an error — try again)" },
                  ]);
                }
              });
            }
            // miss + miss (evicted/unknown requestId): silent 202 no-op — the late
            // guarantee is deliberately bounded (LATE_WINDOW_LIMIT).
          }
          res.writeHead(202);
          res.end();
        })
        .catch(() => {
          res.writeHead(400);
          res.end();
        });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // Liveness: keep the agent stream warm and reap it if heartbeats stop (covers
  // a half-open connection where the agent's machine died without a clean close).
  const reaper = setInterval(
    () => {
      if (agentStream === null) return;
      if (Date.now() - lastHeartbeat > staleMs) {
        agentStream.end();
        dropAgent("(agent went quiet)");
        return;
      }
      agentStream.write(": ping\n\n");
    },
    Math.min(10_000, staleMs),
  );

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error: Error): void => reject(error); // e.g. EADDRINUSE
        server.once("error", onError);
        server.listen(options.port, () => {
          server.removeListener("error", onError);
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(reaper);
        // End held-open SSE connections first, or server.close() never resolves.
        agentStream?.end();
        for (const set of browserStreams.values()) {
          for (const res of set) res.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
