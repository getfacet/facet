import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  type ClientEvent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import type { Sink, StoredEvent, StoredSummary, SummaryStore } from "@facet/runtime";

import { normalizeBudget } from "./budget.js";
import { assembleProviderContext } from "./context.js";
import { conversationAnchor, summaryPayload } from "./summary.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "visitor-1" },
  stage: EMPTY_TREE,
};

function stored(text: string, messages: readonly ServerMessage[]): StoredEvent {
  return {
    at: 0,
    event: { kind: "message", text },
    messages,
  };
}

function sinkWith(history: readonly StoredEvent[]): Sink {
  return {
    async record() {},
    async history(agentId: string, visitorId: string) {
      expect(agentId).toBe("quickstart");
      expect(visitorId).toBe("visitor-1");
      return history;
    },
  };
}

function largeStage(order: readonly number[], textSize = 500): FacetTree {
  const children = order.map((index) => `node-${index.toString().padStart(3, "0")}`);
  const nodes: Record<string, FacetTree["nodes"][string]> = {
    root: { id: "root", type: "box", children },
  };
  for (const index of order) {
    const id = `node-${index.toString().padStart(3, "0")}`;
    nodes[id] = {
      id,
      type: "text",
      value: `RAW_JSON_SENTINEL_${id}_${"x".repeat(textSize)}`,
    };
  }
  return {
    root: "root",
    nodes,
    screens: { home: "root", review: "node-001" },
    entry: "home",
    theme: "studio",
  };
}

describe("assembleProviderContext", () => {
  it("reads sink history, bounds it by maxHistoryTurns, and appends the current event", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith([
        stored("oldest", [{ kind: "say", text: "old reply" }]),
        stored("middle", [{ kind: "say", text: "middle reply" }]),
        stored("newest", [{ kind: "say", text: "new reply" }]),
      ]),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: {
          maxHistoryTurns: 2,
          maxHistoryChars: 10_000,
          maxContextChars: 20_000,
        },
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.turn.system).toBe("system prompt");
    expect(result.stats.droppedHistoryTurns).toBe(1);
    expect(result.stats.estimatedContextChars).toBeLessThanOrEqual(20_000);

    const content = result.turn.messages
      .map((message) => ("content" in message ? message.content : message.text))
      .join("\n");
    expect(content).not.toContain("oldest");
    expect(content).toContain("middle");
    expect(content).toContain("newest");
    expect(content).toContain("current request");
    expect(content).toContain(`CURRENT STAGE: ${JSON.stringify(EMPTY_TREE)}`);
  });

  it("uses the bounded stage summary when full stage JSON exceeds the stage budget", async () => {
    const naturalOrder = Array.from({ length: 8 }, (_, index) => index);
    const reverseOrder = [...naturalOrder].reverse();
    const budget = normalizeBudget({
      budget: {
        maxStageJsonChars: 200,
        maxStageSummaryNodes: 3,
        maxContextChars: 20_000,
      },
    });

    const first = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "update the page" },
      session: { ...SESSION, stage: largeStage(naturalOrder) },
      sink: sinkWith([]),
      agentId: "quickstart",
      budget,
    });
    const second = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "update the page" },
      session: { ...SESSION, stage: largeStage(reverseOrder) },
      sink: sinkWith([]),
      agentId: "quickstart",
      budget,
    });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") return;

    const firstFinal = messageText(first.turn.messages.at(-1));
    const secondFinal = messageText(second.turn.messages.at(-1));
    expect(firstFinal).toBe(secondFinal);
    expect(first.stats.stageMode).toBe("summary");
    expect(firstFinal).toContain("CURRENT STAGE SUMMARY");
    expect(firstFinal).toContain("root=root");
    expect(firstFinal).toContain("nodes=9");
    expect(firstFinal).toContain("screens=2");
    expect(firstFinal).toContain("entry=home");
    expect(firstFinal).toContain("theme=studio");
    expect(firstFinal).toContain("inspect_stage");
    expect(firstFinal).toContain("inspect_node");
    expect(firstFinal).not.toContain('"nodes"');
    expect(firstFinal).not.toContain("RAW_JSON_SENTINEL");
    expect(firstFinal.split("\n").filter((line) => line.startsWith("- node-"))).toHaveLength(3);
  });

  it("falls back to a stage summary when full JSON fits the stage cap but not maxContextChars", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: { ...SESSION, stage: largeStage([0, 1, 2], 250) },
      sink: sinkWith([]),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: {
          maxStageJsonChars: 5_000,
          maxStageSummaryNodes: 2,
          maxContextChars: 700,
        },
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const final = messageText(result.turn.messages.at(-1));
    expect(result.stats.stageMode).toBe("summary");
    expect(result.stats.estimatedContextChars).toBeLessThanOrEqual(700);
    expect(final).toContain("CURRENT STAGE SUMMARY");
    expect(final).not.toContain("RAW_JSON_SENTINEL");
  });

  it("compacts history by maxHistoryChars with explicit markers and no raw patches", async () => {
    const history = [
      stored("ancient", [{ kind: "say", text: `ancient reply ${"a".repeat(300)}` }]),
      stored("recent", [
        {
          kind: "patch",
          patches: [{ op: "add", path: "/nodes/secret", value: "RAW_PATCH_SENTINEL" }],
        },
        { kind: "say", text: `recent reply ${"r".repeat(300)}` },
      ]),
      stored("latest", [{ kind: "say", text: `latest reply ${"l".repeat(300)}` }]),
    ];

    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "now" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: {
          maxHistoryTurns: 3,
          maxHistoryChars: 260,
          maxContextChars: 4_000,
        },
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.historyCompacted).toBe(true);
    expect(result.stats.historyChars).toBeLessThanOrEqual(260);

    const content = result.turn.messages
      .map((message) => ("content" in message ? message.content : message.text))
      .join("\n");
    expect(content).toContain("[history compacted:");
    expect(content).toContain("latest");
    expect(content).not.toContain("ancient");
    expect(content).not.toContain('"patches"');
    expect(content).not.toContain("RAW_PATCH_SENTINEL");
  });

  it("returns context_limit when current event and summarized stage still cannot fit", async () => {
    const event: ClientEvent = { kind: "message", text: "x".repeat(500) };
    const result = await assembleProviderContext({
      system: "system prompt",
      event,
      session: { ...SESSION, stage: largeStage([0, 1, 2], 10) },
      sink: sinkWith([]),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: {
          maxContextChars: 120,
          maxStageJsonChars: 1,
          maxStageSummaryNodes: 1,
          maxHistoryChars: 10,
        },
      }),
    });

    expect(result.status).toBe("context_limit");
    if (result.status !== "context_limit") return;

    expect(result.stopReason).toBe("context_limit");
    expect(result.maxContextChars).toBe(120);
    expect(result.estimatedContextChars).toBeGreaterThan(120);
  });
});

