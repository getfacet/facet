import type { FacetAction } from "./nodes.js";
import type { JsonPatchOperation } from "./patch.js";
import type { FacetTree } from "./tree.js";

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
 * Shared cap on one collected field value's length — enforced by the renderer
 * at collection time and by the server at `/event`, so the two sides cannot
 * drift.
 */
export const MAX_FIELD_VALUE_CHARS = 2000;

/**
 * Shared cap on the NUMBER of collected fields in one action event — enforced
 * by the renderer at collection and by the server at `/event`, so the renderer
 * can't emit a fields object the server would reject wholesale (a real form has
 * a handful; this is a defense-in-depth bound).
 */
export const MAX_FIELDS_KEYS = 256;

/** Browser → agent. Everything the visitor does flows in as one of these. */
export type ClientEvent =
  | { readonly kind: "visit"; readonly visitor: VisitorContext }
  | { readonly kind: "message"; readonly text: string }
  | {
      readonly kind: "action";
      readonly action: FacetAction;
      /**
       * Visitor-typed field values snapshotted at press time when the action
       * declares `collect`. Inert data riding the event — never part of the
       * stage tree, never interpreted or rendered back by Facet.
       */
      readonly fields?: Readonly<Record<string, string>>;
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

/**
 * The contract a Facet agent implements: given an event and the current session,
 * return the messages to send back to that one visitor. The runtime owns calling
 * this and persisting the resulting stage; `@facet/agent` provides an ergonomic
 * way to author it.
 */
export type FacetAgent = (
  event: ClientEvent,
  session: FacetSession,
) => Promise<readonly ServerMessage[]> | readonly ServerMessage[];

/**
 * The wire between a visitor (browser) and the runtime. A concrete transport wraps
 * a WebSocket/SSE connection (or an in-process link); keeping it an interface lets
 * one renderer/hook drive any of them.
 */
export interface FacetTransport {
  send(event: ClientEvent): void;
  subscribe(onMessage: (message: ServerMessage) => void): () => void;
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
