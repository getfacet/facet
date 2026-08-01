import { describe, expect, it } from "vitest";

import { BOUNDS } from "@facet/core";

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
});
