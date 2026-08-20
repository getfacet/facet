import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type { FacetAssetRegistry } from "./asset-registry.js";
import { validateCatalog, type FacetCatalog } from "./catalog.js";
import { validateAuthorMarkup } from "./document-validation.js";
import type { ComponentDocument } from "./document.js";
import type { DataModel } from "./data-model.js";
import type { AuthorError, AuthorErrorCode } from "./markup-errors.js";
import { parseMarkup, type MarkupAst, type MarkupNode } from "./markup-parser.js";

/**
 * The parser's prop value, derived from `MarkupNode` by indexed access. The
 * ast's value, prop and scheme aliases are internal to the grammar and are not
 * module-exported, so a fixture that synthesises a prop reaches the shape the
 * way every other consumer does — structurally, off the one public declaration.
 */
type MarkupValue = MarkupNode["props"][number]["value"];

/** Builds a fixture catalog, failing loudly if the fixture itself is bad. */
function catalogOf(components: readonly unknown[]): FacetCatalog {
  const result = validateCatalog({ components });
  if (!result.ok) {
    throw new Error(`fixture catalog was rejected: ${result.code} at ${result.at}`);
  }
  return result.catalog;
}

/**
 * Prop names for the `B-04` pair: one more than the bound, so the accepted
 * element sits exactly at the limit and the rejected one differs from it only by
 * carrying one further prop the component genuinely declares. `B-10` admits a
 * spec this wide, so the bound under test is the element's, not the spec's.
 */
const WIDE_PROP_NAMES: readonly string[] = Array.from(
  { length: BOUNDS.propsPerElement + 1 },
  (_unused, index) => `p${index + 1}`,
);

function widePropContract(): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const name of WIDE_PROP_NAMES) {
    props[name] = { type: "string", guidance: "One of many declared props." };
  }
  return props;
}

/**
 * The `name` schema every registered `Screen` carries, written exactly as the
 * catalog's refinement demands it: a required scalar string, and **no** other
 * keyword at all. `default`, `enum` and `bindable` must be *absent* rather than
 * present-and-false — a screen name is what the document is keyed by, so it can
 * be neither defaulted, nor restricted to a fixed set, nor read out of data.
 */
const SCREEN_NAME_SCHEMA = {
  type: "string",
  required: true,
  guidance: "What this screen is called.",
};

/**
 * The screen root's registration. `Screen` holds two roles at once — a grammar
 * position the author may only write directly under the envelope, and a trusted
 * registered component the renderer mounts — so **every** valid catalog carries
 * exactly one, and `validateCatalog` rejects one that does not.
 *
 * The registration is **conforming**, not merely present: the catalog enforces a
 * refinement of the `Screen` spec, so a minimal stub would be rejected there
 * even though it is a legal `ComponentSpec`. `name` is therefore written last,
 * after any caller-supplied props, so no fixture can weaken the one schema the
 * refinement pins. Extra presentation props are ordinary and are free to vary.
 *
 * Each fixture below appends the whole spec **last**, so no other member's index
 * moves.
 */
function screenSpec(props: Record<string, unknown> = {}): unknown {
  return {
    tag: "Screen",
    whenToUse: "Declare one screen of the page.",
    props: { ...props, name: { ...SCREEN_NAME_SCHEMA } },
    content: { mode: "children" },
  };
}

/** The reserved snapshot attribute, written exactly as a serialized element carries it. */
const RESERVED_ID_ATTRIBUTE = 'id="n9"';

/** A document whose one element carries `count` author-declared props. */
function wideMarkup(count: number): string {
  const written = WIDE_PROP_NAMES.slice(0, count)
    .map((name) => `${name}="v"`)
    .join(" ");
  return `<Facet entry="home"><Screen name="home"><Wide ${written} /></Screen></Facet>`;
}

const TEST_CATALOG = catalogOf([
  {
    tag: "Stack",
    whenToUse: "Group related content in one flow column.",
    content: { mode: "children" },
    props: {
      gap: {
        type: "string",
        guidance: "Space between children.",
        enum: ["sm", "md", "lg"],
        default: "md",
      },
    },
  },
  {
    tag: "Text",
    whenToUse: "Show one run of copy.",
    content: { mode: "none" },
    props: {
      value: { type: "string", guidance: "The copy to show.", required: true, bindable: true },
      tone: { type: "string", guidance: "How prominent the copy is.", enum: ["muted", "strong"] },
    },
  },
  {
    tag: "Metric",
    whenToUse: "Show one labelled number.",
    content: { mode: "none" },
    props: {
      label: { type: "string", guidance: "What the number measures.", required: true },
      amount: {
        type: "number",
        guidance: "The measured value.",
        required: true,
        bindable: true,
        minimum: 0,
        maximum: 1_000,
      },
    },
  },
  {
    tag: "Toggle",
    whenToUse: "Show one on/off state.",
    content: { mode: "none" },
    props: { on: { type: "boolean", guidance: "Whether the state is on." } },
  },
  {
    tag: "Table",
    whenToUse: "Show published rows.",
    content: { mode: "none" },
    props: {
      rows: { type: "array", guidance: "The published rows.", required: true, bindable: true },
      config: { type: "object", guidance: "The published column settings.", bindable: true },
    },
  },
  {
    tag: "Image",
    whenToUse: "Show one host-pinned image asset.",
    content: { mode: "none" },
    props: {
      asset: {
        type: "string",
        guidance: "The host-pinned image asset key.",
        required: true,
        assetKind: "image",
      },
      alt: { type: "string", guidance: "Accessible image description.", required: true },
    },
  },
  {
    tag: "Button",
    whenToUse: "Offer one action.",
    content: { mode: "none" },
    props: {
      label: { type: "string", guidance: "What the action does.", required: true },
      action: { type: "string", guidance: "The nav or agent reference to run.", required: true },
      arg: { type: "string", guidance: "The one explicit argument this event sends." },
      collect: { type: "string", guidance: "The field names this event carries, space separated." },
    },
  },
  /**
   * A collectable registration, written the way `validateComponentSpec` demands
   * one: `collect` is closed, and the collection address is the exact lowercase
   * `name` prop — a required scalar string carrying no `default`, `enum` or
   * `bindable` key. A `Button`'s `collect` list addresses these by that name.
   */
  {
    tag: "Field",
    whenToUse: "Ask the visitor for one value a control can name in its collect list.",
    content: { mode: "none" },
    props: {
      name: {
        type: "string",
        guidance: "The name a collect list addresses this by.",
        required: true,
      },
      label: { type: "string", guidance: "What the visitor is being asked for.", required: true },
      value: { type: "string", guidance: "The value shown.", default: "" },
      secret: { type: "boolean", guidance: "Whether the value is withheld.", default: false },
    },
    collect: {
      collectable: true,
      valueProp: "value",
      valueKind: "string",
      sensitiveProp: "secret",
    },
  },
  {
    tag: "Wide",
    whenToUse: "Declare more props than one element is allowed to carry.",
    content: { mode: "none" },
    props: widePropContract(),
  },
  {
    tag: "Split",
    whenToUse: "Arrange one primary and one secondary region.",
    content: {
      mode: "slots",
      slots: {
        primary: { guidance: "The primary region.", minChildren: 1, maxChildren: 1 },
        secondary: {
          guidance: "The secondary region.",
          minChildren: 1,
          maxChildren: 1,
          allowedTags: ["Card"],
        },
      },
    },
    props: {},
  },
  {
    tag: "Card",
    whenToUse: "Group related content in a bounded surface.",
    content: { mode: "children" },
    props: {},
  },
  screenSpec(),
]);

/**
 * A catalog whose one component declares the exact reserved name alongside a
 * spread of names that merely *resemble* it. Every one of them is a legal spec
 * identifier, so only this layer decides which of them an author may write —
 * and after the owner's decision the answer is "all but the exact `id`".
 */
const NEIGHBOUR_CATALOG = catalogOf([
  {
    tag: "Panel",
    whenToUse: "A component declaring the reserved name and its near neighbours.",
    content: { mode: "none" },
    props: {
      id: { type: "string", guidance: "A spec trying to claim Facet's node identity." },
      Id: { type: "string", guidance: "An ordinary prop that differs only in case." },
      ID: { type: "string", guidance: "An ordinary prop that differs only in case." },
      identifier: { type: "string", guidance: "An ordinary prop the reserved name prefixes." },
      FacetX: { type: "string", guidance: "An ordinary prop beginning with the framework name." },
      facetPreparing: { type: "string", guidance: "An ordinary prop, however it is spelled." },
      facetCorruptSubtree: { type: "string", guidance: "An ordinary prop, however it is spelled." },
    },
  },
  screenSpec(),
]);

/**
 * A catalog that also registers the envelope tag. `validateCatalog` refuses that
 * registration outright, so this one is synthesised — which is the point of the
 * test it serves: `Facet` is a grammar position, not something a registration
 * can re-open, so the answer must not depend on the catalog at all.
 *
 * It carries the whole ordinary catalog as well — `Screen` registration
 * included, since that one is now required rather than forbidden — so every
 * *other* tag in the fixtures still resolves. Without that, an enclosing
 * `<Stack>` would be the first fault in document order and the misplaced tag
 * inside it would never be reached: the test would pass on the wrong reason.
 */
const STRUCTURAL_CATALOG = {
  components: [
    ...TEST_CATALOG.components,
    {
      tag: "Facet",
      whenToUse: "A registration claiming the envelope position.",
      content: { mode: "children" },
      props: { entry: { type: "string", guidance: "The entry screen." } },
    },
  ],
} as unknown as FacetCatalog;

/**
 * A catalog with **no** `Screen` registration at all. `validateCatalog` refuses
 * this too, so it is synthesised: it exists to prove that the misplaced-position
 * refusal is decided before the catalog is read, in the one case where a lookup
 * would give a different answer.
 */
const SCREENLESS_CATALOG = {
  components: TEST_CATALOG.components.filter((spec) => spec.tag !== "Screen"),
} as unknown as FacetCatalog;

const DATA: DataModel = Object.freeze({
  sales: {
    total: 42,
    label: "July revenue",
    rows: [{ region: "north", amount: 12 }],
    config: { dense: true },
    gap: "md",
  },
});

const ACCEPTED_MARKUP = [
  '<Facet entry="home">',
  '<Screen name="home">',
  '<Stack gap="md">',
  '<Text value="July revenue" />',
  '<Text value="data:sales.label" tone="muted" />',
  '<Metric label="Total" amount="data:sales.total" />',
  '<Metric label="Target" amount="900" />',
  '<Toggle on="true" />',
  '<Button label="Details" action="nav:details" />',
  '<Button label="Refresh" action="agent:refresh" />',
  "</Stack>",
  "</Screen>",
  '<Screen name="details">',
  '<Table rows="data:sales.rows" config="data:sales.config" />',
  "</Screen>",
  "</Facet>",
].join("\n");

/**
 * The failure of one authored call, and which layer refused it.
 *
 * `phase` is recorded by the *harness*, from which call returned the failure —
 * never read off the error, which is the whole point: after the unification
 * there is one `AuthorError` and it does not say which layer raised it.
 */
