/**
 * The shared "live" agent logic — LLM page generation driven by conversation.
 * Both live entry points use it: the in-process fallback (`serve`, server.ts)
 * and the external dial-in agent (`agent`, agent-client.ts). The two differ only
 * in their welcome copy and whether the LLM is enabled, so those are parameters.
 *
 * Pattern precedent: ui.ts's welcome() extraction.
 */
import { defineAgent } from "@facet/agent";
import { generatePage } from "./generator.js";
import { welcome } from "./ui.js";

export interface LiveAgentOptions {
  /** Whether to call the LLM. When false, the agent echoes instead. */
  readonly useLlm: boolean;
  /** Subtitle for the blank-page welcome shown on first visit. */
  readonly welcomeSubtitle: string;
}

/** Builds the conversation-driven page agent shared by `serve` and `agent`. */
export function makeLiveAgent({ useLlm, welcomeSubtitle }: LiveAgentOptions) {
  return defineAgent(async ({ event, session, stage }) => {
    if (event.kind === "visit") {
      stage.render(welcome(welcomeSubtitle));
      return;
    }
    if (event.kind === "tap") {
      stage.say(`(you pressed: ${event.action.name})`);
      return;
    }
    // message
    if (!useLlm) {
      stage.say(
        `echo: ${event.text} (current page: ${String(Object.keys(session.stage.nodes).length)} nodes)`,
      );
      return;
    }
    try {
      const { tree, issues } = await generatePage(event.text, session.stage);
      stage.render(tree);
      stage.say(
        issues.length === 0
          ? "Here's your page."
          : `Built (repaired ${String(issues.length)} issue(s)).`,
      );
    } catch (error) {
      stage.say(
        `Sorry — generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
