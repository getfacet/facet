import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { buildDocument, type ComponentDocument, type ComponentNode } from "./document.js";
import { parseMarkup } from "./markup-parser.js";
import { serializeDocument, serializeScreen } from "./markup-serialize.js";

/**
 * What a document stores under a prop, taken from the node it belongs to. These
 * fixtures are *persisted* documents, so the document's own declaration is the
 * right source — and the ast's value alias is internal to the grammar anyway.
 */
type StoredValue = ComponentNode["props"][string];

/** Every reference scheme a stored value admits. Exhaustive: adding one breaks this. */
const REFERENCE_TARGETS: Record<Extract<StoredValue, { kind: "reference" }>["scheme"], string> = {
  data: "sales.total",
  nav: "home",
  agent: "refresh",
  asset: "hero-image",
};

const INDENT = " ".repeat(2);

function indent(level: number): string {
  return INDENT.repeat(level);
}

function scalar(value: string): StoredValue {
  return { kind: "scalar", value };
}

/** Builds a document from fixture markup, failing loudly if the fixture is bad. */
function documentFrom(markup: string): ComponentDocument {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    throw new Error(`fixture markup did not parse: ${parsed.error.code}`);
  }
  const document = buildDocument(parsed.ast);
  if (document === null) {
    throw new Error("expected the fixture markup to build a document");
  }
  return document;
}

/** The read-back half of the round trip: text in, document out. */
function rebuild(text: string): ComponentDocument | null {
  const parsed = parseMarkup(text);
  if (!parsed.ok) {
    throw new Error(`serialized text did not parse: ${parsed.error.code} — ${parsed.error.cause}`);
  }
  return buildDocument(parsed.ast);
}

function node(
  tag: string,
  props: Record<string, StoredValue>,
  children: readonly string[],
): ComponentNode {
  return { tag, props, children };
}

const EXAMPLE_MARKUP = [
  '<Facet entry="home">',
  '<Screen name="home">',
  '<Stack gap="md">',
  '<Text value="July revenue" />',
  '<Metric label="Total" value="data:sales.total" />',
  '<Button label="View details" action="nav:details" />',
  "</Stack>",
  "</Screen>",
  '<Screen name="details">',
  '<Table rows="data:sales.rows" />',
  '<Modal triggerLabel="Filter" title="Revenue filter">',
  '<Field name="region" label="Region" />',
  '<Button label="Refresh" action="agent:refresh" collect="region" />',
  "</Modal>",
  "</Screen>",
  "</Facet>",
].join("\n");