const VALID_SUMMARY_PAYLOAD = {
  version: 1,
  visitor: "returning designer",
  pageDecisions: "home + review screens, studio theme",
  collectedData: "none",
  pending: "add a pricing screen",
  attempts: "none",
  omitted: "3 early turns",
} as const;

function summaryStoreWith(
  stored: StoredSummary | undefined,
  opts: { readonly rejects?: boolean } = {},
): Pick<SummaryStore, "get"> {
  return {
    async get(agentId: string, visitorId: string) {
      expect(agentId).toBe("quickstart");
      expect(visitorId).toBe("visitor-1");
      if (opts.rejects === true) throw new Error("summary store down");
      return stored;
    },
  };
}

function chatHistory(count: number): readonly StoredEvent[] {
  return Array.from({ length: count }, (_unused, index) =>
    stored(`turn-${String(index)}`, [{ kind: "say", text: `reply ${String(index)}` }]),
  );
}

/**
 * A stored summary carrying the conversation anchor of `history`, so it vets as
 * a consistent match (the reader now requires the anchor, not just the counter).
 */
function anchoredSummary(
  history: readonly StoredEvent[],
  opts: { readonly coveredThrough: number; readonly generation: number },
): StoredSummary {
  return {
    payload: summaryPayload(VALID_SUMMARY_PAYLOAD, conversationAnchor(history) ?? ""),
    coveredThrough: opts.coveredThrough,
    generation: opts.generation,
  };
}