interface Failure {
  readonly phase: "parse" | "validate";
  readonly error: AuthorError;
}

type Outcome =
  | { readonly ok: true; readonly document: ComponentDocument }
  | { readonly ok: false; readonly failure: Failure };

/** The author path end to end: parse the source, then validate it as data. */
function author(
  source: string,
  catalog: FacetCatalog = TEST_CATALOG,
  data: DataModel = DATA,
  assets: FacetAssetRegistry = Object.freeze({}),
): Outcome {
  const parsed = parseMarkup(source);
  if (!parsed.ok) {
    return { ok: false, failure: { phase: "parse", error: parsed.error } };
  }
  return validateAst(parsed.ast, catalog, data, assets);
}

/** The same path from an already-parsed ast, for faults no source can express. */
function validateAst(
  ast: MarkupAst,
  catalog: FacetCatalog = TEST_CATALOG,
  data: DataModel = DATA,
  assets: FacetAssetRegistry = Object.freeze({}),
): Outcome {
  const result = validateAuthorMarkup(ast, catalog, data, assets);
  if (result.ok) {
    return { ok: true, document: result.document };
  }
  return { ok: false, failure: { phase: "validate", error: result.error } };
}

/** The failure of a call that must have failed, or a loud test failure. */
function failureOf(outcome: Outcome): Failure {
  if (outcome.ok) {
    throw new Error("expected the call to be rejected, but it was accepted");
  }
  return outcome.failure;
}

/** The stored stage: one document under one revision. */
interface Stage {
  readonly revision: number;
  readonly document: ComponentDocument;
}

/**
 * The fold a rejection has to leave alone. An accepted call produces a new stage
 * at the next revision; a rejected one returns the **same object**, so "prior
 * revision unchanged" is an identity assertion rather than a comparison of two
 * values that happen to look alike.
 */
function applyAuthored(stage: Stage, outcome: Outcome): Stage {
  if (!outcome.ok) {
    return stage;
  }
  return { revision: stage.revision + 1, document: outcome.document };
}

function initialStage(): Stage {
  const outcome = author(ACCEPTED_MARKUP);
  if (!outcome.ok) {
    throw new Error(`fixture markup was rejected: ${outcome.failure.error.code}`);
  }
  return { revision: 1, document: outcome.document };
}

/**
 * The one error key set. Both layers report through it, so the harness compares
 * every failure against this single list rather than a per-phase one.
 */
const AUTHOR_ERROR_KEYS: readonly string[] = ["cause", "code", "location", "repair"];

/**
 * A rejection carries exactly **one** structured error: one object with the
 * declared key set, and no aggregated list anywhere inside it.
 */
function expectSingleStructuredError(failure: Failure): void {
  const error = failure.error as unknown as Record<string, unknown>;
  expect(
    Object.keys(error)
      .filter((key) => key !== "repairContext")
      .sort(),
  ).toEqual(AUTHOR_ERROR_KEYS);
  for (const value of AUTHOR_ERROR_KEYS.map((key) => error[key])) {
    expect(Array.isArray(value)).toBe(false);
  }
  if (error["repairContext"] !== undefined) {
    expect(error["repairContext"]).toEqual(expect.objectContaining({ kind: expect.any(String) }));
  }
  expect(error["document"]).toBeUndefined();
}

/**
 * The atomic-reject assertion used by every row of the adversarial table: one
 * structured error of the expected code, and a prior stage that is unchanged by
 * identity, by revision, and byte for byte.
 */
function expectAtomicReject(
  source: string,
  code: AuthorErrorCode,
  catalog: FacetCatalog = TEST_CATALOG,
  data: DataModel = DATA,
): void {
  const stage = initialStage();
  const before = JSON.stringify(stage);

  const outcome = author(source, catalog, data);
  const next = applyAuthored(stage, outcome);

  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    return;
  }
  expect(outcome.failure.error.code).toBe(code);
  expectSingleStructuredError(outcome.failure);
  expect(next).toBe(stage);
  expect(next.revision).toBe(1);
  expect(JSON.stringify(next)).toBe(before);
}

describe("validateAuthorMarkup — the accepted document", () => {
  it("accepts a well-formed document against the active catalog", () => {
    const outcome = author(ACCEPTED_MARKUP);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.document.entry : null).toBe("home");
    expect(outcome.ok ? outcome.document.screens.length : 0).toBe(2);
  });

  it("advances the stage when a call is accepted, so the reject assertions are not vacuous", () => {
    const stage = initialStage();

    const next = applyAuthored(
      stage,
      author('<Facet entry="only"><Screen name="only"><Text value="new" /></Screen></Facet>'),
    );

    expect(next).not.toBe(stage);
    expect(next.revision).toBe(2);
    expect(next.document.entry).toBe("only");
  });

  it("accepts every declared scalar form and both reference schemes", () => {
    const outcome = author(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        '<Toggle on="false" />',
        '<Metric label="Zero" amount="0" />',
        '<Metric label="Fraction" amount="12.5" />',
        '<Text value="x" tone="strong" />',
        '<Button label="Go" action="nav:home" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(outcome.ok).toBe(true);
  });

  it("rejects a syntactically valid number that overflows before range checks", () => {
    const overflow = `1${"0".repeat(400)}`;
    const numericCatalog = catalogOf([
      {
        tag: "Reading",
        whenToUse: "Show one unbounded numeric reading.",
        content: { mode: "none" },
        props: {
          amount: { type: "number", guidance: "The reading.", required: true },
        },
      },
      screenSpec(),
    ]);
    const source = [
      '<Facet entry="home">',
      '<Screen name="home">',
      `<Reading amount="${overflow}" />`,
      "</Screen>",
      "</Facet>",
    ].join("");

    const failure = failureOf(author(source, numericCatalog));

    expect(failure.error.code).toBe("invalid-value");
    expect(failure.error.repair).toContain('amount="42"');
  });

  it("rejects a syntactically valid number that would lose integer precision", () => {
    const numericCatalog = catalogOf([
      {
        tag: "Reading",
        whenToUse: "Show one unbounded numeric reading.",
        content: { mode: "none" },
        props: {
          amount: { type: "number", guidance: "The reading.", required: true },
        },
      },
      screenSpec(),
    ]);
    const source = [
      '<Facet entry="home">',
      '<Screen name="home">',
      '<Reading amount="9007199254740993" />',
      "</Screen>",
      "</Facet>",
    ].join("");

    const failure = failureOf(author(source, numericCatalog));

    expect(failure.error.code).toBe("invalid-value");
    expect(failure.error.cause).not.toContain("9007199254740992");
  });

  it("accepts an omitted optional prop and a component that declares no children", () => {
    expect(author('<Facet entry="home"><Screen name="home"><Stack /></Screen></Facet>').ok).toBe(
      true,
    );
  });
});

describe("validateAuthorMarkup — structured slots", () => {
  it("accepts one child in each declared slot", () => {
    expect(
      author(
        '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Card slot="secondary" /></Split></Screen></Facet>',
      ).ok,
    ).toBe(true);
  });

  it.each([
    [
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /></Split></Screen></Facet>',
      "missing-slot-children",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Split><Card /><Card slot="secondary" /></Split></Screen></Facet>',
      "missing-child-slot",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Card slot="aside" /></Split></Screen></Facet>',
      "unknown-slot",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Card slot="toString" /></Split></Screen></Facet>',
      "unknown-slot",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Text slot="secondary" value="x" /></Split></Screen></Facet>',
      "slot-tag-not-allowed",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Split><Card slot="primary" /><Card slot="primary" /><Card slot="secondary" /></Split></Screen></Facet>',
      "too-many-slot-children",
    ],
    [
      '<Facet entry="home"><Screen name="home"><Stack><Card slot="primary" /></Stack></Screen></Facet>',
      "slot-not-accepted",
    ],
  ])("rejects an invalid structured assignment with %s", (markup, code) => {
    expect(failureOf(author(markup)).error.code).toBe(code);
  });

  it("identifies the structured parent and allowed slots without echoing rejected markup", () => {
    const failure = failureOf(
      author(
        '<Facet entry="home"><Screen name="home"><Split><Card /><Card slot="secondary" /></Split></Screen></Facet>',
      ),
    );

    expect(failure.error.repairContext).toEqual({
      kind: "child_slot",
      parentTag: "Split",
      allowedSlots: ["primary", "secondary"],
    });
  });
});

describe("validateAuthorMarkup — the adversarial rejection table", () => {
  const rejected: readonly (readonly [string, string, AuthorErrorCode])[] = [
    [
      "an unregistered tag",
      '<Facet entry="home"><Screen name="home"><Widget /></Screen></Facet>',
      "unknown-tag",
    ],
    [
      "a screen root nested inside a component",
      '<Facet entry="home"><Screen name="home"><Stack><Screen name="inner" /></Stack></Screen></Facet>',
      "misplaced-structural-tag",
    ],
    [
      "a nested envelope",
      '<Facet entry="home"><Screen name="home"><Facet entry="home" /></Screen></Facet>',
      "misplaced-structural-tag",
    ],
    [
      "a prop the component does not declare",
      '<Facet entry="home"><Screen name="home"><Text value="x" colour="red" /></Screen></Facet>',
      "undeclared-prop",
    ],
    [
      "an attribute the registered Screen spec does not declare",
      '<Facet entry="home"><Screen name="home" title="Home" /></Facet>',
      "undeclared-prop",
    ],
    [
      "a value outside the declared enum domain",
      '<Facet entry="home"><Screen name="home"><Text value="x" tone="neon" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a number above the declared maximum",
      '<Facet entry="home"><Screen name="home"><Metric label="a" amount="5000" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a number below the declared minimum",
      '<Facet entry="home"><Screen name="home"><Metric label="a" amount="-1" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a word where a number is declared",
      '<Facet entry="home"><Screen name="home"><Metric label="a" amount="lots" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a word where a boolean is declared",
      '<Facet entry="home"><Screen name="home"><Toggle on="yes" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a required prop that is missing",
      '<Facet entry="home"><Screen name="home"><Text tone="muted" /></Screen></Facet>',
      "missing-required-prop",
    ],
    [
      "children under a component that declares none",
      '<Facet entry="home"><Screen name="home"><Text value="x"><Text value="y" /></Text></Screen></Facet>',
      "children-not-accepted",
    ],
    [
      "an author-written id",
      '<Facet entry="home"><Screen name="home"><Text value="x" id="n9" /></Screen></Facet>',
      "reserved-attribute",
    ],
    [
      "an author-written id on a screen root",
      '<Facet entry="home"><Screen name="home" id="n9" /></Facet>',
      "reserved-attribute",
    ],
    [
      "a local action, which has no place in the vocabulary",
      '<Facet entry="home"><Screen name="home"><Button label="Go" action="local:toggle" /></Screen></Facet>', // component-hard-cut: allowed-negative
      "unknown-scheme",
    ],
    [
      "a nav to a screen this document does not declare",
      '<Facet entry="home"><Screen name="home"><Button label="Go" action="nav:missing" /></Screen></Facet>',
      "unknown-screen",
    ],
    [
      "a visitor event that is not an identifier",
      '<Facet entry="home"><Screen name="home"><Button label="Go" action="agent:refresh now" /></Screen></Facet>',
      "invalid-action",
    ],
    [
      "a binding on a prop the spec does not declare bindable",
      '<Facet entry="home"><Screen name="home"><Stack gap="data:sales.gap" /></Screen></Facet>',
      "binding-not-allowed",
    ],
    [
      "a binding whose path selects nothing",
      '<Facet entry="home"><Screen name="home"><Text value="data:sales.missing" /></Screen></Facet>',
      "unresolved-binding",
    ],
    [
      "a binding whose value contradicts the declared type",
      '<Facet entry="home"><Screen name="home"><Metric label="a" amount="data:sales.label" /></Screen></Facet>',
      "unresolved-binding",
    ],
    [
      "a binding path that is not a legal data path",
      '<Facet entry="home"><Screen name="home"><Text value="data:sales..label" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "an action reference where structured data is declared",
      '<Facet entry="home"><Screen name="home"><Table rows="nav:home" /></Screen></Facet>',
      "invalid-value",
    ],
    [
      "a scalar where structured data is declared",
      '<Facet entry="home"><Screen name="home"><Table rows="north" /></Screen></Facet>',
      "invalid-value",
    ],
  ];

  for (const [label, source, code] of rejected) {
    it(`rejects ${label} atomically`, () => {
      expectAtomicReject(source, code);
    });
  }

  it("reports the same rejection twice for the same input", () => {
    const source = '<Facet entry="home"><Screen name="home"><Widget /></Screen></Facet>';

    expect(author(source)).toEqual(author(source));
  });

  it("rejects the first fault in document order when several are present", () => {
    const outcome = author(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        '<Text value="x" colour="red" />',
        "<Widget />",
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.error.code).toBe("undeclared-prop");
  });
});

