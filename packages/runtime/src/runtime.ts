import {
  applyPatch,
  createSerialQueue,
  MAX_DEPTH,
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
    const { session: applied, issues, diverged } = this.applyToSession(session, messages);
    await this.stageStore.save(applied);
    const entry = { at: Date.now(), event, messages: recordMessages };
    void this.serializeRecord(sessionKey(this.agentId, visitor.visitorId), () =>
      this.sink.record(this.agentId, visitor.visitorId, entry),
    ).catch((error: unknown) => console.error("[facet] sink failed:", error));
    // Surface (don't drop) whatever the save-time re-validate corrected, so an
    // operator sees a stripped/clamped patch instead of it vanishing silently.
    // validateTree already caps its issue list, but slice defensively so an
    // issue list from any source can't flood the operator log synchronously.
    for (const issue of issues.slice(0, MAX_LOGGED_ISSUES)) {
      console.error(`[facet] save-time re-validation: ${issue}`);
    }
    if (issues.length > MAX_LOGGED_ISSUES) {
      console.error(
        `[facet] save-time re-validation: +${String(issues.length - MAX_LOGGED_ISSUES)} more suppressed`,
      );
    }
    if (!diverged) return messages;
    // `diverged` means validateTree changed the stored tree in a way the
    // fail-safe live renderer does NOT reproduce (a cross-parent shared child
    // collapsed to one parent, a dropped/changed screens|entry, a root fallback)
    // OR a mixed batch was salvaged op-by-op here while the client applies the
    // batch atomically and drops it whole — either way live tabs (which applied
    // the RAW ops) hold content the STORED stage no longer has. The raw ops
    // already fanned out, so append a corrective root-replace AFTER the agent's
    // own frames: clients apply/attempt the raw ops, then converge on the stored
    // sanitized tree. It is delivery-only — NOT recorded into the sink
    // (recordMessages is the agent's own list), exactly like the seed frame.
    return [
      ...messages,
      { kind: "patch", patches: [{ op: "replace", path: "", value: applied.stage }] },
    ];
  }

  /**
   * Applies a turn's patch messages to the open session and RE-VALIDATES the
   * result, returning the sanitized session, any issues the re-validate raised,
   * and whether the stored tree DIVERGED from what live tabs will render.
   * `diverged` is the caller's signal to converge live clients with a corrective
   * root-replace: the raw ops were already delivered, so without it the
   * divergence persists on every live tab until it reloads.
   *
   * Two independent divergence sources:
   *  - SALVAGE: a mixed batch threw, so its good ops were applied op-by-op HERE,
   *    but the client applies the same batch atomically and drops it whole — any
   *    op that actually applied is a stored edit live tabs never got. (An
   *    all-ops-throw batch salvages nothing, so it is not a divergence.)
   *  - SANITISE: validateTree changed the tree in a way the fail-safe renderer
   *    does NOT reproduce (see `renderDiverged`).
   */
  private applyToSession(
    session: FacetSession,
    messages: readonly ServerMessage[],
  ): {
    readonly session: FacetSession;
    readonly issues: readonly string[];
    readonly diverged: boolean;
  } {
    let stage = session.stage;
    let salvaged = false;
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
          // The client (useFacet) applies this SAME batch atomically and drops
          // it whole on the throw. Salvage the good ops op-by-op; if ANY op
          // actually applies, the stored stage now holds an edit the client
          // dropped — a stored-vs-live divergence, so flag it for a corrective
          // frame. An all-ops-throw batch salvages nothing (stored unchanged),
          // so it is NOT a divergence.
          for (const op of message.patches) {
            try {
              stage = applyPatch(stage, [op]);
              salvaged = true;
            } catch (error) {
              console.error("[facet] dropped an invalid patch op:", error);
            }
          }
        }
      }
    }
    // Keep the stored stage always-valid: a bad root replace (e.g. `render 'null'`
    // on the unvalidated CLI path) is sanitized here so persistence/rehydrate
    // never serves a corrupt tree. Issues are surfaced (not dropped) so `persist`
    // can converge live clients on the sanitized result.
    const { tree, issues } = validateTree(stage);
    const diverged = salvaged || renderDiverged(stage, tree);
    return { session: { ...session, stage: tree }, issues, diverged };
  }
}

