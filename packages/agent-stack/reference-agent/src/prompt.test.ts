import { describe, expect, it, vi } from "vitest";
import { EMPTY_TREE, STAGE_SPEC } from "@facet/core";
import type {
  ClientEvent,
  FacetSession,
  FacetStamp,
  FacetTheme,
  FacetTree,
  ServerMessage,
} from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import type { CollectedEvent } from "@facet/core";
import { FACET_STAGE_TOOL_SPECS } from "@facet/agent-tools";
import {
  DEFAULT_GUIDE,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
  describeEvent,
  formatCurrentStageForPrompt,
} from "./prompt.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "v1" },
  stage: EMPTY_TREE,
};

function largeStage(order: readonly number[]): FacetTree {
  const children = Array.from(
    { length: 90 },
    (_, index) => `node-${index.toString().padStart(3, "0")}`,
  );
  const nodes: Record<string, FacetTree["nodes"][string]> = {
    root: { id: "root", type: "box", children },
  };
  for (const index of order) {
    const id = `node-${index.toString().padStart(3, "0")}`;
    nodes[id] = {
      id,
      type: "text",
      value: `RAW_JSON_SENTINEL_${id}_${"x".repeat(900)}`,
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

function stored(text: string, messages: readonly ServerMessage[]): StoredEvent {
  return { at: 0, event: { kind: "message", text }, messages };
}

function stampSectionOf(system: string): string {
  const start = system.indexOf("STAMPS");
  const end = system.lastIndexOf("PAGE BRIEF");
  return start >= 0 && end > start ? system.slice(start, end) : "";
}

describe("buildSystem", () => {
  it("contains STAGE_SPEC verbatim, the tool workflow, and the guide under PAGE BRIEF", () => {
    const guide = "# My shop\n\nSell exactly one teapot.";
    const system = buildSystem(guide);
    expect(system).toContain(STAGE_SPEC);
    expect(system).toContain(guide);
    expect(system).toContain("PAGE BRIEF");
    // The workflow tells the model to build via tools, not prose.
    expect(system).toMatch(/render_page/);
    expect(system).toMatch(/append_node|set_node/);
    expect(system).toMatch(/reuse .*node ids/i);
  });

  it("teaches structured pending and visibility outcomes before completion", () => {
    const system = buildSystem(DEFAULT_GUIDE);
    expect(system).toContain("TOOL RESULT CONTRACT");
    expect(system).toContain("applied_visible");
    expect(system).toContain("applied_not_visible");
    expect(system).toContain("applied_with_warnings");
    expect(system).toContain("pending");
    expect(system).toContain("rejected");
    expect(system).toMatch(/Do not claim completion/i);
  });

  it("teaches appear/scroll/onHold through the embedded STAGE_SPEC (drift net)", () => {
    // Not a tautology on STAGE_SPEC inclusion: pins that the COMPOSED system
    // prompt actually carries the three new words, so quickstart notices if the
    // vocabulary ever drops out of the spec (and this bundle touches
    // packages/agent-stack/quickstart/ so the /live-test Tier-2 path heuristic fires).
    const system = buildSystem(DEFAULT_GUIDE);
    expect(system).toContain('"onHold"');
    expect(system).toMatch(/appear\(none\|fade\|slide\)/);
    expect(system).toMatch(/scroll\(x\|y\)/);
    expect(system).not.toMatch(/scroll\(bool\)/);
  });

  it("brick-vocab v1 prompt teaches media, field options, columns, and scroll axes", () => {
    const system = buildSystem(DEFAULT_GUIDE);
    expect(system).toContain('"type":"media"');
    expect(system).toMatch(/"image"\|"video"/);
    expect(system).toMatch(/"select"/);
    expect(system).toMatch(/"checkbox"/);
    expect(system).toContain('"options"?:[strings]');
    expect(system).toContain("columns(2|3|4)");
    expect(system).toContain("scroll(x|y)");
    expect(system).not.toContain("(box, text, image, field)");

    const tools = JSON.stringify(TOOLS);
    expect(tools).toContain("box | text | media | field");
    expect(tools).not.toContain("box | text | image | field");
  });

  it("exports a non-empty DEFAULT_GUIDE and HISTORY_TURNS = 20", () => {
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(DEFAULT_GUIDE).toContain("Northstar Studio");
    expect(DEFAULT_GUIDE.toLowerCase()).not.toContain("demo");
    expect(DEFAULT_GUIDE).not.toContain("Facet");
    expect(HISTORY_TURNS).toBe(20);
  });

  it("with no assets (or empty arrays) adds no THEMES/STAMPS section (DC-008 byte-identity)", () => {
    const guide = "# My shop\n\nSell exactly one teapot.";
    const base = buildSystem(guide);
    // Empty assets must produce the byte-identical no-assets string.
    expect(buildSystem(guide, { themes: [], stamps: [] })).toBe(base);
    // No injected asset SECTION is present (the STAGE_SPEC may mention a "THEMES
    // list" in prose — we probe for the section intros this WU adds, not the word).
    expect(base).not.toContain("select by NAME with the set_theme tool");
    expect(base).not.toContain("Reusable stamps you may expand");
  });

  it("injects theme names and descriptions never values", () => {
    const themes: FacetTheme[] = [
      {
        name: "midnight",
        description: "Dark, high-contrast night palette",
        color: { bg: "#0b1020", fg: "#e8ecff" },
      },
      { name: "sunrise", description: "Warm light morning palette", color: { bg: "#fff7ed" } },
    ];
    const system = buildSystem(DEFAULT_GUIDE, { themes, stamps: [] });

    expect(system).toContain("THEMES");
    // Names + one-line descriptions are present.
    expect(system).toContain("midnight");
    expect(system).toContain("Dark, high-contrast night palette");
    expect(system).toContain("sunrise");
    expect(system).toContain("Warm light morning palette");
    // NEVER a token value — probe each hex the document carried.
    expect(system).not.toContain("#0b1020");
    expect(system).not.toContain("#e8ecff");
    expect(system).not.toContain("#fff7ed");
    // Select-by-name rule points the model at set_theme.
    expect(system).toMatch(/set_theme/);
  });

  it("advertises stamp names, slots, and descriptions without embedding fragment JSON", () => {
    const stamps: FacetStamp[] = [
      {
        name: "cta",
        description: "A call-to-action button",
        slots: { label: "Get started", href: "/signup" },
        root: "cta",
        nodes: {
          cta: { id: "cta", type: "box", children: ["cta-label"] },
          "cta-label": { id: "cta-label", type: "text", value: "{{label}}" },
        },
      },
    ];
    const system = buildSystem(DEFAULT_GUIDE, { themes: [], stamps });
    const stampSection = stampSectionOf(system);

    expect(system).toContain("STAMPS");
    expect(stampSection).toContain("cta");
    expect(stampSection).toContain("A call-to-action button");
    expect(stampSection).toContain("label");
    expect(stampSection).toContain("href");
    expect(stampSection).toContain("use_stamp");
    expect(stampSection).not.toContain("cta-label");
    expect(stampSection).not.toContain('"nodes"');
    expect(stampSection).not.toContain("Get started");
  });

  it("advertises oversized stamps by name without copying their large JSON", () => {
    const big = "x".repeat(5000);
    const stamps: FacetStamp[] = [
      { name: "huge", root: "h", nodes: { h: { id: "h", type: "text", value: big } } },
    ];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const system = buildSystem(DEFAULT_GUIDE, { themes: [], stamps });
      const stampSection = stampSectionOf(system);
      expect(stampSection).toContain("huge");
      expect(stampSection).not.toContain(big);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("TOOLS", () => {
  it("re-exports agent-tools stage tools by identity", () => {
    expect(TOOLS).toBe(FACET_STAGE_TOOL_SPECS);
  });

  it("offers the Stage-mapped tools with schemas, including set_theme", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "append_node",
      "inspect_node",
      "inspect_stage",
      "remove_node",
      "render_page",
      "say",
      "set_node",
      "set_theme",
      "use_stamp",
    ]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters["type"]).toBe("object");
    }
  });

  it("set_theme takes a single name string argument (never a CSS value)", () => {
    const setTheme = TOOLS.find((t) => t.name === "set_theme");
    expect(setTheme).toBeDefined();
    const props = setTheme!.parameters["properties"] as Record<string, unknown>;
    // A NAME argument only — no value/color/css field the model could smuggle CSS through.
    expect(Object.keys(props)).toEqual(["name"]);
    expect(props["name"]).toMatchObject({ type: "string" });
  });

  it("use_stamp takes a stamp name, params map, and parent location", () => {
    const useStamp = TOOLS.find((t) => t.name === "use_stamp");
    expect(useStamp).toBeDefined();
    const props = useStamp!.parameters["properties"] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["name", "params", "at"]);
    expect(props["name"]).toMatchObject({ type: "string" });
    expect(props["params"]).toMatchObject({ type: "object" });
    expect(props["at"]).toMatchObject({ type: "object" });
  });
});

describe("buildInitialMessages", () => {
  it("caps history at the given limit, dropping the oldest", () => {
    const history: StoredEvent[] = [];
    for (let i = 0; i < 25; i += 1) {
      history.push(stored(`m${i}`, [{ kind: "say", text: `r${i}` }]));
    }
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildInitialMessages(event, SESSION, history, HISTORY_TURNS);

    // 20 history turns × (user + assistant) + the final user message
    expect(messages.length).toBe(HISTORY_TURNS * 2 + 1);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).not.toContain("m4");
    expect(all).toContain("m5");
    expect(all).toContain("m24");
  });

  it("replays no history when the limit is 0 (or negative)", () => {
    const history = [stored("old", [{ kind: "say", text: "reply" }])];
    const event: ClientEvent = { kind: "message", text: "now" };
    for (const limit of [0, -5]) {
      const messages = buildInitialMessages(event, SESSION, history, limit);
      expect(messages.length).toBe(1);
      expect("content" in messages[0]! ? messages[0].content : "").not.toContain("old");
    }
  });

  it("renders an action event's name, payload, and fields into the final user message", () => {
    const event: ClientEvent = {
      kind: "tap",
      action: { kind: "agent", name: "submit", payload: { plan: "pro" }, collect: "signup" },
      fields: { name: "Hoon", email: "hoon@example.com" },
    };
    const messages = buildInitialMessages(event, SESSION, [], HISTORY_TURNS);
    const final = messages[messages.length - 1]!;
    const content = "content" in final ? final.content : "";
    expect(content).toContain("submit");
    expect(content).toContain("pro");
    expect(content).toContain("Hoon");
    expect(content).toContain("hoon@example.com");
    expect(content).toContain(`CURRENT STAGE: ${JSON.stringify(SESSION.stage)}`);
  });

  it("redacts sensitive action field names in current and replayed prompt events", () => {
    const history: StoredEvent[] = [
      {
        at: 0,
        event: {
          kind: "tap",
          action: { kind: "agent", name: "stored-submit" },
          fields: { name: "Ada", note: "sk-history-secret", token: "stored-token-secret" },
        },
        messages: [],
      },
    ];
    const event: ClientEvent = {
      kind: "tap",
      action: { kind: "agent", name: "submit" },
      fields: {
        email: "ada@example.com",
        note: "Bearer prompt-secret",
        password: "hunter2",
        api_key: "sk-secret",
      },
    };

    const messages = buildInitialMessages(event, SESSION, history, HISTORY_TURNS);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("stored-submit");
    expect(all).toContain("submit");
    expect(all).toContain("Ada");
    expect(all).toContain("ada@example.com");
    expect(all).toContain("[redacted]");
    expect(all).not.toContain("sk-history-secret");
    expect(all).not.toContain("Bearer prompt-secret");
    expect(all).not.toContain("stored-token-secret");
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("sk-secret");
  });

  it("renders navigate/toggle history events and marks patches as (page updated)", () => {
    // Local navigate/toggle taps are recorded as `tap` rows carrying the
    // renderer-resolved `effect` (the 3-layer log currency).
    const history: StoredEvent[] = [
      {
        at: 0,
        event: { kind: "tap", target: "go-about", effect: { navigate: "about" } },
        messages: [],
      },
      {
        at: 1,
        event: { kind: "tap", target: "menu", effect: { toggle: "menu" } },
        messages: [{ kind: "patch", patches: [] }],
      },
    ];
    const event: ClientEvent = { kind: "message", text: "now" };
    const messages = buildInitialMessages(event, SESSION, history, HISTORY_TURNS);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("navigate to=about");
    expect(all).toContain("toggle target=menu");
    expect(all).toContain("(no reply)"); // navigate turn had no messages
    expect(all).toContain("(page updated)"); // toggle turn had a patch
  });

  it("describeEvent renders a tap and still replays a legacy action row", () => {
    // A current forward tap renders its agent action name, payload, and fields.
    const tap: ClientEvent = {
      kind: "tap",
      action: { kind: "agent", name: "submit", payload: { plan: "pro" }, collect: "signup" },
      fields: { name: "Hoon" },
    };
    // A legacy durable row persisted BEFORE the action→tap rename still carries
    // `kind:"action"` on disk. The reader normalizes it to a tap so a historical
    // interaction replays instead of degrading to "(unknown event)" (RISK-API-2).
    const legacyRow: StoredEvent = {
      at: 0,
      event: {
        kind: "action",
        action: { kind: "agent", name: "legacy-cta", payload: { id: "7" } },
      } as unknown as StoredEvent["event"],
      messages: [],
    };
    const messages = buildInitialMessages(tap, SESSION, [legacyRow], HISTORY_TURNS);
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");

    // The current tap rendered its name/payload/fields.
    expect(all).toContain("submit");
    expect(all).toContain("pro");
    expect(all).toContain("Hoon");

    // The legacy {kind:"action"} row replays as a tap, NOT "(unknown event)".
    const legacyLine = "content" in messages[0]! ? messages[0].content : "";
    expect(legacyLine).toContain("legacy-cta");
    expect(legacyLine).not.toContain("(unknown event)");
  });

  it("describeEvent returns a fallback (never throws) for a stored tap with a null action", () => {
    // A poisoned Sink row (or a legacy {kind:"action", action:null} forwarded via
    // normalizeLegacyEvent) yields a tap whose `action` is null. `null !== undefined`,
    // so a guard that only checks `!== undefined` would reach `null.kind` → TypeError.
    // describeEvent is contractually fail-safe: it must return a string, never throw.
    const poisoned = { kind: "tap", action: null } as unknown as CollectedEvent;
    expect(() => describeEvent(poisoned)).not.toThrow();
    expect(describeEvent(poisoned)).toBe("(unknown event)");
  });

  it("describeEvent returns a fallback for malformed visit and tap effect rows", () => {
    const malformedVisit = { kind: "visit" } as unknown as CollectedEvent;
    const malformedTap = { kind: "tap", effect: null } as unknown as CollectedEvent;

    expect(() => describeEvent(malformedVisit)).not.toThrow();
    expect(() => describeEvent(malformedTap)).not.toThrow();
    expect(describeEvent(malformedVisit)).toBe("(unknown event)");
    expect(describeEvent(malformedTap)).toBe("(unknown event)");
  });

  it("describeEvent returns a fallback for malformed message and action rows", () => {
    const malformedEvents = [
      { kind: "message" },
      { kind: "message", text: 42 },
      { kind: "tap", action: { kind: "navigate" } },
      { kind: "tap", action: { kind: "toggle" } },
      { kind: "tap", action: { kind: "agent", payload: { id: "7" } } },
    ] as unknown as readonly CollectedEvent[];

    for (const event of malformedEvents) {
      expect(() => describeEvent(event)).not.toThrow();
      expect(describeEvent(event)).toBe("(unknown event)");
    }
  });

  it("describeEvent survives non-serializable action payloads and fields", () => {
    const cyclicPayload: Record<string, unknown> = {};
    cyclicPayload["self"] = cyclicPayload;
    const poisoned = {
      kind: "tap",
      action: { kind: "agent", name: "submit", payload: cyclicPayload },
      fields: { count: 1n },
    } as unknown as CollectedEvent;

    expect(() => describeEvent(poisoned)).not.toThrow();
    expect(describeEvent(poisoned)).toBe("(action submit payload={} fields={})");
  });

  it("renders a corrupt/unknown history event as a safe placeholder (never undefined)", () => {
    const history: StoredEvent[] = [
      { at: 0, event: { kind: "weird-kind" } as unknown as ClientEvent, messages: [] },
    ];
    const messages = buildInitialMessages(
      { kind: "message", text: "now" },
      SESSION,
      history,
      HISTORY_TURNS,
    );
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("(unknown event)");
    expect(all).not.toContain("undefined");
  });

  it("renders malformed sink reply rows as no reply instead of throwing", () => {
    const history: StoredEvent[] = [
      {
        at: 0,
        event: { kind: "message", text: "old" },
        messages: null as unknown as readonly ServerMessage[],
      },
    ];

    expect(() =>
      buildInitialMessages({ kind: "message", text: "now" }, SESSION, history, HISTORY_TURNS),
    ).not.toThrow();
    const messages = buildInitialMessages(
      { kind: "message", text: "now" },
      SESSION,
      history,
      HISTORY_TURNS,
    );
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("(no reply)");
  });

  it("renders null sink history rows without throwing", () => {
    const history = [null] as unknown as readonly StoredEvent[];

    expect(() =>
      buildInitialMessages({ kind: "message", text: "now" }, SESSION, history, HISTORY_TURNS),
    ).not.toThrow();
    const messages = buildInitialMessages(
      { kind: "message", text: "now" },
      SESSION,
      history,
      HISTORY_TURNS,
    );
    const all = messages.map((m) => ("content" in m ? m.content : "")).join("\n");
    expect(all).toContain("(unknown event)");
    expect(all).toContain("(no reply)");
  });

  it("summarizes a malformed public stage input without throwing", () => {
    const malformed = { root: "root" } as unknown as FacetTree;

    expect(() => formatCurrentStageForPrompt(malformed, { maxJsonChars: 0 })).not.toThrow();
    const prompt = formatCurrentStageForPrompt(malformed, { maxJsonChars: 0 });

    expect(prompt).toContain("CURRENT STAGE SUMMARY");
    expect(prompt).toContain("nodes=1");
    expect(prompt).toContain("- root: type=box children=0");
  });

  it("summarizes malformed optional stage fields without throwing", () => {
    const malformed = {
      root: "root",
      nodes: { root: { id: "root", type: "box", children: [] } },
      entry: 42,
      theme: { name: "bad" },
    } as unknown as FacetTree;

    expect(() => formatCurrentStageForPrompt(malformed, { maxJsonChars: 0 })).not.toThrow();
    const prompt = formatCurrentStageForPrompt(malformed, { maxJsonChars: 0 });
    expect(prompt).not.toContain("entry=");
    expect(prompt).not.toContain("theme=");
  });

  it("skips full JSON serialization when summary mode is explicitly requested", () => {
    let stringifyAttempts = 0;
    const stage = {
      ...EMPTY_TREE,
      toJSON() {
        stringifyAttempts += 1;
        return EMPTY_TREE;
      },
    } as unknown as FacetTree;

    const prompt = formatCurrentStageForPrompt(stage, { maxJsonChars: 0 });

    expect(stringifyAttempts).toBe(0);
    expect(prompt).toContain("CURRENT STAGE SUMMARY");
  });

  it("skips full JSON serialization when the stage exceeds the JSON cap", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["huge"] },
        huge: { id: "huge", type: "text", value: "x".repeat(10_000) },
      },
      toJSON() {
        throw new Error("full stage JSON should not be attempted");
      },
    } as unknown as FacetTree;

    expect(() => formatCurrentStageForPrompt(stage, { maxJsonChars: 100 })).not.toThrow();
    const prompt = formatCurrentStageForPrompt(stage, { maxJsonChars: 100 });
    expect(prompt).toContain("CURRENT STAGE SUMMARY");
  });

  it("keeps full JSON when escaped control characters still fit the JSON cap", () => {
    const stage = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["text"] },
        text: { id: "text", type: "text", value: "\n".repeat(10_000) },
      },
    } as unknown as FacetTree;
    const json = JSON.stringify(stage);

    const prompt = formatCurrentStageForPrompt(stage, {
      maxJsonChars: json.length,
    });

    expect(prompt).toBe(`CURRENT STAGE: ${json}`);
  });

  it("renders a visit event's non-secret context but never the visitorId bearer key", () => {
    const event: ClientEvent = {
      kind: "visit",
      visitor: { visitorId: "secret-session-key-123", referrer: "news.ycombinator.com" },
    };
    const messages = buildInitialMessages(event, SESSION, [], HISTORY_TURNS);
    const content = "content" in messages[0]! ? messages[0].content : "";
    expect(content).toContain("visit");
    expect(content).toContain("news.ycombinator.com");
    expect(content).not.toContain("secret-session-key-123");
  });

  it("summarizes a large stage without embedding full JSON", () => {
    const naturalOrder = Array.from({ length: 90 }, (_, index) => index);
    const reverseOrder = [...naturalOrder].reverse();
    const event: ClientEvent = { kind: "message", text: "update the page" };

    const first = buildInitialMessages(
      event,
      { ...SESSION, stage: largeStage(naturalOrder) },
      [],
      HISTORY_TURNS,
    ).at(-1)!;
    const second = buildInitialMessages(
      event,
      { ...SESSION, stage: largeStage(reverseOrder) },
      [],
      HISTORY_TURNS,
    ).at(-1)!;
    const firstContent = "content" in first ? first.content : "";
    const secondContent = "content" in second ? second.content : "";

    expect(firstContent.includes("CURRENT STAGE SUMMARY")).toBe(true);
    expect(firstContent).toBe(secondContent);
    expect(firstContent).toContain("root=root");
    expect(firstContent).toContain("nodes=91");
    expect(firstContent).toContain("screens=2");
    expect(firstContent).toContain("entry=home");
    expect(firstContent).toContain("theme=studio");
    expect(firstContent).toContain("inspect_stage");
    expect(firstContent).toContain("inspect_node");
    expect(firstContent).not.toContain('"nodes"');
    expect(firstContent).not.toContain("RAW_JSON_SENTINEL");
    expect(firstContent).not.toContain('"patches"');
    expect(firstContent.length).toBeLessThan(14_000);
    expect(Array.from(firstContent).every((character) => character.charCodeAt(0) <= 0x7f)).toBe(
      true,
    );

    const nodeLines = firstContent.split("\n").filter((line) => line.startsWith("- node-"));
    expect(nodeLines).toHaveLength(80);
    expect(nodeLines[0]).toContain("node-000");
    expect(nodeLines.at(-1)).toContain("node-079");
  });
});