describe("serializeDocument — one grammar for write and read", () => {
  it("emits the Facet envelope, every screen, and a reserved id on every element", () => {
    const result = serializeDocument(documentFrom(EXAMPLE_MARKUP));

    expect(result.issues).toEqual([]);
    expect(result.text).toBe(
      [
        '<Facet entry="home">',
        `${indent(1)}<Screen name="home" id="n1">`,
        `${indent(2)}<Stack gap="md" id="n2">`,
        `${indent(3)}<Text value="July revenue" id="n3" />`,
        `${indent(3)}<Metric label="Total" value="data:sales.total" id="n4" />`,
        `${indent(3)}<Button label="View details" action="nav:details" id="n5" />`,
        `${indent(2)}</Stack>`,
        `${indent(1)}</Screen>`,
        `${indent(1)}<Screen name="details" id="n6">`,
        `${indent(2)}<Table rows="data:sales.rows" id="n7" />`,
        `${indent(2)}<Modal triggerLabel="Filter" title="Revenue filter" id="n8">`,
        `${indent(3)}<Field name="region" label="Region" id="n9" />`,
        `${indent(3)}<Button label="Refresh" action="agent:refresh" collect="region" id="n10" />`,
        `${indent(2)}</Modal>`,
        `${indent(1)}</Screen>`,
        "</Facet>",
      ].join("\n"),
    );
  });

  it("is byte-identical across repeat runs", () => {
    const document = documentFrom(EXAMPLE_MARKUP);

    expect(serializeDocument(document).text).toBe(serializeDocument(document).text);
  });

  it("chooses the quote character the value does not contain", () => {
    const document = documentFrom(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        "<Text value='he said \"yes\"' />",
        '<Text value="it\'s here" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );
    const result = serializeDocument(document);

    expect(result.issues).toEqual([]);
    expect(result.text).toContain("value='he said \"yes\"'");
    expect(result.text).toContain('value="it\'s here"');
    expect(rebuild(result.text)).toEqual(document);
  });

  /**
   * The serializer keeps its own list of writable schemes. `REFERENCE_TARGETS`
   * is keyed by the value union itself, so a scheme the document admits but this
   * module cannot write out would surface here as a dropped prop rather than
   * silently degrading a live reference.
   */
  it("writes back every reference scheme a stored value admits", () => {
    const attributes = Object.entries(REFERENCE_TARGETS)
      .map(([scheme, target], index) => `p${index + 1}="${scheme}:${target}"`)
      .join(" ");
    const document = documentFrom(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        `<Text ${attributes} />`,
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    const result = serializeDocument(document);

    expect(result.issues).toEqual([]);
    for (const [scheme, target] of Object.entries(REFERENCE_TARGETS)) {
      expect(result.text).toContain(`"${scheme}:${target}"`);
    }
    expect(rebuild(result.text)).toEqual(document);
  });

  it("writes a stored slot before ordinary props and round-trips it", () => {
    const document = documentFrom(
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Card slot="secondary" /></Split></Screen></Facet>',
    );
    const serialized = serializeDocument(document);

    expect(serialized.issues).toEqual([]);
    expect(serialized.text).toContain('<Card slot="primary" id="n3" />');
    expect(serialized.text).toContain('<Card slot="secondary" id="n4" />');
    expect(rebuild(serialized.text)).toEqual(document);
  });
});

describe("serializeScreen — the agent-facing read-back snapshot", () => {
  it("emits one screen, unwrapped, with ids", () => {
    const result = serializeScreen(documentFrom(EXAMPLE_MARKUP), "home");

    expect(result.issues).toEqual([]);
    expect(result.text).toBe(
      [
        '<Screen name="home" id="n1">',
        `${indent(1)}<Stack gap="md" id="n2">`,
        `${indent(2)}<Text value="July revenue" id="n3" />`,
        `${indent(2)}<Metric label="Total" value="data:sales.total" id="n4" />`,
        `${indent(2)}<Button label="View details" action="nav:details" id="n5" />`,
        `${indent(1)}</Stack>`,
        "</Screen>",
      ].join("\n"),
    );
  });

  it("reports an undeclared screen instead of throwing", () => {
    const result = serializeScreen(documentFrom(EXAMPLE_MARKUP), "nowhere");

    expect(result.text).toBe("");
    expect(result.issues).toEqual([{ reason: "missing-screen", at: "nowhere" }]);
  });
});

/* ------------------------------------------------------------------ *
 * Property-based round trip
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTAINER_TAGS = ["Stack", "Row", "Grid", "Card", "Modal"] as const;
const LEAF_TAGS = ["Text", "Metric", "Button", "Badge", "Table", "Field", "Empty"] as const;
const PROP_NAMES = ["label", "value", "gap", "tone", "rows", "action", "align"] as const;
const SCALAR_VALUES = [
  "July revenue",
  "",
  "a b c",
  'he said "yes"',
  "it's here",
  "<not a tag>",
  "café ☕",
  "line\nbreak",
  "trailing = sign",
] as const;
const REFERENCE_VALUES = ["data:sales.total", "nav:home", "agent:refresh"] as const;

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("empty pool");
  }
  return item;
}

/** The generator picks the same delimiter rule the serializer must arrive at. */
function quoted(value: string): string {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

function generateProps(random: () => number): string {
  const names = new Set<string>();
  const count = Math.floor(random() * 4);
  for (let taken = 0; taken < count; taken += 1) {
    names.add(pick(random, PROP_NAMES));
  }
  return [...names]
    .map((name) => {
      const value = random() < 0.3 ? pick(random, REFERENCE_VALUES) : pick(random, SCALAR_VALUES);
      return ` ${name}=${quoted(value)}`;
    })
    .join("");
}

function generateElement(random: () => number, depth: number): string {
  const nests = depth < 3 && random() < 0.5;
  if (!nests) {
    return `<${pick(random, LEAF_TAGS)}${generateProps(random)} />`;
  }
  const tag = pick(random, CONTAINER_TAGS);
  const children = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
    generateElement(random, depth + 1),
  ).join("");
  return `<${tag}${generateProps(random)}>${children}</${tag}>`;
}

function generateMarkup(random: () => number): string {
  const names = ["home", "details", "settings"].slice(0, 1 + Math.floor(random() * 3));
  const screens = names
    .map((name) => {
      const children = Array.from({ length: Math.floor(random() * 3) }, () =>
        generateElement(random, 1),
      ).join("");
      return `<Screen name="${name}">${children}</Screen>`;
    })
    .join("");
  return `<Facet entry="${pick(random, names)}">${screens}</Facet>`;
}

/** `count` distinct author props — none reserved, handler-shaped or dangerous. */
function authorProps(count: number): string {
  return Array.from({ length: count }, (_, index) => `p${index + 1}="v${index + 1}"`).join(" ");
}

/** A one-screen document whose single element carries `count` author props. */
function widestMarkup(count: number): string {
  return [
    '<Facet entry="home">',
    '<Screen name="home">',
    `<Text ${authorProps(count)} />`,
    "</Screen>",
    "</Facet>",
  ].join("\n");
}

/** The one element line of `widestMarkup` output — the screen's only child. */
function elementLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.includes("<Text "));
  if (line === undefined) {
    throw new Error("the serialized text carried no element line");
  }
  return line;
}

