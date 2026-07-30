import {
  deriveMessageId,
  parseMarkup,
  validateAuthorMarkup,
  type AgentEvent,
  type ComponentDocument,
  type ConversationMessage,
  type FacetToolSession,
} from "@facet/core";
import type { Sink, SummaryStore } from "@facet/runtime";
import { describe, expect, it } from "vitest";

import { normalizeBudget } from "./budget.js";
import { assembleProviderContext } from "./context.js";
import { summaryPayload, type ConversationSummary } from "./summary.js";
import type { TurnMessage } from "../provider.js";
import { DEFAULT_CATALOG } from "../../../../core/assets/src/index.js";

const EVENT: AgentEvent = {
  eventId: "evt-1",
  eventName: "submit",
  sourceNodeId: "cta",
  screen: "home",
  stageRevision: 3,
  collect: {},
};

const SUMMARY: ConversationSummary = {
  version: 1,
  visitor: "returning designer",
  pageDecisions: "home screen exists",
  collectedData: "none",
  pending: "add pricing",
  attempts: "none",
  omitted: "early messages",
};

describe("assembleProviderContext", () => {
  it("reads ConversationMessage history by key, bounds it, and appends the current observation", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith([
        message("turn-0", "visitor", "oldest"),
        message("turn-0", "assistant", "old reply"),
        message("turn-1", "visitor", "latest"),
      ]),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: {
          maxHistoryTurns: 1,
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

    const content = allText(result.turn.messages);
    expect(content).not.toContain("oldest");
    expect(content).not.toContain("old reply");
    expect(content).toContain("latest");
    expect(content).toContain('event="submit"');
    expect(content).toContain("CURRENT FACET OBSERVATION");
    expect(content).toContain("currentScreenMarkup:");
    expect(content).toContain("<Screen");
  });

  it("folds duplicate messageId records before prompt assembly", async () => {
    const duplicateId = deriveMessageId("turn-dup", "visitor");
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith([
        { ...message("turn-dup", "visitor", "stale copy"), messageId: duplicateId },
        { ...message("turn-dup", "visitor", "fresh copy"), messageId: duplicateId },
        message("turn-dup", "assistant", "assistant reply"),
      ]),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({ budget: { maxHistoryTurns: 10, maxContextChars: 20_000 } }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = allText(result.turn.messages);
    expect(result.stats.duplicateHistoryMessages).toBe(1);
    expect(content).not.toContain("stale copy");
    expect(content).toContain("fresh copy");
    expect(content).toContain("assistant reply");
  });

  it("assembles the current observation without leaking published data values", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="data:user.name" /></Screen>`, {
        user: { name: "SECRET_VALUE_SHOULD_NOT_APPEAR", plan: "enterprise" },
        rows: [{ secret: "ROW_SECRET_SHOULD_NOT_APPEAR", total: 12 }],
      }),
      sink: sinkWith([]),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({ budget: { maxContextChars: 20_000 } }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = allText(result.turn.messages);
    expect(content).toContain("data:");
    expect(content).toContain("fields=name, plan");
    expect(content).toContain("fields=secret, total");
    expect(content).not.toContain("SECRET_VALUE_SHOULD_NOT_APPEAR");
    expect(content).not.toContain("ROW_SECRET_SHOULD_NOT_APPEAR");
  });

  it("falls back to an observation summary when full markup does not fit the context", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(
        `<Screen name="home"><Text value="RAW_MARKUP_SENTINEL_${"x".repeat(900)}" /></Screen>`,
      ),
      sink: sinkWith([]),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: {
          maxContextChars: 700,
          maxHistoryChars: 100,
          maxStageJsonChars: 5_000,
          maxStageSummaryNodes: 3,
        },
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.stageMode).toBe("summary");
    expect(result.stats.estimatedContextChars).toBeLessThanOrEqual(700);
    const final = messageText(result.turn.messages.at(-1));
    expect(final).toContain("CURRENT FACET OBSERVATION");
    expect(final).toContain("currentScreenMarkup:");
    expect(final).toContain("(omitted by character limit)");
    expect(final).not.toContain("RAW_MARKUP_SENTINEL");
  });

  it("compacts history by character budget with explicit markers", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith([
        message("turn-0", "visitor", `ancient ${"a".repeat(300)}`),
        message("turn-0", "assistant", `ancient reply ${"b".repeat(300)}`),
        message("turn-1", "visitor", `latest ${"c".repeat(300)}`),
        message("turn-1", "assistant", `latest reply ${"d".repeat(300)}`),
      ]),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: {
          maxHistoryTurns: 10,
          maxHistoryChars: 260,
          maxContextChars: 4_000,
        },
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.stats.historyCompacted).toBe(true);
    expect(result.stats.historyChars).toBeLessThanOrEqual(260);

    const content = allText(result.turn.messages);
    expect(content).toContain("[history compacted:");
    expect(content).toContain("latest");
    expect(content).not.toContain("ancient");
  });

  it("injects a valid opaque summary once and replays only the post-marker tail", async () => {
    const history = [
      message("turn-0", "visitor", "summarized visitor"),
      message("turn-0", "assistant", "summarized assistant"),
      message("turn-1", "visitor", "tail visitor"),
    ];
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 20_000, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith({
        payload: { ...SUMMARY, anchor: history[0]?.messageId },
        coveredThrough: 2,
        generation: 4,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const firstMessage = result.turn.messages[0];
    expect(firstMessage?.role).toBe("user");
    expect(messageText(firstMessage)).toContain("CONVERSATION SUMMARY");
    expect(messageText(firstMessage)).toContain("generation 4");
    expect(messageText(firstMessage)).toContain("returning designer");

    const content = allText(result.turn.messages);
    expect(content.split("CONVERSATION SUMMARY").length - 1).toBe(1);
    expect(content).not.toContain("summarized visitor");
    expect(content).not.toContain("summarized assistant");
    expect(content).toContain("tail visitor");
    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.summaryGeneration).toBe(4);
    expect(result.stats.summaryCoveredThrough).toBe(2);
  });

  it("keeps a valid rolling summary when the original anchor slid out of the bounded history", async () => {
    const history = [
      message("turn-0", "visitor", "summarized visitor 0"),
      message("turn-0", "assistant", "summarized assistant 0"),
      message("turn-1", "visitor", "summarized visitor 1"),
      message("turn-1", "assistant", "summarized assistant 1"),
      message("turn-2", "visitor", "recent visitor 2"),
      message("turn-2", "assistant", "recent assistant 2"),
      message("turn-3", "visitor", "recent visitor 3"),
      message("turn-3", "assistant", "recent assistant 3"),
    ];
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 2, maxHistoryChars: 20_000, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith({
        payload: summaryPayload(SUMMARY, history, 4),
        coveredThrough: 4,
        generation: 5,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = allText(result.turn.messages);
    expect(content).toContain("CONVERSATION SUMMARY");
    expect(content).toContain("generation 5");
    expect(content).not.toContain("summarized visitor 0");
    expect(content).not.toContain("summarized assistant 1");
    expect(content).toContain("recent visitor 2");
    expect(content).toContain("recent assistant 3");
    expect(result.stats.summaryInjected).toBe(true);
    expect(result.stats.summaryCoveredThrough).toBe(4);
  });

  it("discards a summary whose anchor does not match the current conversation", async () => {
    const history = [message("turn-1", "visitor", "new conversation")];
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith(history),
      historyKey: "quickstart:v1",
      budget: normalizeBudget({
        budget: { maxHistoryTurns: 20, maxHistoryChars: 20_000, maxContextChars: 40_000 },
      }),
      summaryStore: summaryStoreWith({
        payload: { ...SUMMARY, anchor: "stale-anchor" },
        coveredThrough: 1,
        generation: 4,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const content = allText(result.turn.messages);
    expect(content).not.toContain("CONVERSATION SUMMARY");
    expect(content).toContain("new conversation");
    expect(result.stats.summaryInjected).toBe(false);
    expect(result.stats.summaryDiscarded).toBe("mismatch");
  });

  it("returns context_limit when the current event and summarized observation still cannot fit", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: { ...EVENT, arg: "x".repeat(500) },
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: sinkWith([]),
      historyKey: "quickstart:v1",
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

  it("returns sink_error when history cannot be read", async () => {
    const result = await assembleProviderContext({
      system: "system prompt",
      event: EVENT,
      session: sessionFromMarkup(`<Screen name="home"><Text value="Current" /></Screen>`),
      sink: {
        async history() {
          throw new Error("sink down");
        },
      },
      historyKey: "quickstart:v1",
      budget: normalizeBudget(),
    });

    expect(result.status).toBe("sink_error");
  });
});

function sinkWith(history: readonly ConversationMessage[]): Pick<Sink, "history"> {
  return {
    async history(key: string, limit: number) {
      expect(key).toBe("quickstart:v1");
      return history.slice(-Math.max(0, limit));
    },
  };
}

function summaryStoreWith(
  payload: unknown,
  opts: { readonly rejects?: boolean } = {},
): Pick<SummaryStore, "read"> {
  return {
    async read(key: string) {
      expect(key).toBe("quickstart:v1");
      if (opts.rejects === true) throw new Error("summary store down");
      return payload;
    },
  };
}

function message(
  turnId: string,
  role: ConversationMessage["role"],
  text: string,
): ConversationMessage {
  return {
    kind: "conversation",
    turnId,
    messageId: deriveMessageId(turnId, role),
    role,
    text,
    at: 0,
  };
}

function sessionFromMarkup(markup: string, data: FacetToolSession["data"] = {}): FacetToolSession {
  let document = documentFromMarkup(markup, data);
  return {
    catalog: DEFAULT_CATALOG,
    get document() {
      return document;
    },
    data,
    stageRevision: 3,
    async applyAuthorMutation(nextMarkup: string) {
      const parsed = parseMarkup(nextMarkup);
      if (!parsed.ok) {
        return parsed;
      }
      const result = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, data);
      if (result.ok) {
        document = result.document;
      }
      return result;
    },
    async applyTargetedMutation() {
      return {
        ok: false as const,
        code: "not_used",
        at: "kind",
        detail: "not used",
      };
    },
    async publishData() {
      return { ok: true, chars: 0 };
    },
  };
}

function documentFromMarkup(markup: string, data: FacetToolSession["data"]): ComponentDocument {
  const source = markup.includes("<Facet") ? markup : `<Facet entry="home">${markup}</Facet>`;
  const parsed = parseMarkup(source);
  if (!parsed.ok) throw new Error(parsed.error.cause);
  const result = validateAuthorMarkup(parsed.ast, DEFAULT_CATALOG, data);
  if (!result.ok) throw new Error(result.error.cause);
  return result.document;
}

function allText(messages: readonly TurnMessage[]): string {
  return messages.map(messageText).join("\n");
}

function messageText(message: TurnMessage | undefined): string {
  if (message === undefined) return "";
  return "content" in message ? message.content : message.text;
}
