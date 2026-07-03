import {
  createSerialQueue,
  foldPatchIntoStage,
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
 * `agentMutated` is whether the AGENT'S OWN messages contained a stage patch —
 * computed BEFORE the seed frame is prepended — so a say-only turn that merely
 * re-emits a parked seed is not mistaken for a real edit. The transport gates
 * `recordApplied` on it: bumping "last applied" on a non-mutating turn would
 * falsely stale an older parked late result.
 */
export interface TurnResult {
  readonly messages: readonly ServerMessage[];
  readonly agentMutated: boolean;
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
  handle(visitor: VisitorContext, event: ClientEvent): Promise<TurnResult> {
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
  ): Promise<TurnResult> {
    return this.serialize(sessionKey(this.agentId, visitor.visitorId), async () => {
      const session = await this.stageStore.open(this.agentId, visitor);
      return this.persistWithSeed(visitor, session, event, messages);
    });
  }

  private async handleOne(visitor: VisitorContext, event: ClientEvent): Promise<TurnResult> {
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
  ): Promise<TurnResult> {
    const key = sessionKey(this.agentId, visitor.visitorId);
    // Whether the AGENT'S OWN turn mutated the stage — computed BEFORE the seed
    // frame is prepended below, so a say-only turn that merely re-emits a parked
    // seed is NOT counted as an edit. The transport gates `recordApplied` on this.
    const agentMutated = messages.some((m) => m.kind === "patch");
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
    // Save/deliver the seed-prefixed list, but record ONLY the agent's own
    // messages into the sink (the seed frame is a delivery mechanism, not a turn
    // reply — recording it would make history claim "(page updated)" falsely and
    // store the seed tree JSON per visitor).
    const result = await this.persist(visitor, session, event, delivered, messages);
    this.pendingSeeds.delete(key); // consume ONLY after persist resolved
    return { messages: result, agentMutated };
  }

  /**
   * Applies a turn's messages to the open session, saves, and fire-and-forget
   * records it — the shared tail of a live turn (`handleOne`) and a late apply
   * (`applyMessages`). The response never awaits the record: the stage is the
   * source of truth for reconnect; the sink is best-effort. Records enqueue per
   * visitor so an async sink persists them in event order.
   *
   * `messages` is what gets APPLIED + DELIVERED (seed frame included);
   * `recordMessages` (defaults to `messages`) is what gets RECORDED into the
   * sink — persistWithSeed passes the pre-seed list so the synthetic seed frame
   * never lands in conversation history.
   */
  private async persist(
    visitor: VisitorContext,
    session: FacetSession,
    event: ClientEvent,
    messages: readonly ServerMessage[],
    recordMessages: readonly ServerMessage[] = messages,
  ): Promise<readonly ServerMessage[]> {
    const { session: applied, issues } = this.applyToSession(session, messages);
    await this.stageStore.save(applied);
    const entry = { at: Date.now(), event, messages: recordMessages };
    void this.serializeRecord(sessionKey(this.agentId, visitor.visitorId), () =>
      this.sink.record(this.agentId, visitor.visitorId, entry),
    ).catch((error: unknown) => console.error("[facet] sink failed:", error));
    // Surface (don't drop) whatever the fold corrected, so an operator sees a
    // stripped/clamped/salvaged patch instead of it vanishing silently.
    // foldPatchIntoStage already caps its issue list, but slice defensively so an
    // issue list from any source can't flood the operator log synchronously.
    for (const issue of issues.slice(0, MAX_LOGGED_ISSUES)) {
      console.error(`[facet] save-time re-validation: ${issue}`);
    }
    if (issues.length > MAX_LOGGED_ISSUES) {
      console.error(
        `[facet] save-time re-validation: +${String(issues.length - MAX_LOGGED_ISSUES)} more suppressed`,
      );
    }
    // The delivered list is exactly what fanned out to the client. No corrective
    // frame is ever appended: the client folds each patch with the SAME
    // foldPatchIntoStage, so its tree already equals this stored stage.
    return messages;
  }

  /**
   * Folds a turn's patch messages into the open session with the shared
   * `foldPatchIntoStage` — the SAME pure function the client runs in useFacet —
   * returning the sanitized session and any issues raised. Because both sides
   * fold identically, the stored stage this produces equals the client's tree by
   * construction; there is no separate divergence signal to compute or converge
   * (invariant #2).
   *
   * Each patch message is folded in order, threading the validated tree forward
   * (matching the client, which applies one wire frame at a time). Non-patch
   * messages don't touch the stage. Never throws.
   */
  private applyToSession(
    session: FacetSession,
    messages: readonly ServerMessage[],
  ): {
    readonly session: FacetSession;
    readonly issues: readonly string[];
  } {
    let stage = session.stage;
    const allIssues: string[] = [];
    for (const message of messages) {
      if (message.kind === "patch") {
        const { tree, issues } = foldPatchIntoStage(stage, message.patches);
        stage = tree;
        if (issues.length > 0) allIssues.push(...issues);
      }
    }
    return { session: { ...session, stage }, issues: allIssues };
  }
}