/** How many `name=` attributes a line writes out. Values here contain no `=`. */
function attributeCount(line: string): number {
  return (line.match(/[A-Za-z][A-Za-z0-9_-]*=/g) ?? []).length;
}

describe("parse(serialize(document)) — the round trip, including ids", () => {
  it("reproduces the same document over a generated corpus", () => {
    const random = mulberry32(0x5eed);

    for (let run = 0; run < 250; run += 1) {
      const markup = generateMarkup(random);
      const document = documentFrom(markup);
      const serialized = serializeDocument(document);

      expect(serialized.issues).toEqual([]);
      expect(rebuild(serialized.text)).toEqual(document);
      expect(serializeDocument(rebuild(serialized.text) as ComponentDocument).text).toBe(
        serialized.text,
      );
    }
  });

  /**
   * `B-04` bounds **author-declared** props. The reserved `id` the serializer
   * stamps on every element is excluded from that count — once per element —
   * which is precisely what keeps the round trip closed *at* the bound: an
   * element authored at the limit leaves as one attribute past it, and the read
   * back must reproduce what the write produced rather than reject it.
   */
  it("round-trips an element carrying exactly B-04 author props", () => {
    const document = documentFrom(widestMarkup(BOUNDS.propsPerElement));
    const serialized = serializeDocument(document);

    expect(serialized.issues).toEqual([]);
    expect(attributeCount(elementLine(serialized.text))).toBe(BOUNDS.propsPerElement + 1);

    const reparsed = parseMarkup(serialized.text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) {
      throw new Error(`the read-back was rejected: ${reparsed.error.code}`);
    }
    const rebuilt = buildDocument(reparsed.ast);

    expect(rebuilt).toEqual(document);
    expect(Object.keys(rebuilt?.nodes ?? {})).toEqual(Object.keys(document.nodes));
    expect(serializeDocument(rebuilt as ComponentDocument).text).toBe(serialized.text);
  });

  it("rejects an element one author prop past B-04", () => {
    const rejected = parseMarkup(widestMarkup(BOUNDS.propsPerElement + 1));

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("too-many-props");
    }
  });

  it("round-trips every screen read back on its own", () => {
    const random = mulberry32(0xc0ffee);

    for (let run = 0; run < 100; run += 1) {
      const document = documentFrom(generateMarkup(random));
      for (const screenId of document.screens) {
        const name = document.nodes[screenId]?.props["name"];
        if (name === undefined || name.kind !== "scalar") {
          throw new Error("a screen lost its name");
        }
        const result = serializeScreen(document, name.value);
        expect(result.issues).toEqual([]);
        const reparsed = parseMarkup(result.text);
        expect(reparsed.ok).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Structural fail-safe: a corrupt PERSISTED document
 * ------------------------------------------------------------------ */

/** A screen whose subtree loops back to an ancestor — unrepresentable by any author. */
function cyclicDocument(): ComponentDocument {
  return {
    entry: "home",
    screens: ["n1"],
    nodes: {
      n1: node("Screen", { name: scalar("home") }, ["n2"]),
      n2: node("Stack", { gap: scalar("md") }, ["n3", "n4"]),
      n3: node("Text", { value: scalar("still here") }, []),
      n4: node("Row", {}, ["n1"]),
    },
  };
}

function deepDocument(extra: number): ComponentDocument {
  const total = BOUNDS.elementDepth + extra;
  const nodes: Record<string, ComponentNode> = {
    n1: node("Screen", { name: scalar("home") }, ["n2"]),
  };
  for (let level = 2; level <= total; level += 1) {
    const child = level === total ? [] : [`n${level + 1}`];
    nodes[`n${level}`] = node("Stack", { gap: scalar("md") }, child);
  }
  return { entry: "home", screens: ["n1"], nodes };
}

describe("serializeDocument — total on a corrupt persisted document", () => {
  it("replaces a cycle with a bounded placeholder and keeps every valid sibling", () => {
    const document = cyclicDocument();
    const started = Date.now();

    const result = serializeDocument(document);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.issues).toEqual([{ reason: "cycle", at: "n1" }]);
    expect(result.text).toContain('<Text value="still here" id="n3" />');
    expect(result.text).toContain('<Unavailable id="n1" />');
    expect(result.text.length).toBeLessThan(2_000);
    expect(parseMarkup(result.text).ok).toBe(true);
  });

  it("returns byte-identical text for a cyclic document across repeat runs", () => {
    const document = cyclicDocument();

    expect(serializeDocument(document).text).toBe(serializeDocument(document).text);
    expect(serializeDocument(document).issues).toEqual(serializeDocument(document).issues);
  });

  it("cuts a subtree past B-03 instead of recursing", () => {
    const document = deepDocument(8);
    const started = Date.now();

    const result = serializeDocument(document);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe("depth");
    expect(result.issues[0]?.at).toBe(`n${BOUNDS.elementDepth}`);
    expect(result.text).toContain("<Unavailable id=");
    // The placeholder stands where the cut subtree stood, so it occupies the
    // first level past `B-03`. A document this deep has no legal markup, and the
    // degrade says so deterministically rather than inventing a shallower shape.
    const reparsed = parseMarkup(result.text);
    expect(reparsed.ok).toBe(false);
    if (!reparsed.ok) {
      expect(reparsed.error.code).toBe("too-deep");
    }
  });

  it("cuts one level deeper when the screen is read without the envelope", () => {
    const document = deepDocument(0);

    expect(serializeDocument(document).issues.map((issue) => issue.reason)).toEqual(["depth"]);
    expect(serializeScreen(document, "home").issues).toEqual([]);
  });

  it("reads the depth cut from BOUNDS, accepting a document exactly at the bound", () => {
    const atBound = deepDocument(-1);

    expect(serializeDocument(atBound).issues).toEqual([]);
  });

  it("replaces a dangling child reference with a placeholder", () => {
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, ["n2", "n9"]),
        n2: node("Text", { value: scalar("kept") }, []),
      },
    };

    const result = serializeDocument(document);

    expect(result.issues).toEqual([{ reason: "missing-node", at: "n9" }]);
    expect(result.text).toContain('<Text value="kept" id="n2" />');
    expect(result.text).toContain('<Unavailable id="n9" />');
    expect(parseMarkup(result.text).ok).toBe(true);
  });

  it("never interpolates a corrupt node id into authored markup", () => {
    const injected = 'n2" /><Button action="agent:pwn" id="n9';
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, [injected]),
      },
    };

    const result = serializeDocument(document);

    expect(result.issues).toEqual([{ reason: "invalid-node", at: injected }]);
    expect(result.text).toContain("<Unavailable />");
    expect(result.text).not.toContain("agent:pwn");
    expect(parseMarkup(result.text).ok).toBe(true);
  });

  it("bounds corrupt screen and child arrays before walking them", () => {
    const oversizedChildren = Array.from(
      { length: BOUNDS.nodesPerDocument + 100 },
      (_, index) => `n${index + 2}`,
    );
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, oversizedChildren),
      },
    };

    const result = serializeDocument(document);

    expect(result.issues.filter((issue) => issue.reason === "too-many-nodes")).toHaveLength(2);
    expect(result.text.length).toBeLessThan(250_000);
    expect(
      serializeDocument({
        ...document,
        screens: Array.from({ length: BOUNDS.screensPerDocument + 1 }, () => "n1"),
      }).issues,
    ).toEqual([{ reason: "invalid-document", at: "" }]);
  });

  it("replaces a node whose tag could not be written as markup", () => {
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, ["n2"]),
        n2: node("div onclick=alert(1)", {}, []),
      },
    };

    const result = serializeDocument(document);

    expect(result.issues).toEqual([{ reason: "invalid-node", at: "n2" }]);
    expect(result.text).not.toContain("onclick");
    expect(parseMarkup(result.text).ok).toBe(true);
  });

  it("omits a prop that cannot be written without breaking out of its quoting", () => {
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, ["n2"]),
        n2: node(
          "Text",
          {
            value: scalar("both \" and ' quotes"),
            "not a name": scalar("dropped"),
            long: scalar("x".repeat(BOUNDS.attributeValueChars + 1)),
            injected: scalar("data:looks.like.a.reference"),
            keep: scalar("safe"),
          },
          [],
        ),
      },
    };

    const result = serializeDocument(document);

    expect(result.issues).toEqual([
      { reason: "unrepresentable-prop", at: "n2", prop: "value" },
      { reason: "unrepresentable-prop", at: "n2", prop: "not a name" },
      { reason: "unrepresentable-prop", at: "n2", prop: "long" },
      { reason: "unrepresentable-prop", at: "n2", prop: "injected" },
    ]);
    expect(result.text).toContain('<Text keep="safe" id="n2" />');
    expect(parseMarkup(result.text).ok).toBe(true);
  });

  it("never emits the stored id as an authored prop", () => {
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: { n1: node("Screen", { name: scalar("home"), id: scalar("n99") }, []) },
    };

    const result = serializeDocument(document);

    expect(result.text).toContain('<Screen name="home" id="n1" />');
    expect(result.issues).toEqual([{ reason: "unrepresentable-prop", at: "n1", prop: "id" }]);
  });

  it("never duplicates a structural slot from a corrupt authored prop", () => {
    const document: ComponentDocument = {
      entry: "home",
      screens: ["n1"],
      nodes: {
        n1: node("Screen", { name: scalar("home") }, ["n2"]),
        n2: {
          tag: "Card",
          slot: "primary",
          props: { slot: scalar("secondary") },
          children: [],
        },
      },
    };

    const result = serializeDocument(document);

    expect(result.text).toContain('<Card slot="primary" id="n2" />');
    expect(result.text).not.toContain('slot="secondary"');
    expect(result.issues).toEqual([{ reason: "unrepresentable-prop", at: "n2", prop: "slot" }]);
    expect(parseMarkup(result.text).ok).toBe(true);
  });
});

