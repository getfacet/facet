import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { NEUTRAL_COPY_DEFAULTS, resolveNeutralCopy } from "./neutral-copy.js";
import type { NeutralCopy, NeutralCopyResolution } from "./neutral-copy.js";

/** Unwraps an accepted resolution and pins the success branch's exact key set. */
function accepted(result: NeutralCopyResolution): NeutralCopy {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected an accepted copy set");
  }
  expect(Object.keys(result).sort()).toEqual(["copy", "ok"]);
  return result.copy;
}

/**
 * Pins a rejection: one structured error, never an aggregated list. The key set
 * is asserted exactly so a future extra field cannot slip in unnoticed, and the
 * detail is itself framework copy, so it is bounded by `B-24` too.
 */
function rejected(result: NeutralCopyResolution, code: string, at: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a rejection");
  }
  expect(Object.keys(result).sort()).toEqual(["at", "code", "detail", "ok"]);
  expect(result.code).toBe(code);
  expect(result.at).toBe(at);
  expect(result.detail.length).toBeGreaterThan(0);
  expect(result.detail.length).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
}

/** Every framework-controlled string, flattened with the path it lives at. */
function stringLeaves(copy: NeutralCopy): ReadonlyArray<readonly [string, string]> {
  const leaves: Array<readonly [string, string]> = [];
  for (const [group, values] of Object.entries(copy)) {
    for (const [key, value] of Object.entries(values as Record<string, string>)) {
      leaves.push([`${group}.${key}`, value]);
    }
  }
  return leaves;
}

describe("NEUTRAL_COPY_DEFAULTS", () => {
  it("ships the exact English defaults the framework owns", () => {
    expect(NEUTRAL_COPY_DEFAULTS.render.preparing).toBe("Preparing…");
    expect(NEUTRAL_COPY_DEFAULTS.render.componentUnavailable).toBe("Content unavailable");
    expect(NEUTRAL_COPY_DEFAULTS.render.corruptSubtree).toBe("This section could not be displayed");
    expect(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong).toBe(
      "Your message is too long. Please shorten it and try again.",
    );
  });

  it("renders with NO host configuration at all", () => {
    expect(accepted(resolveNeutralCopy())).toBe(NEUTRAL_COPY_DEFAULTS);
    expect(accepted(resolveNeutralCopy(undefined))).toBe(NEUTRAL_COPY_DEFAULTS);
  });

  it("keeps every default non-empty and within B-24", () => {
    for (const [at, value] of stringLeaves(NEUTRAL_COPY_DEFAULTS)) {
      expect(value.trim().length, `${at} must say something`).toBeGreaterThan(0);
      expect(value.length, `${at} must fit B-24`).toBeLessThanOrEqual(BOUNDS.frameworkCopyChars);
    }
  });

  it("is frozen through both groups", () => {
    expect(Object.isFrozen(NEUTRAL_COPY_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_COPY_DEFAULTS.render)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_COPY_DEFAULTS.validation)).toBe(true);
    const escaped = NEUTRAL_COPY_DEFAULTS.render as unknown as Record<string, unknown>;
    try {
      escaped["preparing"] = "replaced";
    } catch {
      // Strict-mode assignment to a frozen object throws; either way the value
      // below must be unchanged.
    }
    expect(NEUTRAL_COPY_DEFAULTS.render.preparing).toBe("Preparing…");
  });
});

describe("the copy set is exactly four strings across three render neutral states", () => {
  it("declares two groups and nothing else", () => {
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS).sort()).toEqual(["render", "validation"]);
  });

  it("declares exactly THREE render neutral states", () => {
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS.render)).toEqual([
      "preparing",
      "componentUnavailable",
      "corruptSubtree",
    ]);
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS.render)).toHaveLength(3);
  });

  it("declares exactly FOUR framework-controlled strings in total", () => {
    expect(stringLeaves(NEUTRAL_COPY_DEFAULTS).map(([at]) => at)).toEqual([
      "render.preparing",
      "render.componentUnavailable",
      "render.corruptSubtree",
      "validation.messageTooLong",
    ]);
    expect(stringLeaves(NEUTRAL_COPY_DEFAULTS)).toHaveLength(4);
  });

  it("keeps the over-length validation copy OUT of the render neutral states", () => {
    // Four strings, three render states: the fourth string is copy for input the
    // visitor can fix, not a fourth way for the page to degrade.
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS.render)).not.toContain("messageTooLong");
    expect(Object.keys(NEUTRAL_COPY_DEFAULTS.validation)).toEqual(["messageTooLong"]);
    expect(
      Object.keys(NEUTRAL_COPY_DEFAULTS.render).length +
        Object.keys(NEUTRAL_COPY_DEFAULTS.validation).length,
    ).toBe(4);
  });

  it("resolves to the same closed shape for any accepted override", () => {
    const copy = accepted(resolveNeutralCopy({ render: { preparing: "Just a moment" } }));
    expect(Object.keys(copy).sort()).toEqual(["render", "validation"]);
    expect(Object.keys(copy.render)).toEqual(Object.keys(NEUTRAL_COPY_DEFAULTS.render));
    expect(Object.keys(copy.validation)).toEqual(Object.keys(NEUTRAL_COPY_DEFAULTS.validation));
  });
});

