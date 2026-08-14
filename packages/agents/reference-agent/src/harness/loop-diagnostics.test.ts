import { describe, expect, it } from "vitest";
import type {
  VisitorEvent,
  AuthorValidationResult,
  FacetCatalog,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";
import { validateCatalog } from "@facet/core";

import type { ProviderStep, ReferenceProvider } from "../provider.js";
import { normalizeBudget } from "./budget.js";
import type { ReferenceAgentDiagnosticEvent } from "./diagnostic-observer.js";
import { runReferenceAgentLoop } from "./loop.js";

const EVENT: VisitorEvent = {
  eventId: "turn1",
  eventName: "submit",
  sourceNodeId: "cta",
  screen: "home",
  stageRevision: 0,
  collect: {},
};

describe("reference-agent loop diagnostics", () => {
  it("reports provider attempts, tool execution, batch, and final stop in order", async () => {
    const events: ReferenceAgentDiagnosticEvent[] = [];
    const iterator = runReferenceAgentLoop({
      provider: scriptedProvider(
        {
          text: "",
          toolCalls: [
            {
              id: "call-1",
              name: "render_page",
              input: { markup: '<Screen name="home" />' },
            },
          ],
          usage: { inputTokens: 8, outputTokens: 3 },
        },
        { text: "done", toolCalls: [] },
      ),
      system: "system",
      event: EVENT,
      session: session(),
      budget: normalizeBudget({ budget: { retryBackoffMs: 0 } }),
      diagnostics: (event) => events.push(event),
      now: () => 1,
    });
    while (!(await iterator.next()).done) {
      // drain
    }

    expect(events.map((event) => event.kind)).toEqual([
      "provider-attempt",
      "tool-call",
      "tool-result",
      "batch",
      "provider-attempt",
      "stop",
    ]);
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "complete" });
  });
});

function scriptedProvider(...steps: readonly ProviderStep[]): ReferenceProvider {
  let next = 0;
  return {
    name: "openai",
    model: "scripted",
    async run() {
      const step = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (step === undefined) throw new Error("missing scripted step");
      return step;
    },
  };
}

function session(): FacetToolSession {
  let stageRevision = 0;
  return {
    catalog: catalog(),
    document: null,
    data: {},
    get stageRevision() {
      return stageRevision;
    },
    async applyAuthorMutation(): Promise<AuthorValidationResult> {
      stageRevision += 1;
      return {
        ok: true,
        document: {
          entry: "home",
          screens: ["s-home"],
          nodes: {
            "s-home": {
              tag: "Screen",
              props: { name: { kind: "scalar", value: "home" } },
              children: [],
            },
          },
        },
      };
    },
    async applyTargetedMutation() {
      return {
        ok: false as const,
        code: "not_used",
        at: "kind",
        detail: "not used",
      };
    },
    async publishData(): Promise<PayloadEvaluation> {
      stageRevision += 1;
      return { ok: true, chars: 0 };
    },
  };
}

function catalog(): FacetCatalog {
  const result = validateCatalog({
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen container.",
        props: {
          name: { type: "string", required: true, guidance: "Screen name." },
        },
        acceptsChildren: true,
      },
    ],
  });
  if (!result.ok) throw new Error(`invalid test catalog: ${result.code}`);
  return result.catalog;
}