describe("serializeDocument / serializeScreen — totality for any input", () => {
  const junk: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "<Facet />"],
    ["an empty object", {}],
    ["a document with no nodes record", { entry: "home", screens: ["n1"] }],
    ["a document with a non-array screen list", { entry: "home", screens: "n1", nodes: {} }],
  ];

  for (const [label, value] of junk) {
    it(`degrades rather than throwing for ${label}`, () => {
      expect(() => serializeDocument(value as ComponentDocument)).not.toThrow();
      expect(() => serializeScreen(value as ComponentDocument, "home")).not.toThrow();
      expect(serializeDocument(value as ComponentDocument)).toEqual({
        text: "",
        issues: [{ reason: "invalid-document", at: "" }],
      });
      expect(serializeScreen(value as ComponentDocument, "home")).toEqual({
        text: "",
        issues: [{ reason: "invalid-document", at: "" }],
      });
    });
  }

  it("survives a node whose property read throws", () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "tag", {
      enumerable: true,
      get() {
        throw new Error("hostile");
      },
    });
    const document = {
      entry: "home",
      screens: ["n1"],
      nodes: { n1: hostile },
    } as unknown as ComponentDocument;

    expect(() => serializeDocument(document)).not.toThrow();
    expect(serializeDocument(document).issues).toEqual([{ reason: "invalid-node", at: "n1" }]);
  });
});
