import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { FACET_PROMPT_KIT, FACET_TOOL_SPECS } from "@facet/agent-tools";
import type {
  VisitorEvent,
  AuthorValidationResult,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";
import { validateCatalog } from "@facet/core";

import * as promptModule from "./prompt.js";
import {
  DEFAULT_GUIDE,
  DEFAULT_STAGE_MARKUP_CHAR_LIMIT,
  DEFAULT_STAGE_SUMMARY_NODE_LIMIT,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
  describeEvent,
  formatCurrentStageForPrompt,
  summarizeStageForPrompt,
} from "./prompt.js";

function component(tag: string, whenToUse = `Use ${tag} when it fits.`): Record<string, unknown> {
  return {
    tag,
    whenToUse,
    props: {
      value: {
        type: "string",
        guidance: `DO_NOT_LEAK_PROP_SCHEMA_FOR_${tag}`,
      },
    },
    content: { mode: "none" },
  };
}

function screenSpec(): Record<string, unknown> {
  return {
    tag: "Screen",
    whenToUse: "Root screen container.",
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "Screen name.",
      },
    },
    content: { mode: "children" },
  };
}

function catalog(extraComponents: readonly Record<string, unknown>[] = []): FacetCatalog {
  const result = validateCatalog({
    components: [screenSpec(), component("Text"), ...extraComponents],
  });
  if (!result.ok) throw new Error(`expected catalog acceptance, got ${result.code}`);
  return result.catalog;
}

function scalar(value: string): { readonly kind: "scalar"; readonly value: string } {
  return Object.freeze({ kind: "scalar" as const, value });
}

function document(visibleText = "Visible", hiddenText = "Hidden"): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["s-home", "s-hidden"]),
    nodes: Object.freeze({
      "s-home": Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["n-visible"]),
      }),
      "n-visible": Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar(visibleText) }),
        children: Object.freeze([]),
      }),
      "s-hidden": Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("hidden") }),
        children: Object.freeze(["n-hidden"]),
      }),
      "n-hidden": Object.freeze({
        tag: "Text",
        props: Object.freeze({ value: scalar(hiddenText) }),
        children: Object.freeze([]),
      }),
    }),
  });
}

function session(
  input: {
    readonly catalog?: FacetCatalog;
    readonly document?: ComponentDocument | null;
    readonly data?: DataModel;
    readonly stageRevision?: number;
  } = {},
): FacetToolSession {
  return {
    catalog: input.catalog ?? catalog(),
    document: input.document === undefined ? document() : input.document,
    data: input.data ?? {},
    stageRevision: input.stageRevision ?? 7,
    applyAuthorMutation: async (): Promise<AuthorValidationResult> => ({
      ok: false,
      error: {
        code: "invalid-source",
        location: { line: 1, column: 1, offset: 0 },
        cause: "not used",
        repair: "not used",
      },
    }),
    applyTargetedMutation: async () => ({
      ok: false as const,
      code: "not_used",
      at: "kind",
      detail: "not used",
    }),
    publishData: async (): Promise<PayloadEvaluation> => ({ ok: true, chars: 0 }),
  };
}

function event(overrides: Partial<VisitorEvent> = {}): VisitorEvent {
  return {
    eventId: "turn1",
    eventName: "submit",
    sourceNodeId: "n-visible",
    screen: "home",
    stageRevision: 7,
    collect: {},
    ...overrides,
  };
}

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("buildSystem", () => {
  it("assembles the prompt from FACET_PROMPT_KIT and the deployer page brief", () => {
    const guide = "# My page\n\nHelp with account planning.";
    const system = buildSystem(guide);

    expect(system).toContain(FACET_PROMPT_KIT);
    expect(system).toContain("PAGE BRIEF");
    expect(system).toContain(guide);
    expect(system).toContain("render_page takes { markup }");
    expect(system).toContain("Conversation text is outside the tool roster");
    for (const word of [
      ["STAGE", "SPEC"].join("_"),
      ["Br", "ick"].join(""),
      ["Pat", "tern"].join(""),
      ["Pre", "set"].join(""),
    ]) {
      expect(system).not.toContain(word);
    }
    expect(system).not.toMatch(/\bsay\b/u);
  });

  it("exports a non-empty default guide without retired product framing", () => {
    expect(DEFAULT_GUIDE).toContain("Northstar Studio");
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(DEFAULT_GUIDE).not.toContain("Facet");
  });
});

describe("TOOLS", () => {
  it("uses the exact nine agent-tools specs and no conversational tool", () => {
    expect(TOOLS).toBe(FACET_TOOL_SPECS);
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "render_page",
      "insert_subtree",
      "replace_subtree",
      "update_node",
      "remove_subtree",
      "read_component_spec",
      "read_screen",
      "read_data",
      "publish_data",
    ]);
    expect(JSON.stringify(TOOLS.map((tool) => tool.name))).not.toContain('"say"');
    expect(TOOLS.every((tool) => tool.producesConversation === false)).toBe(true);
    expect(TOOLS.find((tool) => tool.name === "render_page")?.inputSchema.required).toEqual([
      "markup",
    ]);
    expect(JSON.stringify(TOOLS)).not.toContain('"tree"');
  });
});

describe("prompt public surface", () => {
  it("keeps prompt.ts an explicit named barrel with the approved keys only", () => {
    expect(Object.keys(promptModule).sort()).toEqual(
      [
        "DEFAULT_GUIDE",
        "DEFAULT_STAGE_MARKUP_CHAR_LIMIT",
        "DEFAULT_STAGE_SUMMARY_NODE_LIMIT",
        "HISTORY_TURNS",
        "TOOLS",
        "buildInitialMessages",
        "buildSystem",
        "describeEvent",
        "formatCurrentStageForPrompt",
        "summarizeStageForPrompt",
      ].sort(),
    );

    const barrel = source("./prompt.ts");
    expect(barrel).not.toContain("export *");
    expect(barrel).toContain("export type { StageSummaryOptions }");
    expect(barrel).not.toContain("PromptAssets");
    expect(barrel).not.toContain("redactSensitiveText");
  });
});

