import {
  createSdkMcpServer,
  query,
  tool,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Stage } from "@facet/agent";
import { safeEnv } from "./env.js";
import {
  STAGE_SPEC,
  validateTree,
  type ClientEvent,
  type FacetAgent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";

/**
 * The PERSISTENT driver: one always-on Claude session (via the Agent SDK's
 * streaming input) OWNS a link. Visitor events are fed into the live session one
 * at a time; the session drives the page through in-process `facet_*` tools whose
 * handlers write to the current turn's Stage. Because turns are processed
 * serially, each event's changes are cleanly attributed to that event.
 *
 * Uses the local Claude Code auth (no API key needed), same as the spawn runner.
 */

const SYSTEM = `You own a live web page and update it as visitors interact. Use the facet tools to change the page:
- render(tree): replace the whole page with a stage tree
- append(parentId, node): add a node under a parent
- set(node): add or replace a node by id
- remove(id): delete a node
- say(text): send a short chat reply

${STAGE_SPEC}

On a fresh visit, render a page. On a message, prefer append/set/remove to change just what's needed; render a fresh page only for a totally new request. Keep pages polished and complete.`;

interface Turn {
  readonly event: ClientEvent;
  readonly session: FacetSession;
  readonly stage: Stage;
  readonly resolve: (messages: readonly ServerMessage[]) => void;
}

/** Models sometimes pass tree/node args as a JSON string; accept either. */
function asJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function userText(event: ClientEvent, stage: FacetTree): string {
  const current = `The visitor's current page: ${JSON.stringify(stage)}`;
  if (event.kind === "visit") {
    return `A new visitor arrived. Render a welcoming page with the facet tools.`;
  }
  if (event.kind === "message") {
    return `${current}\n\nThe visitor said: "${event.text}". Update their page with the facet tools; optionally say() a short reply.`;
  }
  // Defensive: a malformed action event (no action object) must not throw here —
  // this runs inside the input() generator, where an uncaught TypeError would
  // end the SDK query stream and permanently kill the session for ALL visitors.
  // The spawn twin's `promptFor` (bridge.ts) mirrors this same guard.
  const name = typeof event.action?.name === "string" ? event.action.name : "(unknown)";
  return `${current}\n\nThe visitor pressed "${name}". React by updating their page with the facet tools.`;
}

export interface PersistentDriver {
  readonly agent: FacetAgent;
  close(): void;
}

export function createPersistentDriver(options: { model?: string } = {}): PersistentDriver {
  const pending: Turn[] = [];
  let current: Turn | undefined;
  let wake: (() => void) | undefined;
  let turnDone: (() => void) | undefined;
  let closed = false;

  const facetServer = createSdkMcpServer({
    name: "facet",
    version: "0.1.0",
    tools: [
      tool(
        "render",
        "Replace the whole page with a stage tree.",
        { tree: z.any() },
        async (args) => {
          // Sanitize untrusted LLM output through the fail-safe validator.
          current?.stage.render(validateTree(asJson<FacetTree>(args.tree)).tree);
          return { content: [{ type: "text", text: "rendered" }] };
        },
      ),
      tool(
        "append",
        "Add a node under a parent box.",
        { parentId: z.string(), node: z.any() },
        async (args) => {
          current?.stage.append(args.parentId, asJson<Parameters<Stage["append"]>[1]>(args.node));
          return { content: [{ type: "text", text: "appended" }] };
        },
      ),
      tool("set", "Add or replace a node by id.", { node: z.any() }, async (args) => {
        current?.stage.set(asJson<Parameters<Stage["set"]>[0]>(args.node));
        return { content: [{ type: "text", text: "set" }] };
      }),
      tool("remove", "Delete a node by id.", { id: z.string() }, async (args) => {
        current?.stage.remove(args.id);
        return { content: [{ type: "text", text: "removed" }] };
      }),
      tool("say", "Send a short chat reply to the visitor.", { text: z.string() }, async (args) => {
        current?.stage.say(args.text);
        return { content: [{ type: "text", text: "said" }] };
      }),
    ],
  });

  async function* input(): AsyncIterable<SDKUserMessage> {
    for (;;) {
      while (pending.length === 0 && !closed) {
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (closed) return;
      const turn = pending[0];
      if (turn === undefined) continue;
      current = turn;
      // Guard the per-turn prompt build: ANY throw inside this generator ends
      // the SDK query stream and kills the session for all visitors. A turn
      // whose event can't be rendered settles alone instead.
      let content: string;
      try {
        content = userText(turn.event, turn.session.stage);
      } catch (error) {
        console.error("[facet] skipping malformed event:", error);
        turn.resolve([{ kind: "say", text: "(could not process that interaction)" }]);
        current = undefined;
        pending.shift();
        continue;
      }
      yield {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
      };
      await new Promise<void>((resolve) => (turnDone = resolve));
      pending.shift();
    }
  }

  let dead = false;
  // If the session stream ends/errors, settle every waiting event instead of
  // stranding visitors forever (their `handle` promises would hang → server
  // timeout). Resolve with a short notice.
  const settleAll = (text: string): void => {
    const notice: readonly ServerMessage[] = [{ kind: "say", text }];
    if (current !== undefined) {
      current.resolve(notice);
      current = undefined;
    }
    for (const turn of pending) turn.resolve(notice);
    pending.length = 0;
    turnDone?.();
    turnDone = undefined;
  };

  const run = async (): Promise<void> => {
    try {
      for await (const message of query({
        prompt: input(),
        options: {
          systemPrompt: SYSTEM,
          mcpServers: { facet: facetServer },
          // Disable ALL built-in tools (Bash/Read/WebFetch/…); the brain gets only
          // the in-process facet_* tools. Stops a prompt-injected visitor from
          // reaching the shell/filesystem/network.
          tools: [],
          allowedTools: [
            "mcp__facet__render",
            "mcp__facet__append",
            "mcp__facet__set",
            "mcp__facet__remove",
            "mcp__facet__say",
          ],
          permissionMode: "bypassPermissions",
          // Replace the subprocess env entirely (the SDK does not merge) with a
          // safe allowlist — no operator secrets reach the prompt-injectable brain.
          env: safeEnv(),
          ...(options.model !== undefined ? { model: options.model } : {}),
        },
      })) {
        if (message.type === "result") {
          current?.resolve(current.stage.flush());
          current = undefined;
          turnDone?.();
          turnDone = undefined;
        }
      }
    } finally {
      if (!closed) {
        dead = true;
        console.error("[facet] persistent session ended — restart the bridge to resume");
        settleAll("(this page's agent went offline — check back soon)");
      }
    }
  };
  void run().catch((error: unknown) => console.error("[facet] persistent session error:", error));

  const agent: FacetAgent = (event, session) => {
    if (dead || closed) {
      return Promise.resolve<readonly ServerMessage[]>([
        { kind: "say", text: "(this page's agent is offline)" },
      ]);
    }
    return new Promise<readonly ServerMessage[]>((resolve) => {
      pending.push({ event, session, stage: new Stage(), resolve });
      wake?.();
      wake = undefined;
    });
  };

  return {
    agent,
    close: (): void => {
      closed = true;
      wake?.();
      settleAll("(this page's agent is offline)");
    },
  };
}
