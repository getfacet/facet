import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { buildDocument, type ComponentDocument } from "./document.js";
import { parseAction, type Action, type ActionResult } from "./actions.js";
import { parseMarkup } from "./markup-parser.js";

/** Builds a fixture document, failing loudly if the fixture markup itself is bad. */
function documentOf(markup: string): ComponentDocument {
  const parsed = parseMarkup(markup);
  if (!parsed.ok) {
    throw new Error(`fixture markup did not parse: ${parsed.error.code}`);
  }
  const document = buildDocument(parsed.ast);
  if (document === null) {
    throw new Error("fixture markup did not build a document");
  }
  return document;
}

const DOCUMENT = documentOf(
  [
    '<Facet entry="home">',
    '<Screen name="home">',
    '<Button label="Details" action="nav:details" />',
    "</Screen>",
    '<Screen name="details" />',
    "</Facet>",
  ].join("\n"),
);

const LONGEST_IDENTIFIER = "e".repeat(BOUNDS.identifierChars);

const TOO_LONG_IDENTIFIER = "e".repeat(BOUNDS.identifierChars + 1);

/**
 * A consumer's own helper over the result. It exists to prove the surface is
 * *nameable*: `parseAction` is public, so a caller that stores its answer,
 * passes it on, or narrows it in a second function has to be able to write the
 * type — and both branches, the rejection reasons included, have to be reachable
 * without restating them. A rejection reason that only the module could name
 * would leave every such consumer with `ReturnType<typeof parseAction>`.
 */
function summarize(result: ActionResult): string {
  return result.ok ? `ok:${result.action.kind}` : `no:${result.reason}`;
}

describe("parseAction — the public result surface", () => {
  it("lets a consumer hold, narrow and re-emit a result under its declared type", () => {
    const accepted: ActionResult = parseAction("nav:details", DOCUMENT);
    const rejected: ActionResult = parseAction("local:toggle", DOCUMENT); // component-hard-cut: allowed-negative

    expect(summarize(accepted)).toBe("ok:nav");
    expect(summarize(rejected)).toBe("no:unknown_scheme");
  });

  it("lets a consumer name the action union on its own", () => {
    const result = parseAction("agent:refresh", DOCUMENT);
    const action: Action | null = result.ok ? result.action : null;

    expect(action).toEqual({ kind: "agent", event: "refresh" });
  });

  /**
   * Every reason the closed table exercises is reachable through the public
   * result, so the vocabulary a consumer can switch on is the whole vocabulary.
   */
  it("exposes every rejection reason through the public result type", () => {
    const reasons = new Set<string>();
    for (const reference of [["local", ":toggle"].join(""), "nav:missing", "nav:", "navhome"]) {
      const result: ActionResult = parseAction(reference, DOCUMENT);
      if (!result.ok) {
        reasons.add(result.reason);
      }
    }

    expect([...reasons].sort()).toEqual([
      "invalid_target",
      "not_an_action",
      "unknown_scheme",
      "unknown_screen",
    ]);
  });
});

describe("parseAction — the accepted vocabulary", () => {
  const accepted: readonly (readonly [string, string, unknown])[] = [
    ["a nav to the entry screen", "nav:home", { kind: "nav", screen: "home" }],
    ["a nav to another declared screen", "nav:details", { kind: "nav", screen: "details" }],
    ["a visitor event", "agent:refresh", { kind: "agent", event: "refresh" }],
    [
      "a visitor event using every identifier character",
      "agent:refresh_now-2",
      { kind: "agent", event: "refresh_now-2" },
    ],
    [
      "a visitor event at the B-06 identifier limit",
      `agent:${LONGEST_IDENTIFIER}`,
      { kind: "agent", event: LONGEST_IDENTIFIER },
    ],
  ];

  for (const [label, reference, action] of accepted) {
    it(`accepts ${label}`, () => {
      const result = parseAction(reference, DOCUMENT);

      expect(result.ok).toBe(true);
      expect(result.ok ? result.action : null).toEqual(action);
    });
  }
});

