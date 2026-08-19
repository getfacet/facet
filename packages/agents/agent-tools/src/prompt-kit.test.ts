import { describe, expect, it } from "vitest";

import { BOUNDS, buildDocument, parseMarkup } from "@facet/core";

import { FACET_PROMPT_KIT } from "./prompt-kit.js";

describe("FACET_PROMPT_KIT", () => {
  it("is compact and contains no retired vocabulary", () => {
    expect(FACET_PROMPT_KIT.length).toBeLessThan(4_000);
    expect(FACET_PROMPT_KIT).not.toMatch(/STAGE_SPEC|Brick|Pattern|Preset|get_pattern|get_preset/u); // component-hard-cut: allowed-negative
    expect(FACET_PROMPT_KIT).not.toMatch(/\btoken\b|\btokens\b|token-count/u);
  });

  it("quotes structural bounds from BOUNDS without local token limits", () => {
    expect(FACET_PROMPT_KIT).toContain(String(BOUNDS.markupSourceChars));
    expect(FACET_PROMPT_KIT).toContain(String(BOUNDS.readDataResult.items));
    expect(FACET_PROMPT_KIT).toContain(String(BOUNDS.readDataResult.chars));
    expect(FACET_PROMPT_KIT).toContain(String(BOUNDS.publishDataPayloadChars));
    expect(FACET_PROMPT_KIT).toContain("render_page");
    expect(FACET_PROMPT_KIT).toContain("publish_data");
  });

  it("teaches the complete service-neutral first-page grammar", () => {
    const minimalDocument = '<Facet entry="main"><Screen name="main" /></Facet>';

    expect(FACET_PROMPT_KIT).toContain(minimalDocument);
    expect(FACET_PROMPT_KIT).toContain("exactly one Facet root");
    expect(FACET_PROMPT_KIT).toContain("direct children are Screen roots");
    expect(FACET_PROMPT_KIT).toContain("entry must equal one Screen name");
    expect(FACET_PROMPT_KIT).toContain("let Facet generate every id");
    expect(FACET_PROMPT_KIT).toContain("demonstrates only the document envelope");
    expect(FACET_PROMPT_KIT).toContain("Never submit empty or placeholder screens");

    const exampleTags = [...FACET_PROMPT_KIT.matchAll(/<([A-Z][A-Za-z0-9]*)/gu)].map(
      (match) => match[1],
    );
    expect(exampleTags).toEqual(["Facet", "Screen"]);

    const parsed = parseMarkup(minimalDocument);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("the prompt example must parse");
    const document = buildDocument(parsed.ast);
    expect(document?.entry).toBe("main");
    expect(document?.screens).toHaveLength(1);
  });

  it("requires catalog discovery and result-driven repair", () => {
    expect(FACET_PROMPT_KIT).toContain(
      "Inside Screen roots, use only component tags present in the active catalog",
    );
    expect(FACET_PROMPT_KIT).toContain("call read_component_spec");
    expect(FACET_PROMPT_KIT).toContain(
      "request all independent read_component_spec calls together",
    );
    expect(FACET_PROMPT_KIT).toContain("one tool-only response");
    expect(FACET_PROMPT_KIT).toContain("do not guess");
    expect(FACET_PROMPT_KIT).toContain("ok: true");
    expect(FACET_PROMPT_KIT).toContain("ok: false");
    expect(FACET_PROMPT_KIT).toContain("code");
    expect(FACET_PROMPT_KIT).toContain("cause");
    expect(FACET_PROMPT_KIT).toContain("repair");
    expect(FACET_PROMPT_KIT).toContain("never repeat unchanged invalid input");
  });

  it("does not let data publication stand in for visible authoring", () => {
    expect(FACET_PROMPT_KIT).toContain(
      "For a new binding, that descriptor is not visible markup or completion",
    );
    expect(FACET_PROMPT_KIT).toContain("publish once, then immediately mutate markup");
    expect(FACET_PROMPT_KIT).toContain("never republish unchanged data");
    expect(FACET_PROMPT_KIT).toContain("current markup already binds that path");
  });

  it("keeps failed authoring focused on a corrected mutation", () => {
    expect(FACET_PROMPT_KIT).toContain("keep the current authoring goal active");
    expect(FACET_PROMPT_KIT).toContain("use bounded reads when needed");
    expect(FACET_PROMPT_KIT).toContain("Do not switch to unrelated tools");
  });

  it("teaches composition-first authoring without requiring layout wrappers", () => {
    expect(FACET_PROMPT_KIT).toContain("decide the spatial relationship");
    expect(FACET_PROMPT_KIT).toContain("minimum layout components");
    expect(FACET_PROMPT_KIT).toContain("fill that structure");
    expect(FACET_PROMPT_KIT).toContain("discovery guidance only");
    expect(FACET_PROMPT_KIT).toContain("simple screen may contain");
    expect(FACET_PROMPT_KIT).toContain("Do not add layout wrappers");
    expect(FACET_PROMPT_KIT.indexOf("identify the screen job")).toBeLessThan(
      FACET_PROMPT_KIT.indexOf("Choose visible tags first"),
    );
    expect(FACET_PROMPT_KIT.indexOf("Choose visible tags first")).toBeLessThan(
      FACET_PROMPT_KIT.indexOf("call read_component_spec"),
    );
  });
});
