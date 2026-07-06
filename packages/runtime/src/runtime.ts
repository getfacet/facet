import {
  createSerialQueue,
  asAgentServerMessage,
  foldPatchIntoStage,
  isTestOnlyServerMessageBatch,
  iterateAgentResult,
  MAX_PATCH_OPS,
  type ClientEvent,
  type CollectedEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type JsonPatchOperation,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { MemoryStageStore, sessionKey, type StageStore } from "./stage-store.js";
import { MemorySink, type Sink, type StoredEvent } from "./sink.js";

/** Hygiene cap on armed-but-undelivered seed keys (see `pendingSeeds`). */
const MAX_PENDING_SEEDS = 10_000;

/** Defensive cap on save-time re-validation issues logged per turn (log-flood belt). */
const MAX_LOGGED_ISSUES = 64;

export interface FacetRuntimeOptions {
  readonly agentId: string;
  readonly agent: FacetAgent;
  /** Where the current page lives. Defaults to in-memory. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes. Defaults to an in-memory (replayable) sink. */
  readonly sink?: Sink;
}

/**
 * What one turn yields. `messages` is the list to fan out to the client (the
 * prepended seed frame included when a fresh session was just seeded).
 * `agentMutated` is whether the AGENT'S OWN turn actually CHANGED the stage —
 * at least one non-`test` op applied, as reported by the fold (effect-based, not
 * merely "carried a patch message"). It excludes the prepended seed frame, so a
 * say-only turn that re-emits a parked seed, and a turn whose patch was dropped
 * whole (over-cap, non-array, empty, or all-ops-failed salvage), both report
 * false. The transport gates `recordApplied` on it: bumping "last applied" on a
 * non-mutating turn would falsely stale an older parked late result.
 */
export interface TurnResult {
  readonly messages: readonly ServerMessage[];
  readonly agentMutated: boolean;
}

export type RuntimeFrameSink = (messages: readonly ServerMessage[]) => void;
export type RuntimeRecordSink = (settled: Promise<void>) => void;

interface RecordSlot {
  readonly resolve: (entry: StoredEvent | null) => void;
  readonly settled: Promise<void>;
}

/**
 * Wires a transport's inbound events to the agent and keeps each session's stage
 * up to date. A transport (SSE server, or the in-process demo) calls `handle` for
 * every event from a visitor and ships the returned messages back.
 *
 * Two persistence concerns are kept separate: the STAGE (always Facet's, via
 * `stageStore`) and the CONVERSATION (optional, via `sink` — store, forward, or drop).
 */
export class FacetRuntime {
  private readonly agentId: string;
  private readonly agent: FacetAgent;
  private readonly stageStore: StageStore;
  private readonly sink: Sink;
  // Serialize events per (agent, visitor) so concurrent same-visitor events don't
  // race on the open→apply→save read-modify-write. Different visitors stay parallel.
  private readonly serialize = createSerialQueue<TurnResult>();
  // Serialize sink records per (agent, visitor) too. Writes are fire-and-forget from
  // the turn lane, but a transport can observe the reserved slot's settle promise
  // and keep its own replay fallback alive until history sees the turn. Different
  // visitors stay parallel.
  private readonly serializeRecord = createSerialQueue<void>();
  // Session keys armed by `takeSeeded` but not yet DELIVERED. `takeSeeded`
  // reports a fresh seed at most once, so parking the KEY here lets a turn that
  // failed to persist (agent throw or save rejection) re-emit the seed frame on
  // the next turn — consumed only once a turn actually persists. The frame's
  // value is always the CURRENT `session.stage` (never a parked tree), so a save
  // that committed before rejecting can't be rewound by a stale replay. The
  // per-visitor serial queue means no locking is needed. Entries can only
  // linger when a seeded visitor's save fails intermittently AND the visitor
  // never returns, so the insertion-order cap is a hygiene bound, not a hot path.
  private readonly pendingSeeds = new Set<string>();

  constructor(options: FacetRuntimeOptions) {
    this.agentId = options.agentId;
    this.agent = options.agent;
    this.stageStore = options.stageStore ?? new MemoryStageStore();
    this.sink = options.sink ?? new MemorySink();
  }

  /**
   * The current stage for a visitor, if a session exists. A transport uses this to
   * send a snapshot when a visitor (re)connects, so a fresh connection or a second
   * tab immediately shows the live page.
   */
  async stageFor(visitorId: string): Promise<FacetTree | undefined> {
    return (await this.stageStore.get(this.agentId, visitorId))?.stage;
  }

  /** The recorded conversation for a visitor (events + agent replies), if the sink retains it. */
  historyFor(visitorId: string): Promise<readonly StoredEvent[]> {
    return this.sink.history(this.agentId, visitorId);
  }

  /**
   * Processes one inbound event for one visitor and returns the messages to send
   * back. Stage patches are applied to the stored session (server is the source of
   * truth), then the interaction is handed to the sink.
   */
  handle(
    visitor: VisitorContext,
    event: ClientEvent,
    onFrame?: RuntimeFrameSink,
    onRecordSettled?: RuntimeRecordSink,
  ): Promise<TurnResult> {
    // Reserve this turn's Sink-write slot on serializeRecord NOW, in call order,
    // BEFORE the (async) turn runs — otherwise a record() called during the turn
    // would enqueue its write first and the append log would reverse (see
    // reserveRecordSlot). persist() fills the slot; a turn that throws resolves it
    // to null so it records nothing (prior behavior).
    const recordSlot = this.reserveRecordSlot(visitor.visitorId);
    return this.serialize(sessionKey(this.agentId, visitor.visitorId), async () => {
      try {
        return await this.handleOne(visitor, event, recordSlot, onFrame, onRecordSettled);
      } catch (error) {
        recordSlot.resolve(null);
        throw error;
      }
    });
  }

  /**
   * Records a purely-local visitor interaction (a navigate/toggle `tap` the
   * renderer resolved on its own) to the `Sink` WITHOUT invoking the agent — the
   * UI-IN capture path for events that never become an agent turn. It persists
   * the `CollectedEvent` with `messages: []` (no agent reply, no stage patch, no
   * `stageStore.save`), so `history()` is one durable, append-ordered timeline of
   * both forwarded turns and local taps.
   *
   * The write rides the SAME per-visitor `serializeRecord` queue that a forwarded
   * turn uses, so append order == send order regardless of async sink latency (a
   * slow earlier write can't be overtaken by a fast later one). This holds even
   * against a still-in-flight `handle`: that turn RESERVES its slot on the queue
   * synchronously at call time (`reserveRecordSlot`), so a `record` called after
   * it can never enqueue its write first. The runtime provides this ordering
   * itself — it does NOT depend on an outer per-visitor lane (only `@facet/server`
   * has one; the in-process transports don't). Returns the queue's promise so a
   * caller MAY await the local write settle, but the `/record` response path need
   * not; a failed sink write is logged, never thrown.
   */
  record(visitor: VisitorContext, event: CollectedEvent): Promise<void> {
    return this.enqueueRecord(visitor.visitorId, { at: Date.now(), event, messages: [] });
  }

  /**
   * Enqueues a Sink write on the per-visitor `serializeRecord` queue, logging
   * (never throwing) a failure. Used by `record` (a local tap) to enqueue its
   * write synchronously at call time. A forwarded turn (`handle`/`applyMessages`)
   * instead RESERVES its slot up front via `reserveRecordSlot` and fills it in
   * `persist`; both paths chain onto the SAME per-visitor queue in CALL order, so
   * append order == send order regardless of async sink latency.
   */
  private enqueueRecord(visitorId: string, entry: StoredEvent): Promise<void> {
    return this.serializeRecord(sessionKey(this.agentId, visitorId), () =>
      this.sink.record(this.agentId, visitorId, entry),
    ).catch((error: unknown) => console.error("[facet] sink failed:", error));
  }

  /**
   * Reserves this turn's Sink-write slot on serializeRecord NOW, in call order,
   * so a record() called after this returns can't enqueue its write first (the
   * in-process transports have no outer lane; @facet/server does). The slot awaits
   * the turn's entry; a turn that never persists resolves it to null (records
   * nothing, matching prior behavior). Agent turns can expose `settled` to their
   * transport, but they do not await it on the stage/delivery lane.
   */
  private reserveRecordSlot(visitorId: string): RecordSlot {
    let resolve!: (entry: StoredEvent | null) => void;
    const ready = new Promise<StoredEvent | null>((r) => {
      resolve = r;
    });
    const settled = this.serializeRecord(sessionKey(this.agentId, visitorId), async () => {
      const entry = await ready;
      if (entry !== null) await this.sink.record(this.agentId, visitorId, entry);
    }).catch((error: unknown) => console.error("[facet] sink failed:", error));
    return { resolve, settled };
  }

  /**
   * Applies ALREADY-PRODUCED agent messages to a session — the re-injection seam
   * for a late/out-of-band result: messages produced after the original turn's
   * wait already ended (e.g. the transport gave up waiting and the agent replied
   * later). It runs the same open→apply→save→record path as a live turn, MINUS
   * the agent call, and through the SAME per-visitor serial queue as `handle`, so
   * a late apply can't race a concurrent live turn for that visitor. Returns the
   * messages so the transport can deliver them out of band.
   */
  applyMessages(
    visitor: VisitorContext,
    event: ClientEvent,
    messages: readonly ServerMessage[],
    onRecordSettled?: RuntimeRecordSink,
  ): Promise<TurnResult> {
    // Reserve the Sink-write slot synchronously (same reason as `handle`): this
    // path also persists, so a later `record` must not overtake its write.
    const recordSlot = this.reserveRecordSlot(visitor.visitorId);
    return this.serialize(sessionKey(this.agentId, visitor.visitorId), async () => {
      try {
        const session = await this.stageStore.open(this.agentId, visitor);
        return await this.streamTurn(
          visitor,
          session,
          event,
          messages,
          recordSlot,
          undefined,
          onRecordSettled,
        );
      } catch (error) {
        recordSlot.resolve(null);
        throw error;
      }
    });
  }

  private async handleOne(
    visitor: VisitorContext,
    event: ClientEvent,
    recordSlot: RecordSlot,
    onFrame: RuntimeFrameSink | undefined,
    onRecordSettled: RuntimeRecordSink | undefined,
  ): Promise<TurnResult> {
    const session = await this.stageStore.open(this.agentId, visitor);
    const result = this.agent(event, session);
    return this.streamTurn(visitor, session, event, result, recordSlot, onFrame, onRecordSettled);
  }

  /**
   * Drives one turn's result batches inside the per-visitor serial queue. Each
   * batch is folded once, saved, then delivered synchronously before the next
   * batch is pulled. The Sink record stays turn-scoped: raw agent messages are
   * accumulated and written exactly once after the stream finishes, or after a
   * mid-stream producer throw with already-persisted batches. The write is resolved
   * after saved batches have been delivered, without blocking the next lane task.
   */
  private async streamTurn(
    visitor: VisitorContext,
    initialSession: FacetSession,
    event: ClientEvent,
    result: Parameters<typeof iterateAgentResult>[0],
    recordSlot: RecordSlot,
    onFrame?: RuntimeFrameSink,
    onRecordSettled?: RuntimeRecordSink,
  ): Promise<TurnResult> {
    const key = sessionKey(this.agentId, visitor.visitorId);
    if (this.stageStore.takeSeeded?.(this.agentId, visitor.visitorId) === true) {
      if (this.pendingSeeds.size >= MAX_PENDING_SEEDS) {
        const oldest = this.pendingSeeds.values().next().value;
        if (oldest !== undefined) this.pendingSeeds.delete(oldest);
      }
      this.pendingSeeds.add(key);
    }

    let session = initialSession;
    const accumulated: ServerMessage[] = [];
    const returned: ServerMessage[] = [];
    let agentMutated = false;
    let persistedAnyBatch = false;
    let seedPrepended = false;
    const iterator = iterateAgentResult(result)[Symbol.asyncIterator]();
    let completedNaturally = false;

    const closeIterator = async (): Promise<void> => {
      try {
        await iterator.return?.();
      } catch (error: unknown) {
        console.error("[facet] stream cleanup failed:", error);
      }
    };

    const seedFrame = (): ServerMessage | undefined =>
      !seedPrepended && this.pendingSeeds.has(key)
        ? { kind: "patch", patches: [{ op: "replace", path: "", value: session.stage }] }
        : undefined;

    const appendMessages = (target: ServerMessage[], source: readonly ServerMessage[]): void => {
      for (const message of source) target.push(message);
    };

    const deliverFrame = (frame: readonly ServerMessage[]): void => {
      if (frame.length === 0) return;
      if (onFrame !== undefined) onFrame(frame);
      else appendMessages(returned, frame);
    };

    const settleRecord = (entry: StoredEvent): void => {
      recordSlot.resolve(entry);
      onRecordSettled?.(recordSlot.settled);
    };

    const finishPartial = (): TurnResult => {
      settleRecord({ at: Date.now(), event, messages: accumulated });
      if (seedPrepended) this.pendingSeeds.delete(key);
      return { messages: onFrame === undefined ? returned : [], agentMutated };
    };

    try {
      while (true) {
        let next: IteratorResult<readonly ServerMessage[]>;
        try {
          next = await iterator.next();
        } catch (error) {
          if (!persistedAnyBatch) throw error;
          return finishPartial();
        }
        if (next.done === true) {
          completedNaturally = true;
          break;
        }

        const batch = this.asMessageBatch(next.value);
        if (batch.length === 0 || isTestOnlyServerMessageBatch(batch)) continue;

        const seed = seedFrame();
        const {
          session: applied,
          issues,
          messages: delivered,
          recordMessages,
          mutated,
        } = this.applyToSession(session, batch);
        try {
          await this.stageStore.save(applied);
        } catch (error) {
          if (!persistedAnyBatch) throw error;
          return finishPartial();
        }
        session = applied;
        persistedAnyBatch = true;
        appendMessages(accumulated, recordMessages);
        agentMutated = agentMutated || mutated;
        this.logIssues(issues);

        let frame = delivered;
        if (seed !== undefined) {
          const seededFrame: ServerMessage[] = [seed];
          appendMessages(seededFrame, delivered);
          frame = seededFrame;
        }
        if (frame.length > 0) {
          try {
            deliverFrame(frame);
          } catch {
            return finishPartial();
          }
          if (seed !== undefined) seedPrepended = true;
        }
      }
    } finally {
      if (!completedNaturally) await closeIterator();
    }

    const seed = seedFrame();
    if (seed !== undefined) {
      try {
        deliverFrame([seed]);
      } catch {
        return finishPartial();
      }
      seedPrepended = true;
    }
    settleRecord({ at: Date.now(), event, messages: accumulated });
    if (persistedAnyBatch || seedPrepended) this.pendingSeeds.delete(key);
    return { messages: onFrame === undefined ? returned : [], agentMutated };
  }

  private asMessageBatch(value: unknown): readonly ServerMessage[] {
    if (!Array.isArray(value)) {
      console.error("[facet] dropped a streamed batch that was not an array");
      return [];
    }
    const messages: ServerMessage[] = [];
    for (const message of value) {
      const normalized = asAgentServerMessage(message);
      if (normalized !== undefined) {
        messages.push(normalized);
      } else {
        console.error("[facet] dropped a malformed server message");
      }
    }
    return messages;
  }

  private logIssues(issues: readonly string[]): void {
    for (const issue of issues.slice(0, MAX_LOGGED_ISSUES)) {
      console.error(`[facet] save-time re-validation: ${issue}`);
    }
    if (issues.length > MAX_LOGGED_ISSUES) {
      console.error(
        `[facet] save-time re-validation: +${String(issues.length - MAX_LOGGED_ISSUES)} more suppressed`,
      );
    }
  }

  /**
   * Folds a turn's patch messages into the open session with the shared
   * `foldPatchIntoStage` — the SAME pure function the client runs in useFacet —
   * returning the sanitized session, any issues raised, AND the message list to
   * deliver. Because both sides fold identically, the stored stage this produces
   * equals the client's tree by construction; there is no separate divergence
   * signal to compute or converge (invariant #2).
   *
   * A single turn can legitimately carry MULTIPLE patch messages (Stage.say()
   * flushes pending ops mid-turn), and a later message may reference a node an
   * earlier one only appended a child ref for. Folding each message separately
   * would run validateTree's dangling-ref pruning on that intermediate state and
   * orphan the forward reference. So the turn's patch ops are CONCATENATED in
   * order and folded ONCE, and the delivered list replaces the turn's patch
   * messages with a single coalesced patch frame at the FIRST patch message's
   * position (say/other messages keep their relative order). The client folds that
   * one frame, so it prunes exactly what the server pruned — no drift, and the
   * final rendered state is the one the operator intended. Never throws.
   */
  private applyToSession(
    session: FacetSession,
    messages: readonly ServerMessage[],
  ): {
    readonly session: FacetSession;
    readonly issues: readonly string[];
    readonly messages: readonly ServerMessage[];
    readonly recordMessages: readonly ServerMessage[];
    // Whether the fold actually changed the stage (effect-based). False for a
    // patch-free turn and the over-cap reject, threaded from foldPatchIntoStage
    // otherwise. persistWithSeed surfaces this as TurnResult.agentMutated.
    readonly mutated: boolean;
  } {
    // Concatenate every patch message's ops in order (explicit loop, never
    // spread-push: a message could carry a huge op array and `push(...ops)` would
    // blow the call stack). foldPatchIntoStage's own MAX_PATCH_OPS cap then bounds
    // the coalesced batch.
    const turnOps: JsonPatchOperation[] = [];
    let sawPatchMessage = false;
    let droppedPatchMessage = false;
    let hasPatch = false;
    for (const message of messages) {
      if (message.kind === "patch") {
        sawPatchMessage = true;
        // A wire/in-process patch message can carry a non-array `patches` field
        // (untyped JS agent, unsafe cast). The concatenation runs BEFORE the fold,
        // so the fold's own non-array guard is unreachable here — drop the bad
        // message fail-soft (rest of the turn, says included, still applies and
        // delivers) instead of letting `for...of` throw through the never-throws seam.
        if (!Array.isArray(message.patches)) {
          console.error("[facet] dropped a patch message with non-array patches");
          droppedPatchMessage = true;
          continue;
        }
        hasPatch = true;
        for (const op of message.patches) turnOps.push(op);
      }
    }
    if (!hasPatch) {
      const cleanMessages = sawPatchMessage ? messages.filter((m) => m.kind !== "patch") : messages;
      return {
        session,
        issues: [],
        messages: cleanMessages,
        recordMessages: cleanMessages,
        mutated: false,
      };
    }

    // Enforce the op cap on the per-TURN aggregate, mirroring the wire boundary
    // (server `isControlBody`) and the fold's own per-batch cap. Individually
    // wire-valid patch messages can coalesce past MAX_PATCH_OPS; folding that batch
    // would reject it WHOLE, losing every edit while the multi-megabyte coalesced
    // frame still fanned out and was stored in the replay ring. Skip the fold, leave
    // the session unchanged, surface the issue, and OMIT the coalesced patch frame
    // from the delivered list (deliver only the non-patch messages).
    if (turnOps.length > MAX_PATCH_OPS) {
      return {
        session,
        issues: [
          `patch turn dropped: ${String(turnOps.length)} ops exceeds the ${String(MAX_PATCH_OPS)}-op cap`,
        ],
        messages: messages.filter((m) => m.kind !== "patch"),
        recordMessages: messages.filter((m) => m.kind !== "patch"),
        mutated: false,
      };
    }

    const { tree, issues, mutated } = foldPatchIntoStage(session.stage, turnOps);
    const allIssues: string[] = [];
    for (const issue of issues) allIssues.push(issue);

    const coalescedPatch: ServerMessage = { kind: "patch", patches: turnOps };
    const delivered: ServerMessage[] = [];
    const recordMessages: ServerMessage[] = [];
    let placed = false;
    for (const message of messages) {
      if (message.kind === "patch") {
        if (!Array.isArray(message.patches)) continue;
        // Replace the turn's patch messages with the single coalesced frame,
        // emitted once at the first patch message's slot.
        if (!placed) {
          delivered.push(coalescedPatch);
          placed = true;
        }
      } else {
        delivered.push(message);
      }
      recordMessages.push(message);
    }
    return {
      session: { ...session, stage: tree },
      issues: allIssues,
      messages: delivered,
      recordMessages: droppedPatchMessage ? recordMessages : messages,
      mutated,
    };
  }
}
