import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  createSerialQueue,
  isPrimitiveRecord,
  MAX_FIELD_VALUE_CHARS,
  type AgentControlFrame,
  type ClientEvent,
  type FacetAgent,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { FacetRuntime, type Sink, type StageStore } from "@facet/runtime";
import { createFrameLogStore, type FrameLogStore } from "./frame-log.js";
import { createLateWindow, isStaleLateResult, LATE_WINDOW_LIMIT, type LateWindow } from "./late.js";
import { DEFAULT_OFFLINE_FACE } from "./offline.js";
import { createAgentChannel, type AgentChannel } from "./agent-channel.js";

/**
 * The reference Facet transport: a tiny Node server carrying events to an agent
 * and streaming patches back — dependency-free (Node http only).
 *
 * Two channels, both SSE + POST so an agent behind NAT only ever dials OUT:
 * - browser side: `GET /stream?visitorId=…` (SSE) + `POST /event`.
 * - agent side:   `GET /agent/stream?agentId=…` (SSE) + `POST /agent/control`.
 *
 * An external agent that holds `/agent/stream` becomes the brain for `agentId`;
 * it is exposed to the runtime as an ordinary `FacetAgent` (see the agent channel),
 * so the runtime treats remote and in-process agents identically. If no external
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
  /** Bind address passed to `listen` (default: all interfaces, unchanged). Set
   * `"127.0.0.1"` for a loopback-only server (e.g. an internal instance behind
   * a wrapper). */
  readonly host?: string;
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

export interface FacetServer {
  listen(): Promise<void>;
  close(): Promise<void>;
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
    // Only agent actions travel over the transport — navigate/toggle are
    // client-local and the renderer never sends them. Reject any other kind so
    // a spoofed `{kind:"navigate"}` can't reach an agent typed as FacetAction.
    const actionKind = (action as { kind?: unknown }).kind;
    if (actionKind !== undefined && actionKind !== "agent") return false;
    if (typeof (action as { name?: unknown }).name !== "string") return false;
    // `collect` is a NodeId (string) if present — validate the sibling field as
    // strictly as `payload` below, so a spoofed client can't inject an
    // ill-typed collect into a FacetAction reaching the agent.
    const collect = (action as { collect?: unknown }).collect;
    if (collect !== undefined && typeof collect !== "string") return false;
    // Optional visitor-typed field values riding the event: absent is fine;
    // present must be a string record within the shared cap (see isFieldsRecord).
    const fields = (event as { fields?: unknown }).fields;
    if (fields !== undefined && !isFieldsRecord(fields)) return false;
    const payload = (action as { payload?: unknown }).payload;
    if (payload === undefined) return true;
    // Mirror core's asAction: the payload must be a plain (non-array) object whose
    // every value is a primitive — otherwise a nested object or an array would pass
    // a kind-only check and reach the agent. `isPrimitiveRecord` is the REJECTING
    // form of that rule (see core's validate.ts).
    return isPrimitiveRecord(payload);
  }
  return false;
}

/** The REJECTING form of the action `fields` rule, mirroring `isPrimitiveRecord`:
 * a plain (non-array) object whose every value is a string of length ≤
 * `MAX_FIELD_VALUE_CHARS`. Keys and their count are bounded too, so a
 * non-renderer client can't slip megabytes of untrusted fields through the
 * per-value cap in aggregate (the renderer's output is bounded by tree size).
 * The renderer caps values at collection time with the same core constant, so
 * the two sides cannot drift. */
function isFieldsRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIELDS_KEYS) return false;
  return entries.every(
    ([k, v]) =>
      k.length <= MAX_FIELD_VALUE_CHARS &&
      typeof v === "string" &&
      v.length <= MAX_FIELD_VALUE_CHARS,
  );
}

/** Upper bound on distinct field names in one action event (defense in depth;
 * a real form has a handful). */
const MAX_FIELDS_KEYS = 256;

/** Shape-check an /agent/control body before resolving a pending request with it —
 * per-kind, so a malformed message can't smuggle a non-array `patches` or a
 * non-string `text` into the runtime and the browser. */