describe("host override at bootstrap", () => {
  it("accepts a partial override and keeps every other string at its default", () => {
    const copy = accepted(
      resolveNeutralCopy({ render: { componentUnavailable: "Not available" } }),
    );
    expect(copy.render.componentUnavailable).toBe("Not available");
    expect(copy.render.preparing).toBe(NEUTRAL_COPY_DEFAULTS.render.preparing);
    expect(copy.render.corruptSubtree).toBe(NEUTRAL_COPY_DEFAULTS.render.corruptSubtree);
    expect(copy.validation.messageTooLong).toBe(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
  });

  it("accepts an override of every slot — each of the four is reachable", () => {
    const copy = accepted(
      resolveNeutralCopy({
        render: {
          preparing: "Un momento",
          componentUnavailable: "Contenido no disponible",
          corruptSubtree: "Esta sección no se pudo mostrar",
        },
        validation: { messageTooLong: "Tu mensaje es demasiado largo." },
      }),
    );
    expect(copy).toEqual({
      render: {
        preparing: "Un momento",
        componentUnavailable: "Contenido no disponible",
        corruptSubtree: "Esta sección no se pudo mostrar",
      },
      validation: { messageTooLong: "Tu mensaje es demasiado largo." },
    });
  });

  it("treats an omitted group and an explicitly undefined slot as no override", () => {
    const copy = accepted(resolveNeutralCopy({ render: { preparing: undefined } }));
    expect(copy).toEqual(NEUTRAL_COPY_DEFAULTS);
  });

  it("copies the strings out, so mutating the host object later changes nothing", () => {
    const override: { render: { preparing: string } } = { render: { preparing: "Starting up" } };
    const copy = accepted(resolveNeutralCopy(override));
    override.render.preparing = "Replaced after bootstrap";
    expect(copy.render.preparing).toBe("Starting up");
  });

  it("freezes the resolved copy through both groups", () => {
    const copy = accepted(resolveNeutralCopy({ render: { preparing: "Starting up" } }));
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.render)).toBe(true);
    expect(Object.isFrozen(copy.validation)).toBe(true);
  });
});

describe("B-24 bounds one override string", () => {
  const slots: ReadonlyArray<{ readonly group: "render" | "validation"; readonly key: string }> = [
    { group: "render", key: "preparing" },
    { group: "render", key: "componentUnavailable" },
    { group: "render", key: "corruptSubtree" },
    { group: "validation", key: "messageTooLong" },
  ];

  it.each(slots)("accepts $group / $key at exactly B-24 characters", ({ group, key }) => {
    const atLimit = "c".repeat(BOUNDS.frameworkCopyChars);
    expect(atLimit).toHaveLength(500);
    const copy = accepted(resolveNeutralCopy({ [group]: { [key]: atLimit } }));
    expect(stringLeaves(copy).find(([at]) => at === `${group}.${key}`)?.[1]).toBe(atLimit);
  });

  it.each(slots)("rejects $group / $key one character past B-24", ({ group, key }) => {
    const pastLimit = "c".repeat(BOUNDS.frameworkCopyChars + 1);
    expect(pastLimit).toHaveLength(501);
    rejected(
      resolveNeutralCopy({ [group]: { [key]: pastLimit } }),
      "copy_too_long",
      `${group}.${key}`,
    );
  });
});