describe("stage observation prompt", () => {
  it("renders current-screen markup, screen index, component index, and valueless data summary", () => {
    const prompt = formatCurrentStageForPrompt(
      session({
        data: { rows: [{ name: "Ada", secret: "do-not-include" }] },
      }),
    );

    expect(prompt).toContain("CURRENT FACET OBSERVATION");
    expect(prompt).toContain("stageRevision=7");
    expect(prompt).toContain("currentScreen=home");
    expect(prompt).toContain("screens=home, hidden");
    expect(prompt).toContain("- Text: Use Text when it fits.");
    expect(prompt).toContain('<Text value="Visible" id="n-visible" />');
    expect(prompt).toContain("- rows: shape=array fields=name, secret count=1");
    expect(prompt).not.toContain("DO_NOT_LEAK_PROP_SCHEMA");
    expect(prompt).not.toContain("Ada");
    expect(prompt).not.toContain("do-not-include");
    expect(prompt).not.toContain("Hidden");
  });

  it("applies character and index ceilings deterministically", () => {
    const prompt = formatCurrentStageForPrompt(
      session({
        catalog: catalog(
          Array.from({ length: 100 }, (_, index) =>
            component(`Extra${index}`, `Use extra component ${index}.`),
          ),
        ),
        document: document(),
      }),
      { maxMarkupChars: 20, maxSummaryNodes: 4 },
    );

    expect(prompt).toContain("…[truncated]");
    expect(prompt).toContain("... 98 more components omitted");
    expect(prompt.length).toBeLessThan(2_000);
  });

  it("returns an explicit no-screen observation", () => {
    const prompt = formatCurrentStageForPrompt(session({ document: null }));
    expect(prompt).toContain("currentScreen=(none)");
    expect(prompt).toContain("currentScreenMarkup=(none)");
    expect(prompt).toContain("issues=no_current_screen");
  });

  it("exposes summary defaults under markup naming only", () => {
    expect(DEFAULT_STAGE_MARKUP_CHAR_LIMIT).toBe(48_000);
    expect(DEFAULT_STAGE_SUMMARY_NODE_LIMIT).toBe(80);
    expect(promptModule).not.toHaveProperty("DEFAULT_STAGE_JSON_CHAR_LIMIT");
  });

  it("summarizeStageForPrompt accepts an already-built observation", () => {
    const summary = summarizeStageForPrompt({
      stageRevision: 1,
      currentScreen: null,
      screens: ["home"],
      components: [
        { tag: "Card", whenToUse: "Use for grouped content.", contentClass: "Container" },
      ],
      data: [{ path: "orders", shape: "array", fields: ["id"], count: 1 }],
      issues: ["no_current_screen"],
    });

    expect(summary).toContain("stageRevision=1");
    expect(summary).toContain("- Card: Use for grouped content.");
    expect(summary).toContain("- orders: shape=array fields=id count=1");
  });
});

describe("buildInitialMessages", () => {
  it("replays ConversationMessage history and appends the current event plus observation", () => {
    const messages = buildInitialMessages(
      event({
        collect: {
          email: { kind: "value", value: "ada@example.com" },
          password: { kind: "omitted_sensitive" },
          missing: { kind: "collect_source_unavailable" },
        },
      }),
      session(),
      [
        {
          kind: "conversation",
          messageId: "1",
          turnId: "old1",
          role: "visitor",
          text: "old visitor",
          at: 0,
        },
        {
          kind: "conversation",
          messageId: "2",
          turnId: "old1",
          role: "assistant",
          text: "old assistant",
          at: 1,
        },
      ],
      HISTORY_TURNS,
    );

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0]).toMatchObject({ role: "user", content: "old visitor" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "old assistant" });
    const current = messages.at(-1);
    expect(current?.role).toBe("user");
    expect(current && "content" in current ? current.content : "").toContain(
      'event="submit" source="n-visible" screen="home"',
    );
    expect(current && "content" in current ? current.content : "").toContain(
      'email="ada@example.com"',
    );
    expect(current && "content" in current ? current.content : "").toContain(
      "password=omitted_sensitive",
    );
    expect(current && "content" in current ? current.content : "").toContain(
      "missing=collect_source_unavailable",
    );
    expect(current && "content" in current ? current.content : "").toContain(
      "CURRENT FACET OBSERVATION",
    );
  });

  it("caps history at the requested number of conversation records", () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      kind: "conversation" as const,
      messageId: String(index),
      turnId: String(index),
      role: "visitor" as const,
      text: `m${index}`,
      at: index,
    }));
    const messages = buildInitialMessages(event(), session(), history, 2);
    const text = messages
      .map((message) => ("content" in message ? message.content : ""))
      .join("\n");

    expect(text).not.toContain("m2");
    expect(text).toContain("m3");
    expect(text).toContain("m4");
  });
});

describe("describeEvent", () => {
  it("is total and ignores deleted visitor view snapshots", () => {
    const line = describeEvent({
      ...event({ arg: "details" }),
      view: { screen: "attacker", colorMode: "dark" },
    });

    expect(line).toContain('arg="details"');
    expect(line).not.toContain("colorMode");
    expect(line).not.toContain("attacker");
    expect(() => describeEvent({ kind: "message", text: "legacy" })).not.toThrow();
    expect(describeEvent({ kind: "message", text: "legacy" })).toBe("(unknown event)");
    expect(describeEvent(null)).toBe("(unknown event)");
  });
});