function isControlBody(body: unknown): body is AgentControlFrame {
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

// ── browser stream: resume ──────────────────────────────────────────
// A valid Last-Event-ID (`<era>:<seq>`, era matches the live log, seq within
// range, gap still in the ring) joins the fan-out and replays the missed frames
// in ONE synchronous block. Join-first is safe precisely because there is no await
// for a live frame to interleave into; the replayed frames carry their original
// ids, so no seq is re-assigned and no dup is possible. Every invalid token shape
// returns false and degrades to the full rehydrate — /stream never answers 4xx/5xx
// for a resume token (the only 400 is a missing visitorId).
/** Try to resume a reconnecting stream from its `Last-Event-ID`; returns true if it
 * replayed (and joined the fan-out), false if the token is unusable. */
function resumeStream(
  res: ServerResponse,
  visitorId: string,
  lastEventId: string,
  frameLog: FrameLogStore,
  join: () => void,
): boolean {
  const colon = lastEventId.indexOf(":");
  if (colon <= 0) return false;
  const era = lastEventId.slice(0, colon);
  const seqStr = lastEventId.slice(colon + 1);
  // Strict integer only: `Number("")` is 0 and hex/exponent/whitespace all coerce,
  // so parse the shape explicitly. `-1` IS valid — it's the base a virgin session's
  // snapshot stamps (`era:N0` with N0 = -1); resuming from it replays the whole ring
  // with no reset (else an idle tab that never received a stamped frame would
  // full-rehydrate on every reconnect).
  if (!/^(-1|0|[1-9]\d*)$/.test(seqStr)) return false;
  const replay = frameLog.resume(visitorId, era, Number(seqStr));
  if (replay === undefined) return false;
  join();
  for (const frame of replay) writeFrame(res, frame.json, frame.id);
  return true;
}

// ── browser stream: full rehydrate (out of the lane) ────────────────
// A token-less new tab (or an unresumable token) gets a full snapshot. This runs
// OUTSIDE the per-visitor lane so it paints immediately instead of blocking behind
// a mid-flight turn — yet it is still loss-free across its store reads, by
// construction:
//   1. capture the watermark (era, N0 = last assigned seq) synchronously, BEFORE
//      any await;
//   2. read the stage + history (may await);
//   3. one synchronous finalization block that FIRST re-checks watermark continuity
//      — the log entry/era is unchanged AND the ring still retains everything past
//      N0 (else the captured snapshot can no longer be stitched to the live stream,
//      so we write nothing and end, the same fail-safe the store-error path uses) —
//      then writes: unstamped {kind:"reset"} → snapshot stamped `era:N0` → history
//      says stamped `era:N0` → replay ring frames with seq > N0 (their own ids) →
//      join.
// `deliver` and this block are both synchronous, so they cannot interleave; anything
// delivered during step 2 has seq > N0, lives in the ring, and is replayed before
// the join — nothing is lost in the snapshot-read→join window. Stamping starts at
// the SNAPSHOT, never the reset, so a resume token can only exist in a client that
// received a stage base: if step 2 fails, continuity fails, or the connection drops
// before step 3, no stamped frame was written, the client holds no token, and its
// retry performs a full rehydrate.
async function rehydrate(
  res: ServerResponse,
  visitorId: string,
  frameLog: FrameLogStore,
  runtime: FacetRuntime,
  isClosed: () => boolean,
  join: () => void,
): Promise<void> {
  const log = frameLog.logFor(visitorId);
  const capturedEra = log.era;
  const n0 = log.nextSeq - 1;
  try {
    const stage = await runtime.stageFor(visitorId);
    if (isClosed()) return;
    const history = await runtime.historyFor(visitorId);
    if (isClosed()) return;
    const current = frameLog.peek(visitorId);
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
      sse(res, { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] }, stampId);
    }
    for (const entry of history) {
      for (const message of entry.messages) {
        if (message.kind === "say") sse(res, message, stampId);
      }
    }
    // Replay frames delivered during the reads (seq > N0) so nothing in the
    // snapshot-read→join window is lost. A replayed frame may describe a change the
    // snapshot already holds; that is safe not because ops are idempotent (an array
    // append like `children/-` is NOT — it would double-apply) but because the
    // renderer de-dupes sibling ids and the client's fail-safe drops any batch that
    // no longer applies cleanly to its (already-current) tree.
    for (const frame of current.frames) {
      if (frame.seq > n0) writeFrame(res, frame.json, `${current.era}:${frame.seq}`);
    }
    join();
  } catch (error: unknown) {
    // Rehydrate failed BEFORE the connection joined the fan-out set — logging alone
    // would strand the visitor on a healthy-looking SSE stream that never gets
    // patches and never reconnects (the server only pings agent streams). End the
    // response so EventSource auto-reconnects and retries the rehydrate.
    console.error("[facet] rehydrate failed:", error);
    res.end();
  }
}

