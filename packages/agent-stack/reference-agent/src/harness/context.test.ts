import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  type ClientEvent,
  type FacetSession,
  type FacetTree,
  type ServerMessage,
} from "@facet/core";
import type { Sink, StoredEvent } from "@facet/runtime";

import { normalizeBudget } from "./budget.js";
import { assembleProviderContext } from "./context.js";

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

function messageText(
  message: { readonly content: string } | { readonly text: string } | undefined,
): string {
  if (message === undefined) return "";
  return "content" in message ? message.content : message.text;
}