describe("validateAuthorMarkup — safe repair coordinates", () => {
  it("identifies an enum prop and its catalog-declared values", () => {
    const failure = failureOf(
      author(
        '<Facet entry="home"><Screen name="home"><Text value="x" tone="neon" /></Screen></Facet>',
      ),
    );

    expect(failure.error.repairContext).toEqual({
      kind: "prop_value",
      componentTag: "Text",
      propName: "tone",
      allowedValues: ["muted", "strong"],
    });
  });
});

/**
 * One vocabulary, one shape. The grammar layer and this layer both report an
 * `AuthorError`, so a consumer presenting a failure — the agent tool surface
 * above all — has one thing to read and no way to tell which layer produced it
 * other than by which call it made.
 */
describe("validateAuthorMarkup — one failure shape across both layers", () => {
  const GRAMMAR_FAULT = '<Facet entry="home"><Screen name="home"><Text value=x /></Screen></Facet>';
  const SEMANTIC_FAULT = '<Facet entry="home"><Screen name="home"><Widget /></Screen></Facet>';

  it("reports a parse failure and a semantic failure in structurally identical shapes", () => {
    const parseFailure = failureOf(author(GRAMMAR_FAULT));
    const semanticFailure = failureOf(author(SEMANTIC_FAULT));

    expect(parseFailure.phase).toBe("parse");
    expect(semanticFailure.phase).toBe("validate");
    expectSingleStructuredError(parseFailure);
    expectSingleStructuredError(semanticFailure);

    const shapeOf = (failure: Failure): Record<string, string> => ({
      code: typeof failure.error.code,
      location: typeof failure.error.location,
      cause: typeof failure.error.cause,
      repair: typeof failure.error.repair,
      offset: typeof failure.error.location.offset,
      line: typeof failure.error.location.line,
      column: typeof failure.error.location.column,
    });

    expect(shapeOf(parseFailure)).toEqual(shapeOf(semanticFailure));
  });

  it("draws both layers' codes from the one closed vocabulary", () => {
    const codes: readonly AuthorErrorCode[] = [
      failureOf(author(GRAMMAR_FAULT)).error.code,
      failureOf(author(SEMANTIC_FAULT)).error.code,
    ];

    expect(codes).toEqual(["unquoted-value", "unknown-tag"]);
  });

  it("names the same first fault, at the same offset, however many follow it", () => {
    const lines = [
      '<Facet entry="home">',
      '<Screen name="home">',
      '<Text value="x" colour="red" />',
      "<Widget />",
      "</Screen>",
      "</Facet>",
    ];
    const both = failureOf(author(lines.join("\n")));
    const onlyFirst = failureOf(author([...lines.slice(0, 3), ...lines.slice(4)].join("\n")));

    expect(both.error.code).toBe("undeclared-prop");
    expect(onlyFirst.error.code).toBe("undeclared-prop");
    expect(both.error.location).toEqual(onlyFirst.error.location);
    expect(both.error).toEqual(failureOf(author(lines.join("\n"))).error);
  });
});

/**
 * `Facet` and `Screen` are grammar positions, not tags a document may use
 * anywhere. One `Facet` is the root and `Screen` declares its screens; either
 * one anywhere else is misplaced, and says so, rather than being reported as an
 * unregistered component — which would send the agent looking for a
 * registration that must never exist.
 */
describe("validateAuthorMarkup — the structural tags keep their positions", () => {
  const misplaced: readonly (readonly [string, string])[] = [
    [
      "a screen nested one level inside a component",
      '<Facet entry="home"><Screen name="home"><Stack><Screen name="inner" /></Stack></Screen></Facet>',
    ],
    [
      "a screen nested directly under a screen",
      '<Facet entry="home"><Screen name="home"><Screen name="inner" /></Screen></Facet>',
    ],
    [
      "an envelope nested inside a screen",
      '<Facet entry="home"><Screen name="home"><Facet entry="home" /></Screen></Facet>',
    ],
    [
      "an envelope nested deep inside a component",
      '<Facet entry="home"><Screen name="home"><Stack><Facet entry="home" /></Stack></Screen></Facet>',
    ],
  ];

  for (const [label, source] of misplaced) {
    it(`rejects ${label} as misplaced, not as unknown`, () => {
      expectAtomicReject(source, "misplaced-structural-tag");
    });

    it(`rejects ${label} even when the catalog registers that tag`, () => {
      expectAtomicReject(source, "misplaced-structural-tag", STRUCTURAL_CATALOG);
    });
  }

  /**
   * The ordering, proven in the one case where the two possible answers differ.
   * The active catalog registers `Screen` — it must, or it is not a valid
   * catalog — and the nested element satisfies that registration exactly: the
   * tag resolves, `name` is declared and required and present, and `Screen`
   * accepts children. A lookup-first implementation would therefore *accept*
   * it. It is refused on where it sits instead, which is what keeps a required
   * registration from being a way back into the nesting hole.
   */
  it("rejects a nested Screen that fully satisfies the registered Screen spec", () => {
    expect(TEST_CATALOG.components.some((spec) => spec.tag === "Screen")).toBe(true);
    expect(author('<Facet entry="home"><Screen name="home" /></Facet>').ok).toBe(true);

    expectAtomicReject(
      '<Facet entry="home"><Screen name="home"><Stack><Screen name="inner" /></Stack></Screen></Facet>',
      "misplaced-structural-tag",
    );
  });

  /**
   * The other direction — a catalog with nothing to find — is deliberately not
   * asserted here. A screen root is visited before its children, so with no
   * `Screen` registered the *enclosing* root is the first fault in document
   * order and the nested one is never reached: the test would pass on the wrong
   * reason. What that catalog does prove lives with the spec checks below.
   */

  it("still accepts the structural tags in the positions the grammar gives them", () => {
    expect(
      author(
        '<Facet entry="home"><Screen name="home"><Stack /></Screen><Screen name="b" /></Facet>',
      ).ok,
    ).toBe(true);
  });

  /** The same refusal from a synthesised ast, so it cannot rest on the parser. */
  it("rejects a misplaced screen carried by a synthesised ast", () => {
    const outcome = validateAst(
      astOf(screenNode("home", [elementNode("Screen", [propOf("name", scalar("inner"))])])),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.error.code).toBe("misplaced-structural-tag");
  });
});

/**
 * `Screen`'s second role. A screen root in its grammar position is a mounted
 * component like any other, so it is checked against the **registered** spec:
 * what the catalog declares is what an author may write on it. The fixtures
 * below vary that registration and watch the answer move with it, which is what
 * separates "validated against the spec" from a hand-written closed form that
 * happens to accept `name`.
 */
describe("validateAuthorMarkup — a screen root is checked against its registered spec", () => {
  const PRESENTATION_CATALOG = catalogOf([
    ...(TEST_CATALOG.components.filter((spec) => spec.tag !== "Screen") as readonly unknown[]),
    screenSpec({
      tone: { type: "string", guidance: "How the screen is presented.", enum: ["plain", "bold"] },
    }),
  ]);

  const TITLED_CATALOG = catalogOf([
    ...(TEST_CATALOG.components.filter((spec) => spec.tag !== "Screen") as readonly unknown[]),
    screenSpec({ title: { type: "string", guidance: "The screen heading.", required: true } }),
  ]);

  /**
   * The fixtures' own conformance, pinned here rather than assumed. The catalog
   * enforces a refinement of the `Screen` spec — presence alone is not enough —
   * so a fixture that drifted from it would make every assertion in this file
   * rest on a registration no real session could hold. Asserting the *absence*
   * of `default`, `enum` and `bindable` is the point: present-and-false is not
   * the same as omitted, and only omission conforms.
   */
  it("registers a conforming Screen in every catalog these tests validate against", () => {
    const catalogs: readonly (readonly [string, FacetCatalog])[] = [
      ["TEST_CATALOG", TEST_CATALOG],
      ["NEIGHBOUR_CATALOG", NEIGHBOUR_CATALOG],
      ["PRESENTATION_CATALOG", PRESENTATION_CATALOG],
      ["TITLED_CATALOG", TITLED_CATALOG],
    ];

    for (const [label, catalog] of catalogs) {
      const screens = catalog.components.filter((spec) => spec.tag === "Screen");
      expect(`${label}: ${screens.length}`).toBe(`${label}: 1`);

      const screen = screens[0];
      const name = screen?.props["name"] as unknown as Record<string, unknown> | undefined;
      // Spelled out as literals, never against `SCREEN_NAME_SCHEMA`: comparing
      // the fixture to the constant it is built from asserts nothing, and passes
      // just as happily when the constant itself drifts off the contract.
      expect(
        `${label}: ${Object.keys(name ?? {})
          .sort()
          .join(",")}`,
      ).toBe(`${label}: guidance,required,type`);
      expect(`${label}: ${name?.["type"]}`).toBe(`${label}: string`);
      expect(`${label}: ${name?.["required"]}`).toBe(`${label}: true`);
      expect(`${label}: ${screen?.content.mode}`).toBe(`${label}: children`);
      expect(`${label}: ${screen?.collect}`).toBe(`${label}: undefined`);
    }
  });

  it("accepts a screen prop the registered spec declares", () => {
    const source = '<Facet entry="home"><Screen name="home" tone="bold" /></Facet>';

    expect(author(source, PRESENTATION_CATALOG).ok).toBe(true);
  });

  /** The same markup, the same layer, one different registration. */
  it("rejects that very prop when the registered spec does not declare it", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home" tone="bold" /></Facet>',
      "undeclared-prop",
    );
  });

  it("rejects a screen prop value outside the domain the spec declares", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home" tone="neon" /></Facet>',
      "invalid-value",
      PRESENTATION_CATALOG,
    );
  });

  it("enforces a required screen prop the spec declares", () => {
    expect(
      author('<Facet entry="home"><Screen name="home" title="Home" /></Facet>', TITLED_CATALOG).ok,
    ).toBe(true);
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home" /></Facet>',
      "missing-required-prop",
      TITLED_CATALOG,
    );
  });

  /**
   * `name` is required by the registered spec too, but a screen without one
   * never reaches that check: the envelope form is read first, and a root that
   * carries no readable name is not a well-formed document at all. The
   * requirement is enforced — earlier, and under the code that says the document
   * itself is malformed rather than that one prop is missing.
   */
  it("refuses a screen root with no name, as a malformed document", () => {
    expectAtomicReject('<Facet entry="home"><Screen /></Facet>', "malformed-document");
  });

  /**
   * Out of contract, and still total. `validateCatalog` requires exactly one
   * `Screen`, so a catalog without one cannot be built through it — but a
   * caller that synthesises one gets a structured refusal naming the missing
   * registration, not a screen root waved through on its position alone.
   */
  it("reports a screen root as an unknown tag when no Screen is registered", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home"><Stack /></Screen></Facet>',
      "unknown-tag",
      SCREENLESS_CATALOG,
    );
  });

  it("still refuses the reserved id on a screen root, ahead of the spec lookup", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home" id="n9" /></Facet>',
      "reserved-attribute",
      PRESENTATION_CATALOG,
    );
  });
});

