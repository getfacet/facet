import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_TREE, STAGE_SPEC, isContainer, treeHasContent, validateTree } from "@facet/core";
import type {
  ClientEvent,
  FacetCatalog,
  FacetComposition,
  FacetNode,
  FacetSession,
  FacetTheme,
  FacetTree,
  ServerMessage,
} from "@facet/core";
import type { StoredEvent } from "@facet/runtime";
import type { CollectedEvent } from "@facet/core";
import { QUICKSTART_INITIAL_STAGE, QUICKSTART_PAGE_BRIEF } from "./guide.js";
import {
  DEFAULT_GUIDE,
  HISTORY_TURNS,
  TOOLS,
  buildInitialMessages,
  buildSystem,
  describeEvent,
} from "./prompt.js";

const SESSION: FacetSession = {
  agentId: "quickstart",
  visitor: { visitorId: "v1" },
  stage: EMPTY_TREE,
};

function stored(text: string, messages: readonly ServerMessage[]): StoredEvent {
  return { at: 0, event: { kind: "message", text }, messages };
}

function compositionSectionOf(system: string): string {
  const start = system.indexOf("COMPOSITIONS");
  const end = system.lastIndexOf("PAGE BRIEF");
  return start >= 0 && end > start ? system.slice(start, end) : "";
}

function catalogSectionOf(system: string): string {
  const start = system.indexOf("CATALOG");
  const nextSections = ["COMPOSITIONS", "PAGE BRIEF"]
    .map((heading) => system.indexOf(heading, start + 1))
    .filter((index) => index > start);
  const end = nextSections.length > 0 ? Math.min(...nextSections) : system.length;
  return start >= 0 ? system.slice(start, end) : "";
}

function entryRootOf(tree: FacetTree): string {
  const entry = tree.entry;
  if (entry !== undefined && tree.screens !== undefined) {
    return tree.screens[entry] ?? tree.root;
  }
  return tree.root;
}

function collectTypes(
  tree: FacetTree,
  nodeId: string,
  out = new Set<FacetNode["type"]>(),
  seen = new Set<string>(),
) {
  const node = tree.nodes[nodeId];
  if (node === undefined || seen.has(nodeId) || seen.size > 1000) return out;
  seen.add(nodeId);
  out.add(node.type);
  if (isContainer(node)) {
    for (const child of node.children) collectTypes(tree, child, out, seen);
  }
  return out;
}

function collectTypesFromScreens(tree: FacetTree): Set<FacetNode["type"]> {
  const out = new Set<FacetNode["type"]>();
  for (const root of Object.values(tree.screens ?? { root: tree.root })) {
    collectTypes(tree, root, out);
  }
  return out;
}

const REPRESENTATIVE_COMPONENT_TYPES: readonly FacetNode["type"][] = [
  "section",
  "card",
  "tabs",
  "table",
  "chart",
  "field",
  "button",
  "metric",
  "badge",
  "progress",
  "alert",
  "list",
  "divider",
];

