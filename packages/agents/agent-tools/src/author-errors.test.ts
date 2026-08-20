import { describe, expect, it } from "vitest";

import { BOUNDS } from "@facet/core";
import type { AuthorError } from "@facet/core";

import { renderAuthorError } from "./author-errors.js";

function error(overrides: Partial<AuthorError> = {}): AuthorError {
  return {
    code: "raw-html",
    location: { line: 2, column: 3, offset: 14 },
    cause: "Raw HTML and an event handler are both present; the first deterministic fault wins.",
    repair: "Replace the raw HTML with a registered component.",
    ...overrides,
  };
}

describe("renderAuthorError", () => {
  it("projects the one core AuthorError path deterministically", () => {
    const first = renderAuthorError(error());
    const second = renderAuthorError(error());

    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: false,
      code: "author_error",
      error: {
        code: "raw-html",
        location: { line: 2, column: 3, offset: 14 },
        cause:
          "Raw HTML and an event handler are both present; the first deterministic fault wins.",
        repair: "Replace the raw HTML with a registered component.",
      },
    });
  });

  it("bounds framework-controlled error copy with no parse-vs-validation dispatch", () => {
    const projected = renderAuthorError(
      error({
        cause: "c".repeat(BOUNDS.frameworkCopyChars + 20),
        repair: "r".repeat(BOUNDS.frameworkCopyChars + 20),
      }),
    );

    expect(projected.error.cause).toHaveLength(BOUNDS.frameworkCopyChars);
    expect(projected.error.repair).toHaveLength(BOUNDS.frameworkCopyChars);
  });

  it("preserves catalog-derived repair context without echoing authored values", () => {
    const projected = renderAuthorError(
      error({
        code: "invalid-value",
        repairContext: {
          kind: "prop_value",
          componentTag: "Property",
          propName: "tone",
          allowedValues: ["default", "muted"],
        },
      }),
    );

    expect(projected.error.repairContext).toEqual({
      kind: "prop_value",
      componentTag: "Property",
      propName: "tone",
      allowedValues: ["default", "muted"],
    });
  });
});