describe("validateAuthorMarkup — the one reserved attribute", () => {
  /**
   * `id` is Facet's node identity, so an author may read it back and never write
   * it. It is refused before the declared-prop lookup, which is why a catalog
   * that declares a prop of that exact name cannot hand the agent a way in.
   */
  it("rejects an author-written id, even when the catalog declares it", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home"><Panel id="n9" /></Screen></Facet>',
      "reserved-attribute",
      NEIGHBOUR_CATALOG,
    );
  });

  /**
   * The reservation is that one exact lowercase name and nothing around it.
   * A prop that differs in case, or that merely begins with `facet` or with
   * `id`, is an ordinary custom prop: the catalog declares it and the author
   * writes it, exactly as for any other. Nothing about the framework's own copy
   * depends on a name the author is barred from — the neutral copy has no author,
   * data, or component-prop input path at all.
   */
  const ordinary: readonly (readonly [string, string])[] = [
    ["a prop differing from the reserved name only in case", 'Id="a"'],
    ["a prop differing from the reserved name only in casing throughout", 'ID="b"'],
    ["a prop the reserved name is a prefix of", 'identifier="c"'],
    ["a prop beginning with the framework name in title case", 'FacetX="d"'],
    ["a prop beginning with the framework name in lower case", 'facetPreparing="e"'],
    ["a prop named for a framework copy string", 'facetCorruptSubtree="f"'],
  ];

  for (const [label, attribute] of ordinary) {
    it(`accepts ${label}`, () => {
      const outcome = author(
        `<Facet entry="home"><Screen name="home"><Panel ${attribute} /></Screen></Facet>`,
        NEIGHBOUR_CATALOG,
      );

      expect(outcome.ok).toBe(true);
    });
  }

  it("accepts every one of them together on one element", () => {
    const written = ordinary.map(([, attribute]) => attribute).join(" ");

    expect(
      author(
        `<Facet entry="home"><Screen name="home"><Panel ${written} /></Screen></Facet>`,
        NEIGHBOUR_CATALOG,
      ).ok,
    ).toBe(true);
  });

  it("accepts the component with none of them written", () => {
    expect(
      author(
        '<Facet entry="home"><Screen name="home"><Panel /></Screen></Facet>',
        NEIGHBOUR_CATALOG,
      ).ok,
    ).toBe(true);
  });

  /**
   * A prop that resembles the reserved name is still an *ordinary* prop, so a
   * component that never declared it is refused the ordinary way. The reserved
   * check has not quietly become a second, wider gate.
   */
  it("reports an undeclared neighbour as undeclared, not as reserved", () => {
    expectAtomicReject(
      '<Facet entry="home"><Screen name="home"><Text value="x" facetPreparing="e" /></Screen></Facet>',
      "undeclared-prop",
    );
  });
});

/**
 * Owner decision 1. A structured prop is filled by a binding and by nothing
 * else: the reference is admitted, and inline structure stays an atomic reject.
 */
describe("validateAuthorMarkup — structured props are binding-only", () => {
  it("accepts a data:path reference for a declared array or object prop", () => {
    const outcome = author(
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        '<Table rows="data:sales.rows" config="data:sales.config" />',
        "</Screen>",
        "</Facet>",
      ].join("\n"),
    );

    expect(outcome.ok).toBe(true);
  });

  const inline: readonly (readonly [string, string])[] = [
    ["an inline array", "<Table rows=\"[{'region': 'north'}]\" />"],
    ["an inline object", '<Table rows="data:sales.rows" config="{\'dense\': true}" />'],
    ["an empty inline array", '<Table rows="[]" />'],
  ];

  for (const [label, element] of inline) {
    it(`rejects ${label} authored in markup, atomically`, () => {
      expectAtomicReject(
        `<Facet entry="home"><Screen name="home">${element}</Screen></Facet>`,
        "inline-json",
      );
    });
  }

  /**
   * The same refusal one layer lower. A caller that hands validation an ast the
   * parser would never produce still cannot author structure inline.
   */
  it("rejects inline structure carried by a synthesised ast", () => {
    const stage = initialStage();
    const before = JSON.stringify(stage);

    const outcome = validateAst(
      astOf(
        screenNode("home", [
          elementNode("Table", [propOf("rows", scalar('[{"region":"north"}]'))]),
        ]),
      ),
    );
    const next = applyAuthored(stage, outcome);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.error.code).toBe("inline-structure");
    expect(next).toBe(stage);
    expect(JSON.stringify(next)).toBe(before);
  });
});

/**
 * The collection request list. A declared scalar string prop named `collect` is
 * the framework's list of the collectable fields an `agent:` event carries, and
 * this layer is where a list that cannot possibly be honoured is refused.
 *
 * The boundary matters more than any single row: `collect_source_unavailable` is
 * the **runtime** fail-safe, for a validly authored field that is not live or
 * registered yet and for corrupt persisted state. It is not the acceptance path
 * for an author-time unknown name. A name this document cannot supply is an
 * author error **now**, so the agent is told while it can still repair — not a
 * structured absence delivered to itself one event later.
 */
/**
 * One collectable field, with its attributes written out in full.
 *
 * The address is a **parameter with no default**, deliberately: the tests below
 * turn on what a field's address is — including the case where it has none — and
 * a helper that supplied one would answer the very question being asked.
 */
const fieldWith = (attributes: string): string => `<Field ${attributes} label="Your email" />`;

/** One collectable field per name, each declaring that name as its address. */
const fields = (names: readonly string[]): string =>
  names.map((name) => fieldWith(`name="${name}"`)).join("");

const screenOf = (name: string, body: string): string => `<Screen name="${name}">${body}</Screen>`;

/** The control carrying the list under test. */
const control = (list: string): string =>
  `<Button label="Send" action="agent:submit" collect="${list}" />`;

const documentOf = (home: string, rest = ""): string =>
  `<Facet entry="home">${screenOf("home", home)}${rest}</Facet>`;

/**
 * One more distinct name than `B-22` admits, so the accepted list sits exactly
 * at the limit and the rejected one differs from it only by naming one further
 * field the same screen genuinely declares.
 */
const COLLECTABLE_NAMES: readonly string[] = Array.from(
  { length: BOUNDS.collectFieldsPerEvent + 1 },
  (_unused, index) => `f${index + 1}`,
);

const AT_LIMIT: readonly string[] = COLLECTABLE_NAMES.slice(0, BOUNDS.collectFieldsPerEvent);

/**
 * One document per request-list cause: the token at fault, and a source that
 * reaches that branch and no other.
 *
 * Shared by the test that pins the six causes apart and by the address test that
 * must not collapse into any of them, so the two can never drift into asserting
 * distinctness against different sets.
 */
const REQUEST_LIST_FAULTS: readonly (readonly [string, string])[] = [
  ["a.b", documentOf(fields(["a"]) + control("a.b"))],
  [
    `${BOUNDS.collectFieldsPerEvent + 1}`,
    documentOf(fields(COLLECTABLE_NAMES) + control(COLLECTABLE_NAMES.join(" "))),
  ],
  ["ghost", documentOf(fields(["a"]) + control("ghost"))],
  ["elsewhere", documentOf(control("elsewhere"), screenOf("details", fields(["elsewhere"])))],
  ["dup", documentOf(fields(["dup", "dup"]) + control("dup"))],
  ["data:sales.label", documentOf(fields(["a"]) + control("data:sales.label"))],
];

/** The repair a rejected source offers. */
const repairOf = (source: string, catalog: FacetCatalog = TEST_CATALOG): string =>
  failureOf(author(source, catalog)).error.repair;

/**
 * The field under test on a screen that **does** collect — a second field, and a
 * control naming it. So the address rows are refused on a screen where the
 * request machinery is fully in play, and the one test that removes the request
 * entirely is left as the only one asserting the *unrequested* case.
 */
const alongsideARequest = (body: string): string =>
  documentOf(body + fields(["email"]) + control("email"));

/**
 * One document per authored-address cause. Module-scope for the same reason
 * `REQUEST_LIST_FAULTS` is: two tests pin distinctness across these sources, and
 * a second copy is how the two would drift into asserting it against different
 * sets.
 */
const ADDRESS_FAULTS: readonly string[] = [
  alongsideARequest(fieldWith('name="data:sales.label"')),
  alongsideARequest(fieldWith('name="a.b"')),
];

