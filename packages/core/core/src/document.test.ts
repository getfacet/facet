import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { buildDocument, type ComponentDocument, type ComponentNode } from "./document.js";
import { parseMarkup, type MarkupAst, type MarkupNode } from "./markup-parser.js";
import { serializeDocument } from "./markup-serialize.js";

/** Mutual assignability: `true` only when two types denote the same set. */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * `ComponentNode` writes its value union out rather than naming the parser's
 * internal alias, so nothing in the type system forces the two to agree on its
 * own. This does: the constant only typechecks while the document's stored value
 * and the ast's authored value are the same set, in **both** directions. A
 * grammar that gains a value the document does not restate — or a document that
 * restates one the grammar cannot produce — fails to compile here.
 */
const RESTATEMENT_IS_FAITHFUL: Mutual<
  ComponentNode["props"][string],
  MarkupNode["props"][number]["value"]
> = true;

/** Builds a document from fixture markup, failing loudly if the fixture itself is bad. */
function build(markup: string): ComponentDocument | null {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    throw new Error(`fixture markup did not parse: ${parsed.error.code}`);
  }
  return buildDocument(parsed.ast);
}

/** Builds and asserts acceptance, so the tests below can read the document directly. */
function buildAccepted(markup: string): ComponentDocument {
  const document = build(markup);
  if (document === null) {
    throw new Error("expected the fixture markup to build a document");
  }
  return document;
}

/** The ids of every node, in the order the builder allocated them. */
function nodeIds(document: ComponentDocument): readonly string[] {
  return Object.keys(document.nodes);
}

/** A `tag@id` projection, so an id-stability assertion also proves identity. */
function tagsById(document: ComponentDocument): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [id, node] of Object.entries(document.nodes)) {
    result[id] = node.tag;
  }
  return result;
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
  "</Screen>",
  "</Facet>",
].join("\n");

describe("ComponentNode — the stored value union", () => {
  it("is the same set as the parser's authored value, without naming it", () => {
    expect(RESTATEMENT_IS_FAITHFUL).toBe(true);
  });
});