describe("assembleProviderContext summary injection", () => {
  const BUDGET = normalizeBudget({
    budget: { maxHistoryTurns: 20, maxHistoryChars: 20_000, maxContextChars: 40_000 },
  });

  it("injects a valid summary once as the first user-role history message and replays only post-marker turns", async () => {
    const history = chatHistory(3);
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 4 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const firstMessage = result.turn.messages[0];
    expect(firstMessage?.role).toBe("user");
    const firstText = messageText(firstMessage);
    expect(firstText).toContain("CONVERSATION SUMMARY");
    expect(firstText).toContain("generation 4");
    expect(firstText).toContain("covers 1");
    expect(firstText).toContain("returning designer");

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content.split("CONVERSATION SUMMARY").length - 1).toBe(1);
    expect(content).toContain("turn-1");
    expect(content).toContain("turn-2");
    expect(content).not.toContain("turn-0");

    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.summaryGeneration).toBe(4);
    expect(result.stats.summaryCoveredThrough).toBe(1);
    expect(result.stats.summaryDiscarded).toBeUndefined();
  });

  it("keeps the system prompt byte-identical whether or not a summary is injected", async () => {
    const shared = {
      system: "system prompt",
      event: { kind: "message", text: "current request" } as ClientEvent,
      session: SESSION,
      agentId: "quickstart",
      budget: BUDGET,
    };
    const history = chatHistory(3);
    const withSummary = await assembleProviderContext({
      ...shared,
      sink: sinkWith(history),
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 2 }),
      ),
    });
    const withoutSummary = await assembleProviderContext({
      ...shared,
      sink: sinkWith(chatHistory(3)),
    });

    expect(withSummary.status).toBe("ready");
    expect(withoutSummary.status).toBe("ready");
    if (withSummary.status !== "ready" || withoutSummary.status !== "ready") return;

    expect(withSummary.turn.system).toBe(withoutSummary.turn.system);
    expect(withSummary.turn.system).toBe("system prompt");
  });

  it("discards a summary whose coveredThrough exceeds the history length", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(chatHistory(2)),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith({
        payload: VALID_SUMMARY_PAYLOAD,
        coveredThrough: 5,
        generation: 3,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
    expect(content).toContain("turn-0");
    expect(content).toContain("turn-1");
    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("mismatch");
  });

  it("assembles deterministically without injecting when the store read rejects", async () => {
    const shared = {
      system: "system prompt",
      event: { kind: "message", text: "current request" } as ClientEvent,
      session: SESSION,
      agentId: "quickstart",
      budget: BUDGET,
    };
    const failed = await assembleProviderContext({
      ...shared,
      sink: sinkWith(chatHistory(3)),
      summaryStore: summaryStoreWith(undefined, { rejects: true }),
    });
    const baseline = await assembleProviderContext({
      ...shared,
      sink: sinkWith(chatHistory(3)),
    });

    expect(failed.status).toBe("ready");
    expect(baseline.status).toBe("ready");
    if (failed.status !== "ready" || baseline.status !== "ready") return;

    expect(failed.stats.summaryInjected).toBe(false);
    expect(failed.stats.summaryDiscarded).toBe("store_error");
    const content = failed.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
    expect(failed.turn.messages).toStrictEqual(baseline.turn.messages);
  });

  it("discards an invalid summary payload", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(chatHistory(3)),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith({
        payload: { version: 99, nope: true },
        coveredThrough: 1,
        generation: 1,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("invalid");
  });

  it("replays exactly the post-marker tail when a stale summary lags behind history", async () => {
    const history = chatHistory(4);
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 7 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("turn-0");
    expect(content).toContain("turn-1");
    expect(content).toContain("turn-2");
    expect(content).toContain("turn-3");
    const replayedTurns = result.turn.messages.filter(
      (message) => message.role === "user" && messageText(message).startsWith("turn-"),
    );
    expect(replayedTurns).toHaveLength(3);
    expect(result.stats.summaryCoveredThrough).toBe(1);
  });

  it("produces identical output to the no-store path when the store returns no summary", async () => {
    const shared = {
      system: "system prompt",
      event: { kind: "message", text: "current request" } as ClientEvent,
      session: SESSION,
      agentId: "quickstart",
      budget: BUDGET,
    };
    const withStore = await assembleProviderContext({
      ...shared,
      sink: sinkWith(chatHistory(3)),
      summaryStore: summaryStoreWith(undefined),
    });
    const withoutStore = await assembleProviderContext({
      ...shared,
      sink: sinkWith(chatHistory(3)),
    });

    expect(withStore.status).toBe("ready");
    expect(withoutStore.status).toBe("ready");
    if (withStore.status !== "ready" || withoutStore.status !== "ready") return;

    expect(withStore.turn.system).toBe(withoutStore.turn.system);
    expect(withStore.turn.messages).toStrictEqual(withoutStore.turn.messages);
    expect(withStore.stats.summaryInjected).toBe(false);
    expect(withStore.stats.summaryDiscarded).toBeUndefined();
    const content = withStore.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
  });

  it("pins the summary block at the head while compacting a huge verbatim tail", async () => {
    const history = [
      stored("turn-0", [{ kind: "say", text: "reply 0" }]),
      stored("huge", [{ kind: "say", text: "H".repeat(5000) }]),
    ];
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 800, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 4 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const firstMessage = result.turn.messages[0];
    expect(firstMessage?.role).toBe("user");
    expect(messageText(firstMessage)).toContain("CONVERSATION SUMMARY");
    expect(messageText(firstMessage)).toContain("generation 4");

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    // The block survived; the newest (huge) turn was truncated to fit the tail budget.
    expect(content).toContain("[truncated:");
    expect(content).not.toContain("H".repeat(2000));

    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.summaryDiscarded).toBeUndefined();
    expect(result.stats.historyChars).toBeLessThanOrEqual(800);
  });

  it("omits the summary block when it alone exceeds the history budget", async () => {
    const history = chatHistory(3);
    const options = {
      system: "system prompt",
      event: { kind: "message", text: "current request" } as ClientEvent,
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 100, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 4 }),
      ),
    };
    const result = await assembleProviderContext(options);
    const again = await assembleProviderContext(options);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("budget");
    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
    // Deterministic: the same inputs assemble the same turn (no throw).
    expect(again.status).toBe("ready");
    if (again.status !== "ready") return;
    expect(again.turn.messages).toStrictEqual(result.turn.messages);
  });

  it("discards a summary whose stored generation is not a finite non-negative integer", async () => {
    for (const generation of [-1, 1.5, Number.NaN]) {
      const result = await assembleProviderContext({
        system: "system prompt",
        event: { kind: "message", text: "current request" },
        session: SESSION,
        sink: sinkWith(chatHistory(3)),
        agentId: "quickstart",
        budget: BUDGET,
        summaryStore: summaryStoreWith({
          payload: VALID_SUMMARY_PAYLOAD,
          coveredThrough: 1,
          generation,
        }),
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;

      const content = result.turn.messages.map((message) => messageText(message)).join("\n");
      expect(content).not.toContain("CONVERSATION SUMMARY");
      expect(result.stats.summaryInjected).toBe(false);
      expect(result.stats.summaryDiscarded).toBe("invalid");
    }
  });

  it("keeps a user message at the head of the verbatim tail when compaction is active", async () => {
    const history = Array.from({ length: 6 }, (_unused, index) =>
      stored(`turn-${String(index)}`, [
        { kind: "say", text: `reply ${String(index)} ${"z".repeat(80)}` },
      ]),
    );
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 600, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 4 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.historyCompacted).toBe(true);
    expect(result.turn.messages[0]?.role).toBe("user");
    expect(messageText(result.turn.messages[0])).toContain("CONVERSATION SUMMARY");
    // No orphan assistant left at the head after the pinned block.
    expect(result.turn.messages[1]?.role).toBe("user");
  });

  it("injects a summary whose stored anchor matches the current conversation", async () => {
    const history = chatHistory(3);
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 5 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).toContain("CONVERSATION SUMMARY");
    expect(content).not.toContain("turn-0");
    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.summaryGeneration).toBe(5);
    expect(result.stats.summaryCoveredThrough).toBe(1);
    expect(result.stats.summaryDiscarded).toBeUndefined();
  });

  it("discards a summary whose stored anchor no longer matches (wiped/reset sink regrown past the marker)", async () => {
    // Same length + in-range coveredThrough as a valid summary (the index-only
    // check would pass), but the sink was wiped and regrew a NEW conversation
    // with a different first entry — the anchor no longer matches.
    const history = chatHistory(3);
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      budget: BUDGET,
      summaryStore: summaryStoreWith({
        payload: summaryPayload(VALID_SUMMARY_PAYLOAD, "999:message"),
        coveredThrough: 1,
        generation: 4,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).not.toContain("CONVERSATION SUMMARY");
    // Every turn replays verbatim: nothing was folded into a block.
    expect(content).toContain("turn-0");
    expect(content).toContain("turn-1");
    expect(content).toContain("turn-2");
    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("mismatch");
  });

  it("accounts for the covered turns in the compaction note when the block is dropped for budget", async () => {
    const history = chatHistory(3);
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { kind: "message", text: "current request" },
      session: SESSION,
      sink: sinkWith(history),
      agentId: "quickstart",
      // maxHistoryChars is above the small verbatim tail but below the summary
      // block, so the block is dropped for budget while the tail survives.
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 200, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith(
        anchoredSummary(history, { coveredThrough: 1, generation: 4 }),
      ),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("budget");
    // The 1 turn the dropped block used to stand in for is accounted for in the
    // note's dropped-turn count, not silently vanished.
    expect(result.stats.droppedHistoryTurns).toBeGreaterThanOrEqual(1);
    const content = result.turn.messages.map((message) => messageText(message)).join("\n");
    expect(content).toContain("[history compacted:");
    expect(content).toContain("dropped 1 older turn");
  });
});

function messageText(
  message: { readonly content: string } | { readonly text: string } | undefined,
): string {
  if (message === undefined) return "";
  return "content" in message ? message.content : message.text;
}