describe("validateAuthorMarkup — the collection request list", () => {
  describe("the lists it admits", () => {
    it("accepts a list naming one field declared on the same screen", () => {
      expect(author(documentOf(fields(["email"]) + control("email"))).ok).toBe(true);
    });

    it("accepts several names in an order the screen does not declare them in", () => {
      expect(
        author(documentOf(fields(["email", "note", "city"]) + control("city email note"))).ok,
      ).toBe(true);
    });

    /**
     * The pre-pass, proven. A control may name a field the screen declares
     * *after* it, so the answer cannot come from a set accumulated as the walk
     * goes: the whole screen is indexed before any list is read.
     */
    it("resolves a field the screen declares after the control", () => {
      expect(author(documentOf(control("later") + fields(["later"]))).ok).toBe(true);
    });

    it("accepts an empty list and a list of nothing but spaces", () => {
      expect(author(documentOf(fields(["email"]) + control(""))).ok).toBe(true);
      expect(author(documentOf(fields(["email"]) + control("   "))).ok).toBe(true);
    });

    it("accepts extra spacing between, before and after the names", () => {
      expect(author(documentOf(fields(["email", "note"]) + control("  email   note  "))).ok).toBe(
        true,
      );
    });

    /** A repeat names the same field twice; it is one entry, not a second one. */
    it("accepts a name written twice", () => {
      expect(author(documentOf(fields(["email"]) + control("email email"))).ok).toBe(true);
    });

    /**
     * Per screen, not per document. The same name on another screen is a
     * different field and must not shadow the one this control can actually
     * reach.
     */
    it("accepts a name this screen declares when another screen declares it too", () => {
      expect(
        author(
          documentOf(
            fields(["shared"]) + control("shared"),
            screenOf("details", fields(["shared"])),
          ),
        ).ok,
      ).toBe(true);
    });

    /** Ambiguity is a property of a *named* field, not of the screen at large. */
    it("accepts a duplicate the list does not name", () => {
      expect(author(documentOf(fields(["dup", "dup", "one"]) + control("one"))).ok).toBe(true);
    });

    it("accepts a control that carries no list at all", () => {
      expect(
        author(documentOf(fields(["email"]) + '<Button label="Send" action="agent:submit" />')).ok,
      ).toBe(true);
    });
  });

  describe("the lists it refuses", () => {
    /**
     * The repair for a name that simply does not exist, and the reference every
     * other cause is measured against.
     *
     * All six causes share the one code the closed vocabulary has for them, so
     * a row asserting only the code passes just as happily when its own branch
     * is gone and a *neighbouring* branch does the rejecting — a malformed name
     * that no longer fails the identifier grammar is, after all, also a name
     * nothing declares. Comparing the repair to this one pins which branch
     * answered, without pinning any wording: the assertion is inequality, and it
     * fails only if two causes have genuinely collapsed into one.
     */
    const unknownNameRepair = (): string => repairOf(documentOf(fields(["a"]) + control("ghost")));

    const invalid: readonly (readonly [string, string])[] = [
      ["a dotted path", "a.b"],
      ["a name beginning with a digit", "1st"],
      ["a prototype-shaped name", "__proto__"],
      ["a name carrying a second separator", "a:b"],
      ["a name past the B-06 identifier limit", "f".repeat(BOUNDS.identifierChars + 1)],
      ["names separated by a tab rather than a space", "email\tnote"],
    ];

    for (const [label, list] of invalid) {
      it(`rejects ${label} atomically, as a malformed name`, () => {
        const source = documentOf(fields(["email", "note", "a"]) + control(list));

        expectAtomicReject(source, "invalid-value");
        expect(repairOf(source)).not.toBe(unknownNameRepair());
      });
    }

    it("accepts a list of exactly B-22 distinct names and rejects one more", () => {
      const past = documentOf(fields(COLLECTABLE_NAMES) + control(COLLECTABLE_NAMES.join(" ")));

      expect(author(documentOf(fields(AT_LIMIT) + control(AT_LIMIT.join(" ")))).ok).toBe(true);
      expectAtomicReject(past, "invalid-value");
      // Every name in the rejected list is declared on that very screen, so the
      // count is the only thing wrong with it.
      expect(repairOf(past)).not.toBe(unknownNameRepair());
    });

    /** The bound is on **distinct** names, so a repeat does not consume one. */
    it("accepts B-22 distinct names written as one more token", () => {
      const repeated = [...AT_LIMIT, AT_LIMIT[0] ?? ""];

      expect(repeated.length).toBe(BOUNDS.collectFieldsPerEvent + 1);
      expect(author(documentOf(fields(AT_LIMIT) + control(repeated.join(" ")))).ok).toBe(true);
    });

    it("rejects a name no screen in the document declares", () => {
      expectAtomicReject(documentOf(fields(["email"]) + control("ghost")), "invalid-value");
    });

    it("rejects a name only another screen declares, as reachable but not from here", () => {
      const source = documentOf(control("elsewhere"), screenOf("details", fields(["elsewhere"])));

      expectAtomicReject(source, "invalid-value");
      expect(repairOf(source)).not.toBe(unknownNameRepair());
    });

    it("rejects a name two fields on this screen answer to, as ambiguous", () => {
      const source = documentOf(fields(["dup", "dup"]) + control("dup"));
      const otherScreen = repairOf(
        documentOf(control("elsewhere"), screenOf("details", fields(["elsewhere"]))),
      );

      expectAtomicReject(source, "invalid-value");
      expect(repairOf(source)).not.toBe(unknownNameRepair());
      expect(repairOf(source)).not.toBe(otherScreen);
    });

    /**
     * A request list is a scalar literal or it is nothing. Every reference is
     * refused, and by the same branch: `data:` because a bound list would arrive
     * from the Data Model with no author-time check possible at all, which would
     * leave the whole rule inert for exactly the input that needs it; `nav:` and
     * `agent:` because the grammar turns them into references before this layer
     * sees them, so a *resolvable* action — `nav:home` names a screen this
     * document declares — would otherwise be accepted as a list naming nothing.
     */
    it("rejects every reference where a field list belongs", () => {
      const references: readonly string[] = ["data:sales.label", "nav:home", "agent:submit"];

      for (const reference of references) {
        expectAtomicReject(documentOf(fields(["email"]) + control(reference)), "invalid-value");
        expect(repairOf(documentOf(fields(["email"]) + control(reference)))).not.toBe(
          unknownNameRepair(),
        );
      }
      // One cause, one repair: a list is never *some* references away from
      // working, so the three cannot drift into separate answers.
      expect(
        new Set(
          references.map((reference) => repairOf(documentOf(fields(["a"]) + control(reference)))),
        ).size,
      ).toBe(1);
    });

    /**
     * The refusal lands **before** ordinary reference dispatch, which this pins
     * from the other side: the very same references on the very same spec's
     * ordinary `label` prop are answered by the ordinary rules — a binding
     * refusal for `data:`, and plain acceptance for a `nav:` that resolves.
     * Neither of those answers is reachable for a request list.
     */
    it("answers before the ordinary reference rules do", () => {
      expectAtomicReject(
        documentOf(fields(["email"]) + '<Button label="data:sales.label" action="agent:submit" />'),
        "binding-not-allowed",
      );
      expect(
        author(documentOf(fields(["email"]) + '<Button label="nav:home" action="agent:submit" />'))
          .ok,
      ).toBe(true);
    });
  });

  describe("what it reports", () => {
    it("reports the fault at the list's value, not at the element", () => {
      const source = documentOf(fields(["email"]) + control("ghost"));

      // Both expectations are read off the **source**, never off the error: a
      // column compared to the error's own offset asserts that one object is
      // internally consistent, which it would be wherever it pointed.
      const at = source.indexOf('collect="') + "collect=".length;

      const failure = failureOf(author(source));

      expect(source.includes("\n")).toBe(false);
      expect(failure.error.location.offset).toBe(at);
      expect(failure.error.location.line).toBe(1);
      expect(failure.error.location.column).toBe(at + 1);
    });

    /**
     * Six faults, six answers.
     *
     * The six share one code — the closed vocabulary has no member for any of
     * them individually — so the code alone cannot tell them apart, and a row
     * asserting only the code would pass just as happily if one cause collapsed
     * into another. The **repair** is what distinguishes them, and it is asserted
     * across the six rather than pinned to wording, because the repair is
     * chosen per cause while the cause line merely quotes whatever token was at
     * fault. A malformed name silently resolved as an unknown one, for instance,
     * still produces a distinct cause — the token differs — and the very same
     * repair.
     */
    it("gives a different reason and a different repair for each cause", () => {
      const faults: readonly (readonly [string, AuthorError])[] = REQUEST_LIST_FAULTS.map(
        ([token, source]) => [token, failureOf(author(source)).error] as const,
      );

      expect(faults.length).toBe(6);
      expect(new Set(faults.map(([, error]) => error.code))).toEqual(new Set(["invalid-value"]));
      expect(new Set(faults.map(([, error]) => error.cause)).size).toBe(faults.length);
      expect(new Set(faults.map(([, error]) => error.repair)).size).toBe(faults.length);
      for (const [token, error] of faults) {
        expect(`${token}: ${error.cause.includes(token)}`).toBe(`${token}: true`);
      }
    });

    it("answers the same way twice for the same list", () => {
      const source = documentOf(fields(["email"]) + control("ghost"));

      expect(author(source)).toEqual(author(source));
    });
  });

  /**
   * The check sits inside the one ordered walk, so it neither jumps the queue
   * nor waits until the end: an earlier fault still wins, and a list fault still
   * beats everything after it.
   */
  describe("its place in the source order", () => {
    it("yields to a fault earlier in the document", () => {
      const outcome = author(
        documentOf(fields(["email"]) + '<Text value="x" colour="red" />' + control("ghost")),
      );

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? null : outcome.failure.error.code).toBe("undeclared-prop");
    });

    it("wins over a fault later in the document", () => {
      const source = documentOf(fields(["email"]) + control("ghost") + "<Widget />");

      const failure = failureOf(author(source));

      expect(failure.error.code).toBe("invalid-value");
      expect(failure.error.location.offset).toBe(source.indexOf('collect="') + "collect=".length);
    });
  });

  /**
   * The reservation is the **prop name**, never the declaration.
   *
   * `validateComponentSpec` already refuses a nonconforming `collect` at the
   * catalog boundary, so neither registration below can be built through
   * `validateCatalog` — each asserts its own refusal and is then synthesised
   * past it. That is exactly what makes them worth writing: a rule that
   * dispatched on the declaration would be one nonconforming registration away
   * from being switched off, and these prove the answer does not consult it.
   */
  describe("whatever the declaration says", () => {
    /** The whole catalog with `Button.collect` re-declared, synthesised past validation. */
    const withCollectDeclaredAs = (declaration: Record<string, unknown>): FacetCatalog => {
      const components: readonly unknown[] = [
        ...TEST_CATALOG.components.filter((spec) => spec.tag !== "Button"),
        {
          tag: "Button",
          whenToUse: "Offer one action.",
          content: { mode: "none" },
          props: {
            label: { type: "string", guidance: "What the action does.", required: true },
            action: { type: "string", guidance: "The reference to run.", required: true },
            collect: declaration,
          },
        },
      ];
      // Said out loud rather than assumed: if this ever passes, the declaration
      // reaches the author layer through a legal catalog and the row below is no
      // longer proving what it claims to prove.
      expect(validateCatalog({ components }).ok).toBe(false);
      return { components } as unknown as FacetCatalog;
    };

    it("reads a request list declared as a number, and refuses what it names", () => {
      const numeric = withCollectDeclaredAs({
        type: "number",
        guidance: "An ordinary number this registration tried to declare.",
      });

      expectAtomicReject(
        documentOf(fields(["email"]) + control("7")),
        "invalid-value",
        numeric,
        DATA,
      );
      expect(repairOf(documentOf(fields(["email"]) + control("7")), numeric)).not.toBe(
        repairOf(documentOf(fields(["email"]) + control("ghost")), numeric),
      );
    });

    it("refuses a data reference on a request list a declaration made bindable", () => {
      // `data:sales.label` resolves, and resolves to a string, so a rule that
      // dispatched on the declaration would bind it and accept a control that
      // asks for nothing and collects nothing.
      expectAtomicReject(
        documentOf(fields(["email"]) + control("data:sales.label")),
        "invalid-value",
        withCollectDeclaredAs({
          type: "string",
          guidance: "A list this registration tried to make bindable.",
          bindable: true,
        }),
        DATA,
      );
    });
  });
});