describe("the override form is closed", () => {
  it("rejects an unknown group", () => {
    rejected(resolveNeutralCopy({ banner: {} }), "unknown_copy_key", "banner");
  });

  it("rejects an unknown key inside a group", () => {
    rejected(
      resolveNeutralCopy({ render: { networkError: "Offline" } }),
      "unknown_copy_key",
      "render.networkError",
    );
  });

  it("reports the sorted-first unknown key, so the failure never depends on key order", () => {
    rejected(resolveNeutralCopy({ zeta: {}, alpha: {} }), "unknown_copy_key", "alpha");
    rejected(resolveNeutralCopy({ alpha: {}, zeta: {} }), "unknown_copy_key", "alpha");
  });

  it("rejects a prototype-shaped own key rather than treating it as a copy slot", () => {
    const hostile: Record<string, unknown> = { render: {} };
    Object.defineProperty(hostile, "__proto__", {
      value: "planted",
      enumerable: true,
      configurable: true,
    });
    rejected(resolveNeutralCopy(hostile), "unknown_copy_key", "__proto__");
  });

  it("rejects a group that is not a plain object", () => {
    rejected(resolveNeutralCopy({ render: "Preparing" }), "copy_group_not_an_object", "render");
    rejected(resolveNeutralCopy({ render: [] }), "copy_group_not_an_object", "render");
    rejected(resolveNeutralCopy({ render: null }), "copy_group_not_an_object", "render");
  });

  it("rejects a non-string, empty, or whitespace-only string", () => {
    rejected(
      resolveNeutralCopy({ render: { preparing: 42 } }),
      "copy_not_a_string",
      "render.preparing",
    );
    rejected(
      resolveNeutralCopy({ render: { preparing: null } }),
      "copy_not_a_string",
      "render.preparing",
    );
    rejected(resolveNeutralCopy({ render: { preparing: "" } }), "copy_empty", "render.preparing");
    rejected(
      resolveNeutralCopy({ render: { preparing: "   " } }),
      "copy_empty",
      "render.preparing",
    );
  });

  it("rejects the whole override on its first fault rather than applying half of it", () => {
    const result = resolveNeutralCopy({
      render: { preparing: "" },
      validation: { messageTooLong: "This one is fine" },
    });
    rejected(result, "copy_empty", "render.preparing");
    expect(result).not.toHaveProperty("copy");
  });

  it("never reads an inherited value in place of an override the host did not write", () => {
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted["preparing"] = "planted by prototype pollution";
    try {
      expect(accepted(resolveNeutralCopy({ render: {} })).render.preparing).toBe(
        NEUTRAL_COPY_DEFAULTS.render.preparing,
      );
      expect(accepted(resolveNeutralCopy({})).render.preparing).toBe(
        NEUTRAL_COPY_DEFAULTS.render.preparing,
      );
    } finally {
      delete polluted["preparing"];
    }
  });
});

describe("resolveNeutralCopy is total", () => {
  const hostile: ReadonlyArray<{ readonly what: string; readonly value: unknown }> = [
    { what: "null", value: null },
    { what: "a number", value: 42 },
    { what: "a string", value: "Preparing" },
    { what: "a boolean", value: true },
    { what: "an array", value: [] },
    { what: "a function", value: () => "copy" },
    { what: "a symbol", value: Symbol("copy") },
    { what: "NaN", value: Number.NaN },
  ];

  it.each(hostile)("rejects $what without throwing", ({ value }) => {
    expect(() => resolveNeutralCopy(value)).not.toThrow();
    rejected(resolveNeutralCopy(value), "copy_not_an_object", "");
  });

  it("accepts a null-prototype object with no overrides", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    expect(accepted(resolveNeutralCopy(bare))).toEqual(NEUTRAL_COPY_DEFAULTS);
  });

  it("rejects a throwing group accessor without throwing", () => {
    const throwing = {
      get render(): unknown {
        throw new Error("hostile getter");
      },
    };
    expect(() => resolveNeutralCopy(throwing)).not.toThrow();
    rejected(resolveNeutralCopy(throwing), "copy_read_failed", "");
  });

  it("rejects a throwing string accessor without throwing", () => {
    const throwing = {
      render: {
        get preparing(): unknown {
          throw new Error("hostile getter");
        },
      },
    };
    expect(() => resolveNeutralCopy(throwing)).not.toThrow();
    rejected(resolveNeutralCopy(throwing), "copy_read_failed", "");
  });
});

describe("the resolved copy has no author, data, or component-prop input path", () => {
  it("takes exactly one argument — the host's bootstrap override", () => {
    expect(resolveNeutralCopy).toHaveLength(1);
  });

  it("has no slot an authored or data-carried name could select", () => {
    // Every lookalike below is the kind of string an agent could author, publish
    // into the Data Model, or declare as a component prop. None of them names a
    // copy slot, so none can add, replace, or select framework copy: the form is
    // closed and the answer is a rejection, never a new string on the page.
    const lookalikes = [
      "id",
      "facetPreparing",
      "preparing",
      "componentUnavailable",
      "corruptSubtree",
      "messageTooLong",
      "Preparing",
    ];
    for (const name of lookalikes) {
      rejected(resolveNeutralCopy({ [name]: "attacker copy" }), "unknown_copy_key", name);
    }
  });

  it("returns copy drawn only from the defaults or the host override", () => {
    const defaults = accepted(resolveNeutralCopy());
    const overridden = accepted(resolveNeutralCopy({ render: { corruptSubtree: "Unavailable" } }));
    expect(stringLeaves(defaults).map(([, value]) => value)).toEqual([
      NEUTRAL_COPY_DEFAULTS.render.preparing,
      NEUTRAL_COPY_DEFAULTS.render.componentUnavailable,
      NEUTRAL_COPY_DEFAULTS.render.corruptSubtree,
      NEUTRAL_COPY_DEFAULTS.validation.messageTooLong,
    ]);
    expect(stringLeaves(overridden).map(([, value]) => value)).toEqual([
      NEUTRAL_COPY_DEFAULTS.render.preparing,
      NEUTRAL_COPY_DEFAULTS.render.componentUnavailable,
      "Unavailable",
      NEUTRAL_COPY_DEFAULTS.validation.messageTooLong,
    ]);
  });
});