describe("buildDocument — deterministic id allocation", () => {
  it("allocates ids in document pre-order, starting at n1", () => {
    const document = buildAccepted(EXAMPLE_MARKUP);

    expect(nodeIds(document)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7"]);
    expect(tagsById(document)).toEqual({
      n1: "Screen",
      n2: "Stack",
      n3: "Text",
      n4: "Metric",
      n5: "Button",
      n6: "Screen",
      n7: "Table",
    });
  });

  it("records the entry screen and the authored screen order", () => {
    const document = buildAccepted(EXAMPLE_MARKUP);

    expect(document.entry).toBe("home");
    expect(document.screens).toEqual(["n1", "n6"]);
  });

  it("keeps the parsed prop values, including references, and drops no prop", () => {
    const document = buildAccepted(EXAMPLE_MARKUP);

    expect(document.nodes["n4"]?.props).toEqual({
      label: { kind: "scalar", value: "Total" },
      value: { kind: "reference", scheme: "data", target: "sales.total" },
    });
    expect(document.nodes["n5"]?.props["action"]).toEqual({
      kind: "reference",
      scheme: "nav",
      target: "details",
    });
  });

  it("records children as ids, in authored order", () => {
    const document = buildAccepted(EXAMPLE_MARKUP);

    expect(document.nodes["n2"]?.children).toEqual(["n3", "n4", "n5"]);
    expect(document.nodes["n3"]?.children).toEqual([]);
  });

  it("is deterministic: the same markup builds the same document twice", () => {
    expect(buildAccepted(EXAMPLE_MARKUP)).toEqual(buildAccepted(EXAMPLE_MARKUP));
  });

  it("honours ids already carried by the markup", () => {
    const document = buildAccepted(
      [
        '<Facet entry="home">',
        '<Screen name="home" id="n4">',
        '<Text value="hello" id="n9" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(nodeIds(document)).toEqual(["n4", "n9"]);
  });

  it("allocates fresh ids above the highest id the markup already carries", () => {
    const document = buildAccepted(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        '<Text value="first" id="n12" />',
        '<Text value="second" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(nodeIds(document)).toEqual(["n13", "n12", "n14"]);
    expect(document.nodes["n14"]?.props["value"]).toEqual({ kind: "scalar", value: "second" });
  });

  it("never stores the reserved id as a prop", () => {
    const document = buildAccepted(
      [
        '<Facet entry="home">',
        '<Screen name="home" id="n1">',
        '<Text value="hello" id="n2" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(document.nodes["n2"]?.props).toEqual({ value: { kind: "scalar", value: "hello" } });
  });
});

describe("buildDocument — id stability across a sequence of accepted mutations", () => {
  /**
   * A mutation lane edits the document through its own read-back markup, so the
   * ids of untouched nodes travel with the text. The table below is that lane in
   * miniature: serialize, splice, rebuild — three times.
   */
  it("keeps the ids of unchanged nodes across insert, update and remove", () => {
    const first = buildAccepted(EXAMPLE_MARKUP);
    const originalTags = tagsById(first);

    const inserted = serializeDocument(first).text.replace(
      "</Stack>",
      '<Badge label="new" /></Stack>',
    );
    const second = buildAccepted(inserted);
    for (const [id, tag] of Object.entries(originalTags)) {
      expect(second.nodes[id]?.tag).toBe(tag);
    }
    const addedIds = nodeIds(second).filter((id) => !(id in originalTags));
    expect(addedIds).toEqual(["n8"]);
    expect(second.nodes["n8"]?.tag).toBe("Badge");

    const updated = serializeDocument(second).text.replace("July revenue", "August revenue");
    const third = buildAccepted(updated);
    expect(nodeIds(third)).toEqual(nodeIds(second));
    expect(third.nodes["n3"]?.props["value"]).toEqual({
      kind: "scalar",
      value: "August revenue",
    });

    const removed = serializeDocument(third)
      .text.split("\n")
      .filter((line) => !line.includes('id="n5"'))
      .join("\n");
    const fourth = buildAccepted(removed);
    expect(nodeIds(fourth)).toEqual(nodeIds(third).filter((id) => id !== "n5"));
    expect(fourth.nodes["n2"]?.children).toEqual(["n3", "n4", "n8"]);
    expect(tagsById(fourth)["n7"]).toBe("Table");
  });
});

describe("buildDocument — rejections", () => {
  const rejected: readonly (readonly [string, string])[] = [
    ["no envelope", '<Screen name="home"><Text value="x" /></Screen>'],
    [
      "two roots",
      '<Facet entry="a"><Screen name="a" /></Facet><Facet entry="b"><Screen name="b" /></Facet>',
    ],
    ["envelope without entry", '<Facet><Screen name="home" /></Facet>'],
    [
      "envelope with an extra prop",
      '<Facet entry="home" theme="dark"><Screen name="home" /></Facet>',
    ],
    ["entry naming no declared screen", '<Facet entry="missing"><Screen name="home" /></Facet>'],
    ["entry that is not an identifier", '<Facet entry="home page"><Screen name="home" /></Facet>'],
    ["no screens", '<Facet entry="home" />'],
    ["a non-Screen child", '<Facet entry="home"><Stack gap="md" /></Facet>'],
    ["a screen without a name", '<Facet entry="home"><Screen /></Facet>'],
    [
      "a screen named by a reference",
      '<Facet entry="home"><Screen name="data:screens.home" /></Facet>',
    ],
    [
      "duplicate screen names",
      '<Facet entry="home"><Screen name="home" /><Screen name="home" /></Facet>',
    ],
    [
      "duplicate ids",
      '<Facet entry="home"><Screen name="home" id="n1"><Text value="x" id="n1" /></Screen></Facet>',
    ],
    ["a malformed id", '<Facet entry="home"><Screen name="home" id="node1" /></Facet>'],
    ["a zero id", '<Facet entry="home"><Screen name="home" id="n0" /></Facet>'],
    [
      "an id given by reference",
      '<Facet entry="home"><Screen name="home" id="data:a.b" /></Facet>',
    ],
  ];

  for (const [label, markup] of rejected) {
    it(`rejects ${label}`, () => {
      expect(build(markup)).toBeNull();
    });
  }

  /**
   * `B-07` is unreachable through `parseMarkup`, which stops at `B-02` (500
   * nodes per call) first, so the budget is asserted on a hand-built ast — the
   * shape a corrupt or synthesised caller could actually present.
   */
  it("rejects an ast past the B-07 node budget", () => {
    const leaf = (index: number): unknown => ({
      tag: "Text",
      props: [{ name: "value", value: { kind: "scalar", value: `row ${index}` } }],
      children: [],
    });
    const screenOf = (count: number): unknown => ({
      tag: "Screen",
      props: [{ name: "name", value: { kind: "scalar", value: "home" } }],
      children: Array.from({ length: count }, (_unused, index) => leaf(index)),
    });
    const envelopeOf = (count: number): MarkupAst =>
      ({
        roots: [
          {
            tag: "Facet",
            props: [{ name: "entry", value: { kind: "scalar", value: "home" } }],
            children: [screenOf(count)],
          },
        ],
        nodeCount: count + 2,
      }) as unknown as MarkupAst;

    expect(buildDocument(envelopeOf(BOUNDS.nodesPerDocument - 1))).not.toBeNull();
    expect(buildDocument(envelopeOf(BOUNDS.nodesPerDocument))).toBeNull();
  });
});

describe("buildDocument — totality", () => {
  const junk: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["a string", '<Facet entry="home" />'],
    ["an empty object", {}],
    ["an ast with no roots array", { roots: "nope", nodeCount: 1 }],
    ["an ast whose root is null", { roots: [null], nodeCount: 1 }],
    [
      "an ast whose root has no props array",
      { roots: [{ tag: "Facet", children: [] }], nodeCount: 1 },
    ],
  ];

  for (const [label, value] of junk) {
    it(`returns null rather than throwing for ${label}`, () => {
      expect(() => buildDocument(value as MarkupAst)).not.toThrow();
      expect(buildDocument(value as MarkupAst)).toBeNull();
    });
  }

  it("terminates on a self-referential ast instead of walking forever", () => {
    const child: Record<string, unknown> = { tag: "Stack", props: [], children: [] };
    child["children"] = [child];
    const screen = {
      tag: "Screen",
      props: [{ name: "name", value: { kind: "scalar", value: "home" } }],
      children: [child],
    };
    const envelope = {
      tag: "Facet",
      props: [{ name: "entry", value: { kind: "scalar", value: "home" } }],
      children: [screen],
    };

    const started = Date.now();
    const document = buildDocument({ roots: [envelope], nodeCount: 3 } as unknown as MarkupAst);

    expect(document).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