/**
 * The address a request list resolves to, read off every collectable node the
 * catalog declares — whether or not any list names it.
 *
 * A collectable field whose address is not a usable name can never be collected
 * by anything. Accepting one is a silent, permanent dead end: nothing rejects,
 * nothing warns, and the shortfall surfaces only as an event that quietly
 * carries less than the agent asked for. So the check reads the node, not the
 * request.
 */
describe("validateAuthorMarkup — the authored collection address", () => {
  const home = (body: string): string => documentOf(body);

  it("accepts an address that is a plain field name", () => {
    expect(author(alongsideARequest(fieldWith('name="email2"'))).ok).toBe(true);
  });

  const unusable: readonly (readonly [string, string])[] = [
    ["a dotted path", "a.b"],
    ["a name beginning with a digit", "1st"],
    ["a prototype-shaped name", "__proto__"],
    ["a name carrying a space", "first name"],
    ["an empty address", ""],
    ["a name past the B-06 identifier limit", "f".repeat(BOUNDS.identifierChars + 1)],
  ];

  for (const [label, address] of unusable) {
    it(`rejects ${label} atomically, at the address itself`, () => {
      const source = alongsideARequest(fieldWith(`name="${address}"`));
      // Read off the source, never off the error: a location compared to the
      // error's own fields asserts only that one object is self-consistent.
      const at = source.indexOf("<Field ") + "<Field name=".length;

      expectAtomicReject(source, "invalid-value");
      expect(source.includes("\n")).toBe(false);
      expect(failureOf(author(source)).error.location.offset).toBe(at);
      expect(failureOf(author(source)).error.location.column).toBe(at + 1);
    });
  }

  /**
   * The address is checked because the node is collectable, not because a list
   * happens to name it. Nothing on this screen collects anything — asserted, so
   * a later edit cannot quietly reintroduce a request and leave the row passing
   * for the other reason.
   */
  it("rejects an unusable address on a screen whose controls collect nothing", () => {
    const source = home(fieldWith('name="1st"') + '<Button label="Send" action="agent:submit" />');

    expect(source.includes("collect")).toBe(false);
    expectAtomicReject(source, "invalid-value");
  });

  /**
   * A reference is refused before ordinary reference dispatch, the same way a
   * request list is — and for the same reason: an address that arrives from the
   * Data Model, or that resolves as an action, is not an address this layer can
   * check at all.
   */
  it("rejects a referenced address, before the ordinary reference rules answer", () => {
    for (const reference of ["data:sales.label", "nav:home", "agent:submit"]) {
      expectAtomicReject(home(fieldWith(`name="${reference}"`)), "invalid-value");
    }
    // What the ordinary rules say about the very same references, on the very
    // same spec's ordinary `label` prop: a binding refusal for `data:`, and
    // plain acceptance for a `nav:` that names a screen this document declares.
    // Neither answer is reachable for the address.
    expectAtomicReject(
      home('<Field name="email" label="data:sales.label" />'),
      "binding-not-allowed",
    );
    expect(author(home('<Field name="email" label="nav:home" />')).ok).toBe(true);
  });

  /** A missing address is the required-prop rule's answer, and stays there. */
  it("rejects a missing address as the missing required prop it is", () => {
    expectAtomicReject(home('<Field label="Your email" />'), "missing-required-prop");
  });

  /**
   * The catalog decides, not the prop name. A component the catalog does not
   * call collectable has an ordinary prop that happens to be spelled `name`, and
   * it validates as one — otherwise the rule would be a second, hidden
   * reservation of a name no host can use.
   */
  it("leaves a name prop alone on a component the catalog does not call collectable", () => {
    const withPlain = catalogOf([
      ...(TEST_CATALOG.components as readonly unknown[]),
      {
        tag: "Plain",
        whenToUse: "Carry an ordinary prop that happens to be spelled `name`.",
        content: { mode: "none" },
        props: { name: { type: "string", guidance: "An ordinary label, not an address." } },
      },
    ]);

    expect(author(home('<Plain name="a.b" />'), withPlain).ok).toBe(true);
  });

  /**
   * Eight questions, eight answers.
   *
   * The address shares `invalid-value` with all six request-list causes, so the
   * code cannot tell it from them and a row asserting only the code would pass
   * just as happily if the address collapsed into a neighbouring branch. The
   * repairs are compared instead, across the same six sources the request-list
   * test pins apart, so the two can never drift.
   *
   * The address's own two answers are in there as well. Nothing else separates
   * them: a referenced address and a referenced list are both refused with the
   * same code at the same kind of location, so if the two branches ever handed
   * back one shared repair, every other row here would still pass.
   */
  it("answers an unusable address differently from every request-list cause", () => {
    const repairs = [
      ...REQUEST_LIST_FAULTS.map(([, source]) => repairOf(source)),
      ...ADDRESS_FAULTS.map((source) => repairOf(source)),
    ];

    expect(repairs.length).toBe(8);
    expect(new Set(repairs).size).toBe(repairs.length);
  });
});

/**
 * The one explicit argument an `agent:` event carries.
 *
 * `arg` is reserved by the same convention as `collect` and the collection
 * address, and for the same reason: the renderer forwarding it is reading a
 * framework name, not inferring meaning from a component-specific prop. So the
 * authored value is a **scalar literal** — every reference is refused, of every
 * scheme, before ordinary reference dispatch — and it is bounded by `B-23`,
 * never truncated and never coerced.
 *
 * Two things are deliberately *not* rules here, and each is pinned below rather
 * than left to be re-decided:
 *
 * **The declared domain is the ordinary enum rule's, not a second one.** `enum`
 * is the one keyword the spec layer leaves to a component on `arg`, so an
 * authored argument outside its declared set must reject — and through exactly
 * the rule every other scalar prop goes through, or the catalog would declare a
 * domain nothing enforces.
 *
 * **An argument is never gated on an action.** There is no reserved action-prop
 * name in Facet at all: the default `Button` spells it `action`, but that is one
 * catalog's choice, so a rule about "the action beside this argument" would have
 * to hard-code that spelling — one renaming away from being silently off — or
 * scan for a scheme reference on any prop, which an ordinary string legitimately
 * holding `nav:home` already fails. Its sibling convention answered the same
 * question the same way: a `collect` list beside a `nav:` action is inert and
 * accepted too. What the argument is for is the spec's `guidance`, which is
 * where an authoring hint belongs and where the default catalog already puts it.
 */
const controlWithArg = (arg: string): string =>
  `<Button label="Send" action="agent:submit" arg="${arg}" />`;

/**
 * A catalog whose control declares `arg` with a closed domain, alongside an
 * ordinary prop declaring the **same** domain, and **no** action prop at all.
 *
 * All three halves are load-bearing. `enum` is the keyword the spec layer leaves
 * to the component on `arg`; the twin ordinary prop is what lets the domain
 * refusal be compared to the ordinary rule's own answer without pinning wording;
 * and a control with no action proves the reservation is not gated on one.
 */
const ARG_DOMAIN_CATALOG = catalogOf([
  ...(TEST_CATALOG.components as readonly unknown[]),
  {
    tag: "Choice",
    whenToUse: "Send one of a closed set of arguments, with no action prop of its own.",
    content: { mode: "none" },
    props: {
      arg: {
        type: "string",
        guidance: "Which of the closed set the event carries.",
        enum: ["one", "two"],
      },
      twin: {
        type: "string",
        guidance: "An ordinary prop declaring the very same closed set.",
        enum: ["one", "two"],
      },
    },
  },
]);

/** The repair a rejected **synthesised** ast offers, for a fault no source can express. */
const repairOfAst = (ast: MarkupAst, catalog: FacetCatalog = TEST_CATALOG): string =>
  failureOf(validateAst(ast, catalog)).error.repair;