describe("parseAction — the closed rejection table", () => {
  const rejected: readonly (readonly [string, unknown, string])[] = [
    ["a local action", "local:toggle", "unknown_scheme"], // component-hard-cut: allowed-negative
    ["a local action with no target", "local:", "unknown_scheme"], // component-hard-cut: allowed-negative
    ["a data reference, which reads and never acts", "data:sales.total", "unknown_scheme"],
    ["an invented scheme", "route:home", "unknown_scheme"],
    ["a scheme in the wrong case", "NAV:home", "unknown_scheme"],
    ["a javascript url", "javascript:alert(1)", "unknown_scheme"],
    ["a nav to a screen this document does not declare", "nav:missing", "unknown_screen"],
    ["a nav whose case does not match a declared screen", "nav:Home", "unknown_screen"],
    ["a nav with no target", "nav:", "invalid_target"],
    ["a visitor event with no target", "agent:", "invalid_target"],
    ["a target carrying a space", "nav:home page", "invalid_target"],
    ["a target carrying a second scheme separator", "agent:refresh:now", "invalid_target"],
    ["a target that is a data path", "agent:sales.total", "invalid_target"],
    ["a target past the B-06 identifier limit", `agent:${TOO_LONG_IDENTIFIER}`, "invalid_target"],
    ["a bare word with no scheme", "navhome", "not_an_action"],
    ["an empty string", "", "not_an_action"],
    ["a lone separator", ":", "not_an_action"],
    ["a number", 42, "not_an_action"],
    ["null", null, "not_an_action"],
    ["undefined", undefined, "not_an_action"],
    ["an object", { kind: "nav", screen: "home" }, "not_an_action"],
  ];

  for (const [label, reference, reason] of rejected) {
    it(`rejects ${label}`, () => {
      const result = parseAction(reference, DOCUMENT);

      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.reason).toBe(reason);
    });
  }
});

describe("parseAction — totality and determinism", () => {
  const hostile: readonly (readonly [string, unknown])[] = [
    ["a null document", null],
    ["an empty object", {}],
    ["a document whose screens are not an array", { entry: "home", screens: "home", nodes: {} }],
    ["a document whose nodes are missing", { entry: "home", screens: ["n1"] }],
    [
      "a document whose screen id dangles",
      { entry: "home", screens: ["n9"], nodes: { n1: { tag: "Screen", props: {}, children: [] } } },
    ],
  ];

  for (const [label, document] of hostile) {
    it(`never throws for ${label}`, () => {
      expect(() => parseAction("nav:home", document as ComponentDocument)).not.toThrow();
      expect(parseAction("nav:home", document as ComponentDocument).ok).toBe(false);
    });
  }

  it("never throws when a document property getter throws", () => {
    const hostileDocument = {
      entry: "home",
      screens: ["n1"],
      get nodes(): never {
        throw new Error("hostile");
      },
    };

    expect(() =>
      parseAction("nav:home", hostileDocument as unknown as ComponentDocument),
    ).not.toThrow();
    expect(parseAction("nav:home", hostileDocument as unknown as ComponentDocument).ok).toBe(false);
  });

  it("answers the same way twice for the same input", () => {
    expect(parseAction("nav:details", DOCUMENT)).toEqual(parseAction("nav:details", DOCUMENT));
    expect(parseAction("local:toggle", DOCUMENT)).toEqual(parseAction("local:toggle", DOCUMENT)); // component-hard-cut: allowed-negative
  });

  /**
   * DC-018's core half: resolving a `nav:` action is a **read**. It reports the
   * screen to move to and changes nothing, so navigation can never be the source
   * of a document patch.
   */
  it("leaves the document byte-identical when it resolves a nav action", () => {
    const before = JSON.stringify(DOCUMENT);

    const result = parseAction("nav:details", DOCUMENT);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(DOCUMENT)).toBe(before);
  });
});