function catalogFixture(): FacetCatalog {
  return {
    name: "quickstart-catalog",
    description: "Quickstart catalog policy",
    theme: { active: "default", switchPolicy: "locked", allowed: ["default"] },
    bricks: [
      { type: "section", variants: ["surface"], guidance: "Use sections for compact screens." },
      { type: "button", variants: ["primary"] },
    ],
    compositions: { mode: "allow", names: ["pricing"] },
    primitiveFallback: "allowed",
    policy: {
      order: ["composition", "component", "primitive"],
      editBeforeAppend: true,
      compactScreens: true,
      maxScreenSections: 3,
    },
  };
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

  it("teaches font family tokens through the embedded STAGE_SPEC", () => {
    const system = buildSystem(DEFAULT_GUIDE);

    expect(system).toContain("family(sans|serif|mono)");
    expect(system).not.toContain("font-family:");
    expect(system).not.toContain("system-ui");
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
    expect(tools).toContain("Primitive bricks are box, text, media, field");
    expect(tools).not.toContain("box | text | image | field");
  });

  it("exports a non-empty DEFAULT_GUIDE and HISTORY_TURNS = 20", () => {
    expect(DEFAULT_GUIDE.length).toBeGreaterThan(0);
    expect(DEFAULT_GUIDE).toContain("Northstar Studio");
    expect(DEFAULT_GUIDE.toLowerCase()).not.toContain("demo");
    expect(DEFAULT_GUIDE).not.toContain("Facet");
    expect(HISTORY_TURNS).toBe(20);
  });

  it("quickstart component default guide validates its compact seeded first screen", () => {
    const system = buildSystem(QUICKSTART_PAGE_BRIEF);
    const { tree, issues } = validateTree(QUICKSTART_INITIAL_STAGE);
    const firstScreenTypes = Array.from(
      collectTypes(QUICKSTART_INITIAL_STAGE, entryRootOf(QUICKSTART_INITIAL_STAGE)),
    ).sort();
    const systemScreenTypes = Array.from(
      collectTypes(QUICKSTART_INITIAL_STAGE, QUICKSTART_INITIAL_STAGE.screens?.system ?? ""),
    ).sort();
    const allScreenTypes = Array.from(collectTypesFromScreens(QUICKSTART_INITIAL_STAGE)).sort();
    const serializedSeed = JSON.stringify(QUICKSTART_INITIAL_STAGE);

    expect(system).toContain("PAGE BRIEF");
    expect(system).toContain(QUICKSTART_PAGE_BRIEF);
    expect(system).toContain("navigate to that screen in the same turn");
    expect(system).toMatch(/Primitive Brick -> Component -> Catalog/i);
    expect(issues).toEqual([]);
    expect(treeHasContent(tree)).toBe(true);
    expect(QUICKSTART_INITIAL_STAGE.theme).toBe("default");
    expect(QUICKSTART_INITIAL_STAGE.entry).toBe("what");
    expect(Object.keys(QUICKSTART_INITIAL_STAGE.screens ?? {}).sort()).toEqual([
      "structure",
      "system",
      "usecases",
      "what",
    ]);
    expect(firstScreenTypes).toEqual(expect.arrayContaining(["button", "card", "chart"]));
    expect(systemScreenTypes).toEqual(expect.arrayContaining([...REPRESENTATIVE_COMPONENT_TYPES]));
    expect(allScreenTypes).toEqual(expect.arrayContaining([...REPRESENTATIVE_COMPONENT_TYPES]));
    expect(serializedSeed).toContain('"What is Facet?"');
    expect(serializedSeed).toContain('"Core Structure"');
    expect(serializedSeed).toContain('"Design System"');
    expect(serializedSeed).toContain('"Use Cases"');
    expect(serializedSeed).toContain('"Default composition patterns"');
    expect(serializedSeed).toContain('"pricing-section"');
    expect(serializedSeed).toContain('"collect":"qs.intake"');
    expect(serializedSeed).not.toMatch(
      /className|dangerouslySetInnerHTML|<script|#[0-9a-fA-F]{3,8}|\b\d+(px|rem|em|%)\b/,
    );
  });

  it("with no assets (or empty arrays) adds no THEMES/COMPOSITIONS section (DC-008 byte-identity)", () => {
    const guide = "# My shop\n\nSell exactly one teapot.";
    const base = buildSystem(guide);
    // Empty assets must produce the byte-identical no-assets string.
    expect(buildSystem(guide, { themes: [], compositions: [] })).toBe(base);
    // No injected asset SECTION is present (the STAGE_SPEC may mention a "THEMES
    // list" in prose — we probe for the section intros this WU adds, not the word).
    expect(base).not.toContain("select by NAME with the set_theme tool");
    expect(base).not.toContain("Reusable catalog compositions you may expand");
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
    const system = buildSystem(DEFAULT_GUIDE, { themes, compositions: [] });

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

  it("advertises composition names, slots, and descriptions without embedding fragment JSON", () => {
    const compositions: FacetComposition[] = [
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
    const system = buildSystem(DEFAULT_GUIDE, { themes: [], compositions });
    const compositionSection = compositionSectionOf(system);

    expect(system).toContain("COMPOSITIONS");
    expect(compositionSection).toContain("cta");
    expect(compositionSection).toContain("A call-to-action button");
    expect(compositionSection).toContain("label");
    expect(compositionSection).toContain("href");
    expect(compositionSection).toContain("use_composition");
    expect(compositionSection).not.toContain("cta-label");
    expect(compositionSection).not.toContain('"nodes"');
    expect(compositionSection).not.toContain("Get started");
  });

  it("advertises oversized compositions by name without copying their large JSON", () => {
    const big = "x".repeat(5000);
    const compositions: FacetComposition[] = [
      { name: "huge", root: "h", nodes: { h: { id: "h", type: "text", value: big } } },
    ];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const system = buildSystem(DEFAULT_GUIDE, { themes: [], compositions });
      const compositionSection = compositionSectionOf(system);
      expect(compositionSection).toContain("huge");
      expect(compositionSection).not.toContain(big);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("catalog policy guidance appears in the quickstart prompt compatibility export", () => {
    const system = buildSystem(DEFAULT_GUIDE, {
      themes: [
        {
          name: "default",
          description: "Default theme",
          color: { bg: "#ffffff", fg: "#111111" },
        },
      ],
      compositions: [],
      catalog: catalogFixture(),
    });
    const catalogSection = catalogSectionOf(system);

    expect(catalogSection).toContain("CATALOG");
    expect(catalogSection).toContain("quickstart-catalog");
    expect(catalogSection).toMatch(/switchPolicy:\s*locked/i);
    expect(catalogSection).toContain("allowed components: section variants: surface");
    expect(catalogSection).toContain("button variants: primary");
    expect(catalogSection).toContain("composition policy: allow pricing");
    expect(catalogSection).toContain("primitiveFallback: allowed");
    expect(catalogSection).toContain("policy order: composition -> component -> primitive");
    expect(catalogSection).not.toContain("#ffffff");
    expect(catalogSection).not.toContain("#111111");
    expect(catalogSection).not.toContain('"nodes"');
  });
});

describe("TOOLS", () => {
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
      "use_composition",
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

  it("use_composition takes a composition name, params map, and parent location", () => {
    const useComposition = TOOLS.find((t) => t.name === "use_composition");
    expect(useComposition).toBeDefined();
    const props = useComposition!.parameters["properties"] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(["name", "params", "at"]);
    expect(props["name"]).toMatchObject({ type: "string" });
    expect(props["params"]).toMatchObject({ type: "object" });
    expect(props["at"]).toMatchObject({ type: "object" });
  });

  it("use_composition wiring is canonical in quickstart cli.ts (loaded compositions, no legacy naming)", () => {
    // WU-11 structural gate: the CLI must thread `loadAssets().compositions`
    // into the reference-agent options and the resolved-assets hook; any
    // legacy pre-canonicalization naming in the quickstart CLI source is a
    // regression.
    const source = readFileSync(fileURLToPath(new URL("./cli.ts", import.meta.url)), "utf8");
    expect(source).toContain("loaded.compositions");
    expect(source).toContain("compositions");
    expect(source).not.toMatch(new RegExp(["st", "amp"].join(""), "i"));
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
});
