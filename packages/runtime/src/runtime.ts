import {
  applyPatch,
  createSerialQueue,
  validateTree,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
  type VisitorContext,
} from "@facet/core";
import { MemoryStageStore, sessionKey, type StageStore } from "./stage-store.js";
import { MemorySink, type Sink, type StoredEvent } from "./sink.js";

/** Hygiene cap on armed-but-undelivered seed keys (see `pendingSeeds`). */
const MAX_PENDING_SEEDS = 10_000;

export interface FacetRuntimeOptions {
  readonly agentId: string;
  readonly agent: FacetAgent;
  /** Where the current page lives. Defaults to in-memory. */
  readonly stageStore?: StageStore;
  /** Where the conversation goes. Defaults to an in-memory (replayable) sink. */
  readonly sink?: Sink;
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
  private readonly serialize = createSerialQueue<readonly ServerMessage[]>();
  // Serialize sink records per (agent, visitor) too: `record` is fire-and-forget
  // off the response path, so with an async sink a fast later record could persist
  // before a slow earlier one. This queue keeps per-visitor records in event order
  // without the response ever awaiting them. Different visitors stay parallel.
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
  handle(visitor: VisitorContext, event: ClientEvent): Promise<readonly ServerMessage[]> {
    return this.serialize(sessionKey(this.agentId, visitor.visitorId), () =>
      this.handleOne(visitor, event),
    );
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
  ): Promise<readonly ServerMessage[]> {
    return this.serialize(sessionKey(this.agentId, visitor.visitorId), async () => {
      const session = await this.stageStore.open(this.agentId, visitor);
      return this.persistWithSeed(visitor, session, event, messages);
    });
  }

  private async handleOne(
    visitor: VisitorContext,
    event: ClientEvent,
  ): Promise<readonly ServerMessage[]> {
    const session = await this.stageStore.open(this.agentId, visitor);
    const messages = await this.agent(event, session);
    return this.persistWithSeed(visitor, session, event, messages);
  }

  /**
   * If `open()` just created a fresh PRE-SEEDED session — a seeding `StageStore`
   * decorator (`withInitialStage`) reports it via `takeSeeded` — the seed must
   * travel the patch channel: the browser's first connection rehydrated BEFORE
   * this session existed, so its reset carried no snapshot and every later
   * incremental patch would target seed ids the client never received. Prepend
   * the seed as a root `replace` first frame so it gets a seq / replay-ring slot
   * and the same ordered list fans out to the client. Applying `replace ""` with
   * the already-seeded stage is a server-side no-op.
   *
   * The seed is consumed only once a turn PERSISTS: a failed turn (agent throw
   * before this runs, or a `save` rejection after arming) leaves the seed parked
   * in `pendingSeeds` so the next turn re-emits it — otherwise a client that
   * connected before the session existed would drift permanently (the blank-page
   * bug this mechanism exists to fix). A later reconnect gets the seed the normal
   * way, through the rehydrate snapshot.
   */
  private async persistWithSeed(
    visitor: VisitorContext,
    session: FacetSession,
    event: ClientEvent,
    messages: readonly ServerMessage[],
  ): Promise<readonly ServerMessage[]> {
    const key = sessionKey(this.agentId, visitor.visitorId);
    // Arm: `takeSeeded` fires at most once, so park the key until a turn
    // actually persists (evicting the oldest armed key at the cap).
    if (this.stageStore.takeSeeded?.(this.agentId, visitor.visitorId) === true) {
      if (this.pendingSeeds.size >= MAX_PENDING_SEEDS) {
        const oldest = this.pendingSeeds.values().next().value;
        if (oldest !== undefined) this.pendingSeeds.delete(oldest);
      }
      this.pendingSeeds.add(key);
    }
    // Emit the CURRENT stage, not a parked value: after a save that committed
    // and then rejected, the reopened session is ahead of the original seed and
    // this turn's messages were computed against it.
    const delivered: readonly ServerMessage[] = this.pendingSeeds.has(key)
      ? [
          { kind: "patch", patches: [{ op: "replace", path: "", value: session.stage }] },
          ...messages,
        ]
      : messages;
    const result = await this.persist(visitor, session, event, delivered);
    this.pendingSeeds.delete(key); // consume ONLY after persist resolved
    return result;
  }

  /**
   * Applies a turn's messages to the open session, saves, and fire-and-forget
   * records it — the shared tail of a live turn (`handleOne`) and a late apply
   * (`applyMessages`). The response never awaits the record: the stage is the
   * source of truth for reconnect; the sink is best-effort. Records enqueue per
   * visitor so an async sink persists them in event order.
   */
  private async persist(
    visitor: VisitorContext,
    session: FacetSession,
    event: ClientEvent,
    messages: readonly ServerMessage[],
  ): Promise<readonly ServerMessage[]> {
    await this.stageStore.save(this.applyToSession(session, messages));
    const entry = { at: Date.now(), event, messages };
    void this.serializeRecord(sessionKey(this.agentId, visitor.visitorId), () =>
      this.sink.record(this.agentId, visitor.visitorId, entry),
    ).catch((error: unknown) => console.error("[facet] sink failed:", error));
    return messages;
  }

  private applyToSession(session: FacetSession, messages: readonly ServerMessage[]): FacetSession {
    let stage = session.stage;
    for (const message of messages) {
      if (message.kind === "patch") {
        // Fail-safe: a single bad op must not lose the whole turn (incl. chat
        // replies). Guard the patches FIELD first (a wire message can carry a
        // non-array), then try the batch atomically; if it throws, salvage the
        // good ops one-by-one so ONE bad op doesn't silently discard every
        // edit the agent's tools already reported as applied.
        if (!Array.isArray(message.patches)) {
          console.error("[facet] dropped a patch message with non-array patches");
          continue;
        }
        try {
          stage = applyPatch(stage, message.patches);
        } catch {
          for (const op of message.patches) {
            try {
              stage = applyPatch(stage, [op]);
            } catch (error) {
              console.error("[facet] dropped an invalid patch op:", error);
            }
          }
        }
      }
    }
    // Keep the stored stage always-valid: a bad root replace (e.g. `render 'null'`
    // on the unvalidated CLI path) is sanitized here so persistence/rehydrate
    // never serves a corrupt tree.
    return { ...session, stage: validateTree(stage).tree };
  }
}