describe("validateAuthorMarkup — the authored event argument", () => {
  describe("the arguments it admits", () => {
    it("accepts a plain scalar argument beside an `agent:` action", () => {
      expect(author(documentOf(controlWithArg("north"))).ok).toBe(true);
    });

    /**
     * `""` is a legitimate argument and stays distinguishable from no argument
     * at all — the event layer draws exactly that line, and this layer must not
     * close it first.
     */
    it("accepts an empty argument, which is not the same as carrying none", () => {
      expect(author(documentOf(controlWithArg(""))).ok).toBe(true);
      expect(author(documentOf('<Button label="Send" action="agent:submit" />')).ok).toBe(true);
    });

    /**
     * The ruling, from both sides: an argument beside a `nav:` action, and an
     * argument on a control that declares no action prop at all. Both are inert
     * rather than dangerous — the renderer forwards an argument only with an
     * `agent:` event — and inert is not this layer's business to refuse.
     */
    it("accepts an argument beside a `nav:` action", () => {
      expect(
        author(
          documentOf(
            '<Button label="Go" action="nav:details" arg="north" />',
            screenOf("details", '<Text value="there" />'),
          ),
        ).ok,
      ).toBe(true);
    });

    it("accepts an argument on a control that declares no action prop at all", () => {
      // Said out loud rather than assumed: the fixture's control genuinely has
      // no action prop, so the row above cannot be passing for that reason.
      const choice = ARG_DOMAIN_CATALOG.components.find((spec) => spec.tag === "Choice");
      expect(Object.keys(choice?.props ?? {}).sort()).toEqual(["arg", "twin"]);

      expect(author(documentOf('<Choice arg="one" />'), ARG_DOMAIN_CATALOG).ok).toBe(true);
    });
  });

  describe("the arguments it refuses", () => {
    /** The reference every argument cause is measured against, as the list rows do. */
    const unknownNameRepair = (): string => repairOf(documentOf(fields(["a"]) + control("ghost")));

    /**
     * An argument is a scalar literal or it is nothing. Every reference is
     * refused, and by the same branch: `data:` because a bound argument arrives
     * from the Data Model where there is no author-time check to make at all,
     * and `nav:`/`agent:` because the grammar turns them into references before
     * this layer sees them — so a *resolvable* `nav:details` would otherwise be
     * accepted as a perfectly ordinary argument string.
     */
    it("rejects every reference where an argument belongs", () => {
      const references: readonly string[] = ["data:sales.label", "nav:home", "agent:submit"];

      for (const reference of references) {
        expectAtomicReject(documentOf(controlWithArg(reference)), "invalid-value");
        expect(repairOf(documentOf(controlWithArg(reference)))).not.toBe(unknownNameRepair());
      }
      // One cause, one repair: an argument is never *some* references away from
      // working, so the three cannot drift into separate answers.
      expect(new Set(references.map((r) => repairOf(documentOf(controlWithArg(r))))).size).toBe(1);
    });

    /**
     * The refusal is not gated on an action either, which only a control that
     * has none can prove. Every row above is written on a `Button`, whose spec
     * declares an `action` — so a guard quietly narrowed to "an argument beside
     * an action" would pass all of them. `nav:home` names a screen this document
     * declares and `arg` is declared a string, so ordinary dispatch would accept
     * it outright.
     */
    it("rejects a reference on a control that declares no action prop at all", () => {
      expectAtomicReject(
        documentOf('<Choice arg="nav:home" />'),
        "invalid-value",
        ARG_DOMAIN_CATALOG,
      );
      expect(repairOf(documentOf('<Choice arg="nav:home" />'), ARG_DOMAIN_CATALOG)).toBe(
        repairOf(documentOf(controlWithArg("nav:home"))),
      );
    });

    /**
     * The refusal lands **before** ordinary reference dispatch, pinned from the
     * other side: the very same references on the very same spec's ordinary
     * `label` prop are answered by the ordinary rules — a binding refusal for
     * `data:`, and plain acceptance for a `nav:` that resolves. Neither of those
     * answers is reachable for an argument.
     */
    it("answers before the ordinary reference rules do", () => {
      expectAtomicReject(
        documentOf('<Button label="data:sales.label" action="agent:submit" />'),
        "binding-not-allowed",
      );
      expect(author(documentOf('<Button label="nav:home" action="agent:submit" />')).ok).toBe(true);
    });
  });

  /**
   * The reservation is the **prop name**, never the declaration.
   *
   * `validateComponentSpec` already refuses a nonconforming `arg` at the catalog
   * boundary, so neither registration below can be built through
   * `validateCatalog` — each asserts its own refusal and is then synthesised
   * past it. That is what makes them worth writing: a rule that dispatched on
   * the declaration would be one nonconforming registration away from off.
   */
  describe("whatever the declaration says", () => {
    /** The whole catalog with `Button.arg` re-declared, synthesised past validation. */
    const withArgDeclaredAs = (declaration: Record<string, unknown>): FacetCatalog => {
      const components: readonly unknown[] = [
        ...TEST_CATALOG.components.filter((spec) => spec.tag !== "Button"),
        {
          tag: "Button",
          whenToUse: "Offer one action.",
          content: { mode: "none" },
          props: {
            label: { type: "string", guidance: "What the action does.", required: true },
            action: { type: "string", guidance: "The reference to run.", required: true },
            arg: declaration,
          },
        },
      ];
      // Said out loud rather than assumed: if this ever passes, the declaration
      // reaches the author layer through a legal catalog and the row below is no
      // longer proving what it claims to prove.
      expect(validateCatalog({ components }).ok).toBe(false);
      return { components } as unknown as FacetCatalog;
    };

    it("refuses a data reference on an argument a declaration made bindable", () => {
      // `data:sales.label` resolves, and resolves to a string, so a rule that
      // dispatched on the declaration would bind it and send the visitor's page
      // an argument the author never wrote.
      const bindable = withArgDeclaredAs({
        type: "string",
        guidance: "An argument this registration tried to make bindable.",
        bindable: true,
      });

      expectAtomicReject(documentOf(controlWithArg("data:sales.label")), "invalid-value", bindable);
    });

    it("reads an argument declared as a number, and still refuses a reference on it", () => {
      const numeric = withArgDeclaredAs({
        type: "number",
        guidance: "An ordinary number this registration tried to declare.",
      });

      expectAtomicReject(documentOf(controlWithArg("nav:home")), "invalid-value", numeric);
      // The declared-type rule has its own answer for a reference on a non-string
      // prop. This is not it, which is what "before ordinary dispatch" means.
      expect(repairOf(documentOf(controlWithArg("nav:home")), numeric)).not.toBe(
        repairOf(documentOf('<Metric label="n" amount="nav:home" />'), numeric),
      );
    });
  });

  /**
   * `B-23`, the bound an argument shares with a collected value — as a
   * **rejection**. A shortened argument is a different argument: the agent would
   * receive something the author never wrote and nothing would say so, which is
   * the whole reason the event layer rejects a past-bound `arg` rather than
   * clamping it. This layer answers the same way, one exchange earlier.
   *
   * **Which layer answers, for an authored source.** `B-05` bounds every
   * attribute value at the same 2 000 characters `B-23` bounds an argument at,
   * and the lexer runs first — so from source the past-bound row is refused as
   * `value-too-long` during the *parse* phase, and this layer's own bound is
   * reached through a synthesised ast (and from source only if `B-05` is ever
   * raised above `B-23`). Both paths are asserted, and the phase is read off the
   * harness rather than off the error, which after the unification says nothing
   * about which layer raised it.
   */
  describe("the bound it stands behind", () => {
    const atLimit = "v".repeat(BOUNDS.collectedValueChars);
    const pastLimit = "v".repeat(BOUNDS.collectedValueChars + 1);

    /** A synthesised control carrying `text` as its authored argument. */
    const buttonArgAst = (text: string): MarkupAst =>
      astOf(
        screenNode("home", [
          elementNode("Button", [
            propOf("label", scalar("Send")),
            propOf("action", scalar("agent:submit")),
            propOf("arg", scalar(text)),
          ]),
        ]),
      );

    it("accepts an argument of exactly B-23 characters from source, and stores every one", () => {
      const outcome = author(documentOf(controlWithArg(atLimit)));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        return;
      }
      // Read back from the stored document: an accepted argument is the authored
      // one, so a bound enforced by shortening cannot pass as a bound enforced at
      // all.
      const stored = Object.values(outcome.document.nodes)
        .map((node) => node.props["arg"])
        .find((value) => value !== undefined);
      expect(stored?.kind).toBe("scalar");
      expect(stored?.kind === "scalar" ? stored.value.length : 0).toBe(BOUNDS.collectedValueChars);
    });

    it("accepts B-23 and rejects one more character, through a synthesised ast", () => {
      // The anchor: the at-limit ast is accepted, so the rejected one below
      // differs from a reaching, valid fixture by exactly one character rather
      // than by being malformed in some way that never reaches the bound at all.
      expect(validateAst(buttonArgAst(atLimit)).ok).toBe(true);

      const failure = failureOf(validateAst(buttonArgAst(pastLimit)));

      expect(failure.phase).toBe("validate");
      expect(failure.error.code).toBe("invalid-value");
      expect(repairOfAst(buttonArgAst(pastLimit))).not.toBe(
        repairOf(documentOf(fields(["a"]) + control("ghost"))),
      );
    });

    it("is refused by the attribute bound first when the argument is authored in source", () => {
      const failure = failureOf(author(documentOf(controlWithArg(pastLimit))));

      expect(failure.phase).toBe("parse");
      expect(failure.error.code).toBe("value-too-long");
      // Why the row above needs a synthesised ast, stated rather than implied.
      expect(BOUNDS.attributeValueChars).toBeLessThanOrEqual(BOUNDS.collectedValueChars);
    });

    /**
     * The declared domain answers first. Both rules refuse the same value, and
     * the earlier one is the scalar's own domain — the same order that already
     * puts the enum fault ahead of the collection-address fault — so a value
     * that is both outside its set and past the bound is told which set it
     * should have come from, not how long it is allowed to be.
     */
    it("answers a domain violation before the bound, for a value that breaks both", () => {
      const choiceArgAst = (text: string): MarkupAst =>
        astOf(screenNode("home", [elementNode("Choice", [propOf("arg", scalar(text))])]));

      expect(repairOfAst(choiceArgAst(pastLimit), ARG_DOMAIN_CATALOG)).toBe(
        repairOf(documentOf('<Choice arg="three" />'), ARG_DOMAIN_CATALOG),
      );
      expect(repairOfAst(choiceArgAst(pastLimit), ARG_DOMAIN_CATALOG)).not.toBe(
        repairOfAst(buttonArgAst(pastLimit)),
      );
    });
  });

  /**
   * The declared domain is enforced, and by the **ordinary** rule.
   *
   * `enum` is the one keyword the spec layer leaves to a component on `arg`, so
   * a catalog may declare a closed set of arguments — and a set nothing checks
   * is exactly the hole this cut exists to close. The proof is wording-free: an
   * ordinary prop on the same component declares the *same* domain, so the two
   * repairs are identical if and only if one shared rule answered both.
   */
  describe("the domain its declaration may close", () => {
    it("accepts an argument its declared domain admits", () => {
      expect(author(documentOf('<Choice arg="two" />'), ARG_DOMAIN_CATALOG).ok).toBe(true);
    });

    it("refuses one outside it, through the same rule every other scalar prop takes", () => {
      expectAtomicReject(documentOf('<Choice arg="three" />'), "invalid-value", ARG_DOMAIN_CATALOG);
      expect(repairOf(documentOf('<Choice arg="three" />'), ARG_DOMAIN_CATALOG)).toBe(
        repairOf(documentOf('<Choice twin="three" />'), ARG_DOMAIN_CATALOG),
      );
    });
  });

  /**
   * Ten questions, ten answers.
   *
   * The argument shares `invalid-value` with all six request-list causes and
   * both address causes, so the code cannot tell any of them apart and a row
   * asserting only the code would pass just as happily if the argument collapsed
   * into a neighbouring branch. The repairs are compared instead, across the
   * same sources the two tests above pin apart, so the three can never drift.
   *
   * The domain refusal is deliberately **not** an eleventh: it is the ordinary
   * enum answer every scalar prop gets, shared by construction rather than owned
   * by this convention.
   */
  it("answers an unusable argument differently from every list and address cause", () => {
    const repairs = [
      ...REQUEST_LIST_FAULTS.map(([, source]) => repairOf(source)),
      ...ADDRESS_FAULTS.map((source) => repairOf(source)),
      repairOf(documentOf(controlWithArg("data:sales.label"))),
      repairOfAst(
        astOf(
          screenNode("home", [
            elementNode("Button", [
              propOf("label", scalar("Send")),
              propOf("action", scalar("agent:submit")),
              propOf("arg", scalar("v".repeat(BOUNDS.collectedValueChars + 1))),
            ]),
          ]),
        ),
      ),
    ];

    expect(repairs.length).toBe(10);
    expect(new Set(repairs).size).toBe(repairs.length);
  });

  it("reports the fault at the argument's value, not at the element", () => {
    const source = documentOf(controlWithArg("data:sales.label"));
    // Read off the source, never off the error: a column compared to the error's
    // own offset asserts only that one object is internally consistent.
    const at = source.indexOf('arg="') + "arg=".length;

    const failure = failureOf(author(source));

    expect(source.includes("\n")).toBe(false);
    // The code as well as the place: the ordinary binding refusal reports at
    // this very same location, so a row asserting only the offset would pass
    // just as happily with the argument guard gone entirely.
    expect(failure.error.code).toBe("invalid-value");
    expect(failure.error.location.offset).toBe(at);
    expect(failure.error.location.column).toBe(at + 1);
  });
});

const ORIGIN = Object.freeze({ offset: 0, line: 1, column: 1 });

function scalar(value: string): MarkupValue {
  return { kind: "scalar", value };
}

function propOf(name: string, value: MarkupValue): unknown {
  return { name, value, location: ORIGIN, valueLocation: ORIGIN };
}

function elementNode(
  tag: string,
  props: readonly unknown[],
  children: readonly unknown[] = [],
): unknown {
  return { tag, props, children, location: ORIGIN };
}

function screenNode(name: string, children: readonly unknown[]): unknown {
  return elementNode("Screen", [propOf("name", scalar(name))], children);
}

