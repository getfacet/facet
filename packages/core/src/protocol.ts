import type { FacetAction } from "./nodes.js";
import type { JsonPatchOperation } from "./patch.js";
import type { FacetTree } from "./tree.js";

/**
 * Who is viewing. This is the context an agent uses to diverge the very first
 * paint — before a single word is exchanged — so two visitors hitting the same
 * link can see different stages immediately.
 */
export interface VisitorContext {
  /** Stable per-viewer id (cookie/device scoped). */
  readonly visitorId: string;
  /** Where the visitor came from, if known. */
  readonly referrer?: string;
  /** BCP-47 locale hint, e.g. "ko-KR". */
  readonly locale?: string;
  /** Prior-relationship hint, if the agent recognizes this visitor. */
  readonly relationship?: string;
}

/**
 * One live (agent, visitor) pair with its own stage. Two viewers of the same
 * agent link are two independent sessions — that isolation is what makes the
 * page "different for everyone".
 */
export interface FacetSession {
  readonly agentId: string;
  readonly visitor: VisitorContext;
  readonly stage: FacetTree;
}

/** Browser → agent. Everything the viewer does flows in as one of these. */
export type ClientEvent =
  | { readonly kind: "visit"; readonly visitor: VisitorContext }
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "action"; readonly action: FacetAction };

/**
 * Agent → browser. The agent answers events with stage patches (RFC 6902
 * operations) and/or chat text.
 *
 * `reset` is TRANSPORT-synthesized, never sent by an agent: a transport emits it
 * when a dropped connection reopens, so the client clears accumulated chat
 * before the server replays the session's history (the stage replay is an
 * idempotent root-replace; the chat replay is not — without the reset every
 * reconnect would duplicate the whole conversation).
 */
export type ServerMessage =
  | { readonly kind: "patch"; readonly patches: readonly JsonPatchOperation[] }
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "reset" };

/**
 * The contract a Facet agent implements: given an event and the current session,
 * return the messages to send back to that one viewer. The runtime owns calling
 * this and persisting the resulting stage; `@facet/agent` provides an ergonomic
 * way to author it.
 */
export type FacetAgent = (
  event: ClientEvent,
  session: FacetSession,
) => Promise<readonly ServerMessage[]> | readonly ServerMessage[];

/**
 * The wire between a viewer (browser) and the runtime. A concrete transport wraps
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