/** A record-shaped view of an unvalidated raw stage, or undefined if not an object. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Order-insensitive deep-equal for the small screens map / entry (JSON-shaped). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}

/**
 * True iff `validateTree` changed the tree in a way the fail-safe LIVE renderer
 * does NOT reproduce — the only differences that make a live tab (which applied
 * the RAW ops) drift from the stored sanitized tree. The renderer already
 * reproduces style defaults, `onPress` kind-stamping, and dangling/duplicate/
 * cyclic/too-deep child pruning identically, so a plain structural deep-equal
 * would false-positive on those on nearly every turn (a full-tree corrective
 * frame per edit). We compare ONLY the three transforms it does NOT reproduce:
 *   1. root fallback / a non-tree raw stage (validated root differs);
 *   2. a dropped or changed screens|entry (a non-box or dangling screen target);
 *   3. a cross-parent shared child collapsed to a single parent — detected on
 *      the RAW tree PER WALK ROOT (root + each screen root), so a node
 *      legitimately shared ACROSS screens (a common header/footer, which
 *      validateTree keeps) is NOT flagged, only a same-walk collapse is.
 */
function renderDiverged(raw: FacetTree, validated: FacetTree): boolean {
  const rawObj = asRecord(raw);
  // A non-object raw stage (e.g. `replace "" value:null`) can never match the
  // always-valid validated tree — its root differs from the fallback root.
  if (rawObj?.["root"] !== validated.root) return true;
  if (!jsonEqual(rawObj["screens"], validated.screens)) return true;
  if (!jsonEqual(rawObj["entry"], validated.entry)) return true;
  const roots = [validated.root, ...(validated.screens ? Object.values(validated.screens) : [])];
  return collapsedSharedChild(rawObj, roots);
}

/**
 * Mirrors `validateTree`'s shared-child collapse (`breakCycles`): DFS from each
 * walk root over the RAW nodes, resetting `claimed` per root. A child reached
 * twice WITHIN one walk is the collapse the renderer does not reproduce (it
 * would draw the subtree under both parents). Cyclic, dangling, and too-deep
 * children are skipped exactly as validateTree/the renderer skip them, so they
 * are never counted as a divergence.
 */
function collapsedSharedChild(rawObj: Record<string, unknown>, roots: readonly string[]): boolean {
  const nodes = asRecord(rawObj["nodes"]);
  if (nodes === undefined) return false;
  const childrenOf = (id: string): readonly string[] => {
    const node = asRecord(nodes[id]);
    if (node === undefined || node["type"] !== "box") return [];
    const children = node["children"];
    if (!Array.isArray(children)) return [];
    // Dedupe siblings within ONE parent (first occurrence wins), mirroring
    // pruneDanglingChildren — a duplicate under the SAME parent is a dedup the
    // renderer reproduces, NOT a cross-parent shared child.
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const c of children) {
      if (typeof c !== "string" || seen.has(c)) continue;
      seen.add(c);
      kept.push(c);
    }
    return kept;
  };
  for (const root of roots) {
    const claimed = new Set<string>();
    const inPath = new Set<string>();
    // Recursive DFS keeps the cycle/claim/depth semantics identical to
    // validateTree's breakCycles, so this flags exactly what it collapses.
    const visit = (id: string, depth: number): boolean => {
      inPath.add(id);
      for (const child of childrenOf(id)) {
        if (inPath.has(child)) continue; // cyclic — reproduced by the renderer
        if (depth >= MAX_DEPTH) continue; // too deep — reproduced by the renderer
        if (nodes[child] === undefined) continue; // dangling — reproduced
        if (claimed.has(child)) return true; // shared within this walk — NOT reproduced
        claimed.add(child);
        if (visit(child, depth + 1)) return true;
      }
      inPath.delete(id);
      return false;
    };
    if (visit(root, 0)) return true;
  }
  return false;
}