/** Runs a single visitor's turns serially (different visitors stay concurrent). */
type Lane = (key: string, task: () => Promise<void>) => Promise<void>;

/** The runtime-facing wiring the two POST handlers share: the delivery lane, the
 * runtime, the frame log, and the synchronous fan-out (`deliver`, which stays in
 * server.ts). */
interface PostHandlerDeps {
  readonly lane: Lane;
  readonly runtime: FacetRuntime;
  readonly frameLog: FrameLogStore;
  readonly deliver: (visitorId: string, messages: readonly ServerMessage[]) => void;
  /** The arrival {index, era} of the turn each visitor's lane is currently
   * handling — server-local so an LRU eviction of the frame log can't detach it
   * mid-turn. One entry per in-flight visitor turn; deleted when the turn ends. */
  readonly handling: Map<string, { readonly index: number; readonly era: string }>;
}

/** POST /event: shape-check the untrusted body, ack 202, then run the turn on the
 * visitor's lane — {apply → deliver} — with a per-visitor arrival index stamped at
 * arrival so a late result can detect a newer turn that already applied. */
function handleEvent(req: IncomingMessage, res: ServerResponse, deps: PostHandlerDeps): void {
  const { lane, runtime, frameLog, deliver, handling } = deps;
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
      // Stamp a per-visitor arrival {index, era} pair NOW (the true order, before
      // any lane hop), so a late result can detect a newer turn that already
      // applied. The pair is atomic: an index paired with a later re-minted era
      // could false-pass the staleness check.
      const arrival = frameLog.nextArrival(visitor.visitorId);
      // One lane task per turn: {apply → deliver}. `deliver` assigns seqs and
      // fans out synchronously, so this visitor's frames can't cross or reorder
      // (a late apply for the same visitor enqueues behind this task).
      void lane(visitor.visitorId, async () => {
        // Tag the in-flight turn so a timed-out park picks up this arrival pair
        // (kept in a server-local map, NOT on the LRU-evictable log entry).
        handling.set(visitor.visitorId, arrival);
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
            frameLog.recordApplied(visitor.visitorId, arrival.index, arrival.era);
          handling.delete(visitor.visitorId);
        }
      });
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}

/** POST /agent/control: shape-check the body, then settle the still-waiting turn
 * in-time via the channel, or re-inject a parked (timed-out/dropped) turn on its
 * lane. Always answers 202 — a miss (evicted/unknown requestId) is a bounded no-op. */