function astOf(...screens: readonly unknown[]): MarkupAst {
  return {
    roots: [elementNode("Facet", [propOf("entry", scalar("home"))], screens)],
    nodeCount: screens.length + 1,
  } as unknown as MarkupAst;
}

/** A screen holding `count` valid leaves, for the node-budget pair. */
function screenOfLeaves(count: number): unknown {
  const leaves = Array.from({ length: count }, (_unused, index) =>
    elementNode("Text", [propOf("value", scalar(`row ${index}`))]),
  );
  return screenNode("home", leaves);
}

describe("validateAuthorMarkup — the bounds it stands behind", () => {
  /**
   * `B-08` is enforced here and nowhere else: the parser counts nodes, the
   * document builder counts nodes per document, and neither one counts screens.
   */
  it("accepts a document with exactly B-08 screens and rejects one more", () => {
    const envelope = (count: number): string =>
      [
        '<Facet entry="s1">',
        ...Array.from({ length: count }, (_unused, index) => `<Screen name="s${index + 1}" />`),
        "</Facet>",
      ].join("\n");

    expect(author(envelope(BOUNDS.screensPerDocument)).ok).toBe(true);
    expectAtomicReject(envelope(BOUNDS.screensPerDocument + 1), "too-many-screens");
  });

  it("accepts a document at the B-07 node budget and rejects one past it", () => {
    const screenNodes = BOUNDS.nodesPerDocument - 1;

    expect(validateAst(astOf(screenOfLeaves(screenNodes))).ok).toBe(true);

    const stage = initialStage();
    const before = JSON.stringify(stage);
    const outcome = validateAst(astOf(screenOfLeaves(screenNodes + 1)));
    const next = applyAuthored(stage, outcome);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.error.code).toBe("malformed-document");
    expect(next).toBe(stage);
    expect(JSON.stringify(next)).toBe(before);
  });

  /**
   * `B-01`..`B-06` are enforced upstream, in the lexer and the parser. The pairs
   * below assert them where an agent actually meets them — on the whole author
   * path — so a bound that stopped binding would fail here as well as there.
   */
  it("accepts source at exactly B-01 characters and rejects one more", () => {
    const base = '<Facet entry="home"><Screen name="home"><Text value="x" /></Screen></Facet>';
    const padded = (total: number): string =>
      base.replace("</Screen>", `${"\n".repeat(total - base.length)}</Screen>`);

    expect(author(padded(BOUNDS.markupSourceChars)).ok).toBe(true);
    expectAtomicReject(padded(BOUNDS.markupSourceChars + 1), "markup-too-large");
  });

  it("accepts a call creating exactly B-02 nodes and rejects one more", () => {
    const envelopeOf = (nodes: number): string =>
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        ...Array.from({ length: nodes - 2 }, () => '<Text value="x" />'),
        "</Screen>",
        "</Facet>",
      ].join("\n");

    expect(author(envelopeOf(BOUNDS.nodesPerMutation)).ok).toBe(true);
    expectAtomicReject(envelopeOf(BOUNDS.nodesPerMutation + 1), "too-many-nodes");
  });

  it("accepts markup nested exactly B-03 deep and rejects one level more", () => {
    const nestedOf = (depth: number): string =>
      [
        '<Facet entry="home">',
        '<Screen name="home">',
        ...Array.from({ length: depth - 2 }, () => '<Stack gap="sm">'),
        ...Array.from({ length: depth - 2 }, () => "</Stack>"),
        "</Screen>",
        "</Facet>",
      ].join("\n");

    expect(author(nestedOf(BOUNDS.elementDepth)).ok).toBe(true);
    expectAtomicReject(nestedOf(BOUNDS.elementDepth + 1), "too-deep");
  });

  it("accepts an attribute value at exactly B-05 characters and rejects one more", () => {
    const valueOf = (length: number): string =>
      `<Facet entry="home"><Screen name="home"><Text value="${"v".repeat(length)}" /></Screen></Facet>`;

    expect(author(valueOf(BOUNDS.attributeValueChars)).ok).toBe(true);
    expectAtomicReject(valueOf(BOUNDS.attributeValueChars + 1), "value-too-long");
  });

  it("accepts a screen name at exactly B-06 characters and rejects one more", () => {
    const named = (length: number): string => {
      const name = "s".repeat(length);
      return `<Facet entry="${name}"><Screen name="${name}" /></Facet>`;
    };

    expect(author(named(BOUNDS.identifierChars)).ok).toBe(true);
    expectAtomicReject(named(BOUNDS.identifierChars + 1), "malformed-document");
  });

  /**
   * `B-04` counts **author-declared** props: exactly `BOUNDS.propsPerElement` of
   * them is the limit, not one fewer. The reserved `id` Facet emits when it
   * serializes a document is excluded from that count, so a full element still
   * round-trips through its own read-back text — an exclusion that belongs to the
   * shared parser, never to author validation.
   */
  it("accepts an element carrying exactly B-04 author props and rejects one more", () => {
    expect(author(wideMarkup(BOUNDS.propsPerElement)).ok).toBe(true);
    expectAtomicReject(wideMarkup(BOUNDS.propsPerElement + 1), "too-many-props");
  });

  /**
   * The seam between the two layers, end to end. The parser lets a full element
   * carry the one reserved snapshot `id` — that is what makes a `B-04`-wide
   * element round-trip through its own read-back text — and author validation
   * still refuses it, because reading an `id` back and authoring one are
   * different acts. Nothing about the exclusion reaches this layer.
   */
  it("refuses the reserved id on a B-04-wide element that the parser lets through", () => {
    const written = wideMarkup(BOUNDS.propsPerElement).replace(
      "<Wide ",
      `<Wide ${RESERVED_ID_ATTRIBUTE} `,
    );

    expect(parseMarkup(written).ok).toBe(true);
    expectAtomicReject(written, "reserved-attribute");
  });

  /**
   * The exclusion is the parser's and stops there. Author validation counts no
   * `id` at all, because an authored `id` never reaches the counting question:
   * it is a reserved attribute and therefore already a rejection. Asserted on a
   * synthesised ast, so the outcome does not depend on how the parser counts.
   */
  it("still rejects a reserved id on a full element, rather than excluding it", () => {
    const stage = initialStage();
    const before = JSON.stringify(stage);

    const outcome = validateAst(
      astOf(
        screenNode("home", [
          elementNode("Wide", [
            ...WIDE_PROP_NAMES.slice(0, BOUNDS.propsPerElement).map((name) =>
              propOf(name, scalar("v")),
            ),
            propOf("id", scalar("n9")),
          ]),
        ]),
      ),
    );
    const next = applyAuthored(stage, outcome);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.failure.error.code).toBe("reserved-attribute");
    expect(next).toBe(stage);
    expect(JSON.stringify(next)).toBe(before);
  });
});

describe("validateAuthorMarkup — host-pinned image assets", () => {
  const assets = Object.freeze({
    hero: Object.freeze({
      kind: "image" as const,
      src: "https://cdn.example.com/hero.webp",
      width: 1600,
      height: 900,
    }),
  });

  it("accepts a known asset reference only on an image asset prop", () => {
    expect(
      author(
        '<Facet entry="home"><Screen name="home"><Image asset="asset:hero" alt="Desk lamp" /></Screen></Facet>',
        TEST_CATALOG,
        DATA,
        assets,
      ).ok,
    ).toBe(true);
  });

  it("rejects an unknown asset key", () => {
    const failure = failureOf(
      author(
        '<Facet entry="home"><Screen name="home"><Image asset="asset:missing" alt="Missing" /></Screen></Facet>',
        TEST_CATALOG,
        DATA,
        assets,
      ),
    );
    expect(failure.error.code).toBe("invalid-value");
    expect(failure.error.cause).toContain("missing");
  });

  it.each(["https://cdn.example.com/hero.webp", "data:images.hero", "nav:home", "agent:loadImage"])(
    "rejects %s because an asset prop accepts only asset:key",
    (source) => {
      const failure = failureOf(
        author(
          `<Facet entry="home"><Screen name="home"><Image asset="${source}" alt="Banner" /></Screen></Facet>`,
          TEST_CATALOG,
          { ...DATA, images: { hero: "https://cdn.example.com/hero.webp" } },
          assets,
        ),
      );
      expect(failure.error.code).toBe("invalid-value");
    },
  );

  it("rejects asset:key on an ordinary string prop", () => {
    const failure = failureOf(
      author(
        '<Facet entry="home"><Screen name="home"><Text value="asset:hero" /></Screen></Facet>',
        TEST_CATALOG,
        DATA,
        assets,
      ),
    );
    expect(failure.error.code).toBe("invalid-value");
  });
});

describe("validateAuthorMarkup — totality", () => {
  const junk: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a string", '<Facet entry="home" />'],
    ["an ast with no roots array", { roots: "nope", nodeCount: 1 }],
    ["an ast whose root is null", { roots: [null], nodeCount: 1 }],
    ["an ast with two roots", { roots: [null, null], nodeCount: 2 }],
    ["an ast whose root has no props array", { roots: [{ tag: "Facet", children: [] }] }],
  ];

  for (const [label, value] of junk) {
    it(`rejects ${label} rather than throwing`, () => {
      expect(() => validateAuthorMarkup(value as MarkupAst, TEST_CATALOG, DATA)).not.toThrow();
      expect(validateAuthorMarkup(value as MarkupAst, TEST_CATALOG, DATA).ok).toBe(false);
    });
  }

  it("rejects rather than throwing when an ast property getter throws", () => {
    const hostile = {
      get roots(): never {
        throw new Error("hostile");
      },
      nodeCount: 1,
    };

    expect(() =>
      validateAuthorMarkup(hostile as unknown as MarkupAst, TEST_CATALOG, DATA),
    ).not.toThrow();
    expect(validateAuthorMarkup(hostile as unknown as MarkupAst, TEST_CATALOG, DATA).ok).toBe(
      false,
    );
  });

  it("rejects rather than throwing for a hostile catalog or data model", () => {
    const parsed = parseMarkup(ACCEPTED_MARKUP);
    if (!parsed.ok) {
      throw new Error("fixture markup did not parse");
    }
    const hostileCatalog = {
      get components(): never {
        throw new Error("hostile");
      },
    } as unknown as FacetCatalog;
    const hostileData = {
      get sales(): never {
        throw new Error("hostile");
      },
    } as unknown as DataModel;

    expect(() => validateAuthorMarkup(parsed.ast, hostileCatalog, DATA)).not.toThrow();
    expect(validateAuthorMarkup(parsed.ast, hostileCatalog, DATA).ok).toBe(false);
    expect(() => validateAuthorMarkup(parsed.ast, TEST_CATALOG, hostileData)).not.toThrow();
    expect(validateAuthorMarkup(parsed.ast, TEST_CATALOG, hostileData).ok).toBe(false);
  });

  it("clamps both copy fields to B-24", () => {
    const failure = failureOf(
      author('<Facet entry="home"><Screen name="home"><Widget /></Screen></Facet>'),
    );

    expect(failure.error.cause.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
    expect(failure.error.repair.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
  });
});
