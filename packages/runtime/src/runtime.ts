import {
  createSerialQueue,
  foldPatchIntoStage,
  MAX_PATCH_OPS,
  type ClientEvent,
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
    // Arm: `takeSeeded` fires at most once, so park the key until a turn
    // actually persists (evicting the oldest armed key at the cap).
    if (this.stageStore.takeSeeded?.(this.agentId, visitor.visitorId) === true) {
      if (this.pendingSeeds.size >= MAX_PENDING_SEEDS) {
        const oldest = this.pendingSeeds.values().next().value;
        if (oldest !== undefined) this.pendingSeeds.delete(oldest);
      }
      this.pendingSeeds.add(key);
    }
    // The seed is a DELIVERY-only prefix — a full `replace ""` snapshot the client
    // that connected before this session existed never received. It is prepended
    // as its OWN frame, NOT fed into `persist`, so `applyToSession`'s per-turn
    // coalescing never merges it into the agent's patch frame (the client must see
    // the snapshot as a distinct first frame). On the server it folds to a no-op
    // (session.stage is already the seeded stage), so the agent's own messages —
    // what `persist` applies and records — produce the same stored stage the client
    // reaches by folding [seed, ...agent frames]. Value is the CURRENT stage, not a
    // parked tree: after a save that committed then rejected, the reopened session
    // is ahead of the original seed and this turn's messages were computed against it.
    const seedFrame: ServerMessage | undefined = this.pendingSeeds.has(key)
      ? { kind: "patch", patches: [{ op: "replace", path: "", value: session.stage }] }
      : undefined;
    // `agentMutated` is EFFECT-based: whether the AGENT'S OWN turn actually
    // changed the stage (at least one non-`test` op applied), as reported by the
    // fold. The seed frame is prepended AFTER and is never fed to `persist`, so a
    // say-only turn that merely re-emits a parked seed reports false — the
    // transport must not advance "last applied" and stale a parked late result on
    // a turn whose patch was dropped whole (over-cap, non-array, empty, or an
    // all-ops-failed salvage).
    const { messages: applied, mutated: agentMutated } = await this.persist(
      visitor,
      session,
      event,
      messages,
    );
    const result = seedFrame !== undefined ? [seedFrame, ...applied] : applied;
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
   * `messages` is the AGENT'S OWN turn (no seed frame — persistWithSeed prepends
   * that to the delivered result). It gets applied to the stage, recorded verbatim
   * into the sink, and returned COALESCED (its patch messages folded into one
   * frame) for delivery — the exact frame the client folds, so no drift.
   */
  private async persist(
    visitor: VisitorContext,
    session: FacetSession,
    event: ClientEvent,
    messages: readonly ServerMessage[],
  ): Promise<{ readonly messages: readonly ServerMessage[]; readonly mutated: boolean }> {
    const {
      session: applied,
      issues,
      messages: delivered,
      mutated,
    } = this.applyToSession(session, messages);
    await this.stageStore.save(applied);
    const entry = { at: Date.now(), event, messages };
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
    // The delivered list is exactly what fanned out to the client — the turn's
    // patch messages COALESCED into one frame, the same single fold applied to the
    // stored stage above. No corrective frame is ever appended: the client folds
    // that one frame with the SAME foldPatchIntoStage, so its tree already equals
    // this stored stage.
    return { messages: delivered, mutated };
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
    let hasPatch = false;
    for (const message of messages) {
      if (message.kind === "patch") {
        // A wire/in-process patch message can carry a non-array `patches` field
        // (untyped JS agent, unsafe cast). The concatenation runs BEFORE the fold,
        // so the fold's own non-array guard is unreachable here — drop the bad
        // message fail-soft (rest of the turn, says included, still applies and
        // delivers) instead of letting `for...of` throw through the never-throws seam.
        if (!Array.isArray(message.patches)) {
          console.error("[facet] dropped a patch message with non-array patches");
          continue;
        }
        hasPatch = true;
        for (const op of message.patches) turnOps.push(op);
      }
    }
    if (!hasPatch) {
      return { session, issues: [], messages, mutated: false };
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
        mutated: false,
      };
    }

    const { tree, issues, mutated } = foldPatchIntoStage(session.stage, turnOps);
    const allIssues: string[] = [];
    for (const issue of issues) allIssues.push(issue);

    const coalescedPatch: ServerMessage = { kind: "patch", patches: turnOps };
    const delivered: ServerMessage[] = [];
    let placed = false;
    for (const message of messages) {
      if (message.kind === "patch") {
        // Replace the turn's patch messages with the single coalesced frame,
        // emitted once at the first patch message's slot.
        if (!placed) {
          delivered.push(coalescedPatch);
          placed = true;
        }
      } else {
        delivered.push(message);
      }
    }
    return {
      session: { ...session, stage: tree },
      issues: allIssues,
      messages: delivered,
      mutated,
    };
  }
}
