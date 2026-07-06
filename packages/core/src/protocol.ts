import type { FacetAction, NodeId } from "./nodes.js";
import type { JsonPatchOperation } from "./patch.js";
import type { FacetTree } from "./tree.js";
import type { FacetAgentResult } from "./agent-result.js";

/**
 * Who is viewing. This is the context an agent uses to diverge the very first
 * paint — before a single word is exchanged — so two visitors hitting the same
 * link can see different stages immediately.
 */
export interface VisitorContext {
  /** Stable per-visitor id (cookie/device scoped). */
  readonly visitorId: string;
  /** Where the visitor came from, if known. */
  readonly referrer?: string;
  /** BCP-47 locale hint, e.g. "ko-KR". */
  readonly locale?: string;
  /** Prior-relationship hint, if the agent recognizes this visitor. */
  readonly relationship?: string;
}

/**
 * One live (agent, visitor) pair with its own stage. Two visitors of the same
 * agent link are two independent sessions — that isolation is what makes the
 * page "different for everyone".
 */
export interface FacetSession {
  readonly agentId: string;
  readonly visitor: VisitorContext;
  readonly stage: FacetTree;
}

/**
 * Shared character cap for a collected field, applied to its VALUE, its NAME,
 * and (server-side) the map KEY — enforced by the renderer at collection time
 * and by the server at `/event`, so the two sides cannot drift. One constant on
 * purpose: tuning it moves all three bounds together.
 */
export const MAX_FIELD_VALUE_CHARS = 2000;

/**
 * Shared cap on the NUMBER of collected fields in one action event — enforced
 * by the renderer at collection and by the server at `/event`, so the renderer
 * can't emit a fields object the server would reject wholesale (a real form has
 * a handful; this is a defense-in-depth bound).
 */
export const MAX_FIELDS_KEYS = 256;

/**
 * Shared cap on the NUMBER of options a select/radio field may carry. Core
 * validation and the raw renderer path both enforce it so prompt-authored trees
 * and live-patched trees cannot drift.
 */
export const MAX_FIELD_OPTIONS = 64;

export type FieldValue = string | boolean;
export type FieldValues = Readonly<Record<string, FieldValue>>;

/**
 * The renderer-resolved LOCAL effect of a tap — mirrors the navigate/toggle
 * branches of a `ClassifiedPress`. A local tap changes only view-state in the
 * browser (no agent turn); it is logged (not forwarded) so replay can reproduce
 * what the visitor saw. `navigate` names a screen; `toggle` names a node id.
 */
export type TapEffect = { readonly navigate: string } | { readonly toggle: NodeId };

/**
 * The log currency: every visitor action the runtime records, whether it was
 * forwarded to the agent or resolved locally. `ClientEvent` (the forward subset
 * the agent sees) is structurally **assignable to** this, so a `StoredEvent` can
 * hold both a forwarded agent tap and a purely-local tap.
 *
 * A `tap` unifies both shapes: a **local** tap carries `effect` (+ the pressed
 * box's `target`); a **forwarded agent** tap carries `action` (its `name`/
 * `payload` are read off `action`). Every variant may carry an optional
 * per-session monotonic `seq` — a forward-compatible wire field for gap
 * detection during replay.
 */
export type CollectedEvent =
  | { readonly kind: "visit"; readonly visitor: VisitorContext; readonly seq?: number }
  | { readonly kind: "message"; readonly text: string; readonly seq?: number }
  | {
      readonly kind: "tap";
      /** The pressed box's node id (present on a local tap). */
      readonly target?: NodeId;
      /** The renderer-resolved local effect (present on a local tap). */
      readonly effect?: TapEffect;
      /** The agent-routed action (present on a forwarded tap). */
      readonly action?: FacetAction;
      /**
       * Visitor-typed field values snapshotted at press time when the action
       * declares `collect`. Inert data riding the event — never part of the
       * stage tree, never interpreted or rendered back by Facet.
       */
      readonly fields?: FieldValues;
      readonly seq?: number;
    };

/**
 * Browser → agent. The FORWARD subset of `CollectedEvent` — everything the
 * visitor does that the agent actually sees flows in as one of these. It is
 * structurally assignable to `CollectedEvent` (forward ⊆ collected), so the same
 * value can be both forwarded to the agent and recorded to the log.
 */
export type ClientEvent =
  | { readonly kind: "visit"; readonly visitor: VisitorContext; readonly seq?: number }
  | { readonly kind: "message"; readonly text: string; readonly seq?: number }
  | {
      readonly kind: "tap";
      readonly action: FacetAction;
      /**
       * Visitor-typed field values snapshotted at press time when the action
       * declares `collect`. Inert data riding the event — never part of the
       * stage tree, never interpreted or rendered back by Facet.
       */
      readonly fields?: FieldValues;
      readonly seq?: number;
    };

/**
 * Agent → browser. The agent answers events with stage patches (RFC 6902
 * operations) and/or chat text.
 *
 * `reset` is SERVER-emitted, and only at the start of a full rehydrate — when
 * the server replays a session's entire history from the beginning (no resume
 * cursor to pick up from). It tells the client to clear accumulated chat before
 * the replay, so the conversation isn't duplicated (the stage replay is an
 * idempotent root-replace; the chat replay is not). It is NOT emitted on a
 * resume replay (which continues after the last seen frame), never sent by an
 * agent, and never synthesized by a client transport — `SseTransport` relays it
 * through like any other frame.
 */