function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  channel: AgentChannel,
  lateWindow: LateWindow,
  deps: PostHandlerDeps,
): void {
  const { lane, runtime, frameLog, deliver } = deps;
  readJson(req)
    .then((body) => {
      if (!isControlBody(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      const { requestId, messages } = body;
      // In-time: the channel settles the still-waiting turn (its lane task applies
      // + delivers). Otherwise the turn timed out or its agent dropped — check the
      // late window.
      if (!channel.resolve(requestId, messages)) {
        const late = lateWindow.take(requestId);
        if (late !== undefined) {
          // Late: re-inject through the runtime and deliver, on the SAME per-visitor
          // lane as live turns so it can't race one for that visitor.
          const parked = { era: late.era, index: late.index };
          void lane(late.visitor.visitorId, async () => {
            try {
              // If a NEWER turn already mutated this visitor's stage (or the frame
              // log was re-minted since the park), this late result's stage
              // mutation is stale — applying it (Stage `render` is a root
              // `replace`) would overwrite the newer stage. Drop its patch
              // messages but KEEP its says, so the conversational answer still
              // honors the interim promise without rolling the stage back.
              const stale = isStaleLateResult(parked, frameLog.logFor(late.visitor.visitorId));
              const toApply = stale ? messages.filter((m) => m.kind === "say") : messages;
              const applied = await runtime.applyMessages(late.visitor, late.event, toApply);
              deliver(late.visitor.visitorId, applied);
              // Record only a real stage mutation (mirrors the live path).
              if (!stale && toApply.some((m) => m.kind === "patch")) {
                frameLog.recordApplied(late.visitor.visitorId, parked.index, parked.era);
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
}

export function createFacetServer(options: FacetServerOptions): FacetServer {
  const offlineFace = options.offlineFace ?? DEFAULT_OFFLINE_FACE;
  // Live browser connections per visitor (the fan-out set for `deliver`).
  const browserStreams = new Map<string, Set<ServerResponse>>();
  // Per-session replay log (server-local — the Sink is NOT the replay store) and the
  // bounded late-delivery window for parked timed-out/dropped turns.
  const frameLog: FrameLogStore = createFrameLogStore();
  // The arrival {index, era} of the turn each visitor's lane is currently
  // handling — server-local so an LRU eviction of the frame log can't detach it
  // mid-turn. One entry per in-flight visitor turn; deleted when the turn ends.
  const handling = new Map<string, { readonly index: number; readonly era: string }>();
  const lateWindow = createLateWindow(LATE_WINDOW_LIMIT);
  // Per-visitor delivery lane: serializes {apply → seq-assign → log → fan-out} so
  // apply-order equals delivery-order by construction. Live turns and late applies
  // are lane tasks; the replay/rehydrate paths run synchronously and never assign seqs.
  const lane = createSerialQueue<void>();

  // The agent-side link: validates the stale knob, owns the pending map + reaper, and
  // presents the remote/fallback/offline agent to the runtime.
  const channel = createAgentChannel({
    agentTimeoutMs: options.agentTimeoutMs,
    agentStaleMs: options.agentStaleMs,
    fallbackAgent: options.agent,
    offlineFace,
    lateWindow,
    // The in-flight turn's arrival pair, from the server-local map (an entry
    // exists exactly while a lane task is handling that visitor's turn). The
    // empty-era fallback can never match a real era, so an unknown context
    // degrades toward falsely-stale — never false-fresh.
    handlingContext: (visitorId) => handling.get(visitorId) ?? { index: -1, era: "" },
  });

  const runtime = new FacetRuntime({
    agentId: options.agentId,
    agent: channel.agent,
    ...(options.stageStore !== undefined ? { stageStore: options.stageStore } : {}),
    ...(options.sink !== undefined ? { sink: options.sink } : {}),
  });

  /** Deliver messages to a visitor's browser channel — SYNCHRONOUS, no await. The
   * seq-assign + log-append half is delegated to the frame log (the only seq-assigning
   * path); this fans the stamped frames out to every live connection. Frames are
   * logged even with zero connections (that's the late-result-while-disconnected case
   * the resume path replays). Called ONLY from lane tasks. */
  const deliver = (visitorId: string, messages: readonly ServerMessage[]): void => {
    if (messages.length === 0) return;
    const stamped = frameLog.append(visitorId, messages);
    const connections = browserStreams.get(visitorId);
    if (connections === undefined) return;
    for (const { id, json } of stamped) {
      for (const res of connections) writeFrame(res, json, id);
    }
  };

  const postDeps: PostHandlerDeps = { lane, runtime, frameLog, deliver, handling };

  const server: Server = createServer((req, res) => {
    // Node delivers malformed request-targets (e.g. `//[`) verbatim, and
    // `new URL` throws on them — an unguarded throw in this handler becomes an
    // uncaughtException that crashes the process. Reject them as 400 instead.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
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
      res.end(channel.isConnected() ? "ok agent=remote" : "ok agent=local");
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

      const lastEventId = req.headers["last-event-id"];
      if (
        typeof lastEventId === "string" &&
        resumeStream(res, visitorId, lastEventId, frameLog, join)
      ) {
        return;
      }
      void rehydrate(res, visitorId, frameLog, runtime, () => closed, join);
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      handleEvent(req, res, postDeps);
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
      if (channel.isConnected()) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end("agent already connected");
        return;
      }
      res.writeHead(200, streamHeaders);
      res.write(": agent connected\n\n");
      channel.attach(res);
      req.on("close", () => channel.dropIfCurrent(res, "(agent disconnected)"));
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/heartbeat") {
      channel.heartbeat();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/control") {
      handleControl(req, res, channel, lateWindow, postDeps);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error: Error): void => reject(error); // e.g. EADDRINUSE
        server.once("error", onError);
        const onListening = (): void => {
          server.removeListener("error", onError);
          resolve();
        };
        if (options.host !== undefined) server.listen(options.port, options.host, onListening);
        else server.listen(options.port, onListening);
      }),
    close: () =>
      new Promise((resolve, reject) => {
        // Stop the reaper and end the agent stream first, or server.close() never
        // resolves on the held-open SSE connections.
        channel.close();
        for (const set of browserStreams.values()) {
          for (const res of set) res.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