export type ServerMessage =
  | { readonly kind: "patch"; readonly patches: readonly JsonPatchOperation[] }
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "reset" };

/** True for an RFC 6902 `test` op guard: a plain object whose `op` is "test". */
export function isJsonPatchTestOperation(op: unknown): boolean {
  return typeof op === "object" && op !== null && (op as Record<string, unknown>)["op"] === "test";
}

/**
 * Narrows the agent-emitted subset of `ServerMessage`. `reset` is deliberately
 * excluded: it is a server rehydrate control frame, never an agent reply.
 *
 * The returned value is JSON-normalized so in-process agents cannot deliver or
 * persist values the wire transport could not have represented.
 */
export function asAgentServerMessage(value: unknown): ServerMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, text, patches } = value as {
    kind?: unknown;
    text?: unknown;
    patches?: unknown;
  };
  const message =
    kind === "say" && typeof text === "string"
      ? ({ kind, text } satisfies ServerMessage)
      : kind === "patch" && Array.isArray(patches)
        ? ({ kind, patches } as ServerMessage)
        : undefined;
  if (message === undefined) return undefined;

  let normalized: unknown;
  try {
    normalized = JSON.parse(JSON.stringify(message));
  } catch {
    return undefined;
  }
  if (typeof normalized !== "object" || normalized === null) return undefined;
  const {
    kind: normalizedKind,
    text: normalizedText,
    patches: normalizedPatches,
  } = normalized as { kind?: unknown; text?: unknown; patches?: unknown };
  if (normalizedKind === "say" && typeof normalizedText === "string") {
    return { kind: normalizedKind, text: normalizedText };
  }
  if (normalizedKind === "patch" && Array.isArray(normalizedPatches)) {
    return normalized as ServerMessage;
  }
  return undefined;
}

/** True when a streamed batch is only RFC 6902 `test` guards and carries no edit. */
export function isTestOnlyServerMessageBatch(messages: readonly ServerMessage[]): boolean {
  let sawTest = false;
  for (const message of messages) {
    if (message.kind !== "patch") return false;
    if (!Array.isArray(message.patches)) return false;
    for (const op of message.patches) {
      if (!isJsonPatchTestOperation(op)) return false;
      sawTest = true;
    }
  }
  return sawTest;
}

/**
 * The contract a Facet agent implements: given an event and the current session,
 * return the messages to send back to that one visitor. The runtime owns calling
 * this and persisting the resulting stage; `@facet/agent` provides an ergonomic
 * way to author it.
 */
export type FacetAgent = (event: ClientEvent, session: FacetSession) => FacetAgentResult;

/**
 * The wire between a visitor (browser) and the runtime. A concrete transport wraps
 * a WebSocket/SSE connection (or an in-process link); keeping it an interface lets
 * one renderer/hook drive any of them.
 */
export interface FacetTransport {
  send(event: ClientEvent): void;
  subscribe(onMessage: (message: ServerMessage) => void): () => void;
  /**
   * Best-effort record of a `CollectedEvent` to the runtime's log — used for
   * locally-resolved taps that never reach the agent (navigate/toggle), so
   * replay can reproduce what the visitor saw. Optional and additive: existing
   * transports/test doubles that don't implement it still satisfy this contract,
   * and callers must treat it as fire-and-forget (`transport.record?.(event)`).
   */
  record?(event: CollectedEvent): void;
}

/**
 * Server → external agent wire frame (the agent-side channel): one visitor event
 * awaiting one control response. Single-sourced here so `@facet/server` (emitter)
 * and `@facet/agent-client` (consumer) can't drift.
 */
export interface AgentEventFrame {
  readonly type: "event";
  readonly requestId: number;
  readonly visitorId: string;
  readonly event: ClientEvent;
  /** The visitor's current stage — so the agent can refine, not rebuild. */
  readonly stage?: FacetTree;
}

/**
 * External agent → server control reply (the agent-side channel): the agent's
 * `ServerMessage`s answering one `AgentEventFrame`, tagged with the same
 * `requestId`. Single-sourced here so `@facet/server` (validator) and
 * `@facet/agent-client` (sender) can't drift.
 *
 * `agentId` is intentionally NOT part of the frame: the server routes the reply
 * by `requestId` (which pending event it settles), and the connection's token —
 * not a self-declared id — authenticates the link.
 */
export interface AgentControlFrame {
  readonly requestId: number;
  readonly messages: readonly ServerMessage[];
}

/**
 * The private cli→bridge wire contract: the JSON body the `facet` command POSTs
 * to the local bridge's `/cmd` endpoint. The bridge imports this type so a field
 * rename here can't drift silently on the parsing side. Hoisted to @facet/core
 * (next to ServerMessage) so both cli and bridge import it via the bare
 * `@facet/core` specifier rather than through cli's bin-only package surface.
 */
export interface CmdFrame {
  /** The visitor event this batch of messages belongs to (`FACET_EVENT`). */
  readonly token: string;
  /** The stage messages produced by the command. */
  readonly messages: readonly ServerMessage[];
}
