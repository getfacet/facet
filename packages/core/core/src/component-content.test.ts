import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type {
  ComponentContentClass,
  ComponentContentSpec,
  ComponentSlotSpec,
} from "./component-content.js";
import { deriveComponentContentClass, validateComponentContentSpec } from "./component-content.js";

function accept(value: unknown): ComponentContentSpec {
  const result = validateComponentContentSpec(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.content;
}

function rejection(value: unknown): readonly [string, string] {
  const result = validateComponentContentSpec(value);
  return result.ok ? ["accepted", "accepted"] : [result.code, result.at];
}

function slot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guidance: "The primary content region.",
    minChildren: 1,
    maxChildren: 4,
    ...overrides,
  };
}

describe("validateComponentContentSpec - accepted content branches", () => {
  it.each([
    [{ mode: "none" }, "Leaf"],
    [{ mode: "children" }, "Container"],
  ] as const)("accepts and derives the $mode branch", (source, expectedClass) => {
    const content = accept(source);
    const derived: ComponentContentClass = deriveComponentContentClass(content);

    expect(content).toEqual(source);
    expect(derived).toBe(expectedClass);
    expect(Object.isFrozen(content)).toBe(true);
  });

  it("accepts bounded named slots and derives Structured", () => {
    const content = accept({
      mode: "slots",
      slots: {
        actions: slot({
          guidance: "Commands available from the surface.",
          minChildren: 0,
          allowedTags: ["Button", "ActionGroup"],
        }),
        body: slot({ maxChildren: 16 }),
      },
    });

    expect(deriveComponentContentClass(content)).toBe("Structured");
    expect(content).toEqual({
      mode: "slots",
      slots: {
        actions: {
          guidance: "Commands available from the surface.",
          minChildren: 0,
          maxChildren: 4,
          allowedTags: ["Button", "ActionGroup"],
        },
        body: {
          guidance: "The primary content region.",
          minChildren: 1,
          maxChildren: 16,
        },
      },
    });
    if (content.mode !== "slots") {
      throw new Error("expected slots content");
    }
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.slots)).toBe(true);
    expect(Object.isFrozen(content.slots["actions"])).toBe(true);
    expect(Object.isFrozen(content.slots["actions"]?.allowedTags)).toBe(true);
  });

  it("keeps the public types usable independently of the validator", () => {
    const region: ComponentSlotSpec = {
      guidance: "Exactly one primary region.",
      minChildren: 1,
      maxChildren: 1,
    };
    const content: ComponentContentSpec = { mode: "slots", slots: { primary: region } };

    expect(deriveComponentContentClass(content)).toBe("Structured");
  });
});

describe("validateComponentContentSpec - closed branches", () => {
  it("requires one known mode", () => {
    expect(rejection({})).toEqual(["invalid_content_mode", "content.mode"]);
    expect(rejection({ mode: "container" })).toEqual(["invalid_content_mode", "content.mode"]);
  });

  it("rejects branch keys that do not belong to the selected mode", () => {
    expect(rejection({ mode: "none", slots: {} })).toEqual([
      "unknown_content_key",
      "content.slots",
    ]);
    expect(rejection({ mode: "children", extra: true })).toEqual([
      "unknown_content_key",
      "content.extra",
    ]);
    expect(rejection({ mode: "slots", slots: {}, extra: true })).toEqual([
      "unknown_content_key",
      "content.extra",
    ]);
  });

  it("requires at least one named slot for the slots branch", () => {
    expect(rejection({ mode: "slots" })).toEqual(["invalid_slots", "content.slots"]);
    expect(rejection({ mode: "slots", slots: [] })).toEqual(["invalid_slots", "content.slots"]);
    expect(rejection({ mode: "slots", slots: {} })).toEqual(["empty_slots", "content.slots"]);
  });

  it("rejects slot maps with inherited enumerable keys", () => {
    const slots = { body: slot() };
    Object.setPrototypeOf(slots, { inherited: slot() });

    expect(rejection({ mode: "slots", slots })).toEqual(["invalid_slots", "content.slots"]);
  });

  it("rejects unknown slot keys in sorted order", () => {
    const bad = {
      mode: "slots",
      slots: {
        body: slot({ zzz: true, aaa: true }),
      },
    };
    expect(rejection(bad)).toEqual(["unknown_slot_key", "content.slots.body.aaa"]);
    expect(validateComponentContentSpec(bad)).toEqual(validateComponentContentSpec(bad));
  });

  it("rejects an oversized slot descriptor before sorting all unknown keys", () => {
    const descriptor = Object.fromEntries(
      Array.from({ length: 100_000 }, (_, index) => [`unknown${index}`, true]),
    );
    const started = performance.now();

    expect(rejection({ mode: "slots", slots: { body: descriptor } })).toEqual([
      "unknown_slot_key",
      "content.slots.body",
    ]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("validateComponentContentSpec - bounded slots", () => {
  it("rejects a hostile slot map after the shared object-key bound", () => {
    const slots = Object.fromEntries(
      Array.from({ length: BOUNDS.dataModelObjectKeys + 1 }, (_, index) => [
        `slot${index}`,
        slot(),
      ]),
    );

    expect(rejection({ mode: "slots", slots })).toEqual(["too_many_slots", "content.slots"]);
  });

  it("requires Facet slot identifiers and reports sorted slot names first", () => {
    expect(
      rejection({
        mode: "slots",
        slots: { "bad slot": slot(), valid: { ...slot(), guidance: "" } },
      }),
    ).toEqual(["invalid_slot_name", "content.slots.bad slot"]);
  });

  it.each([
    [{ guidance: undefined }, "invalid_slot_guidance", "content.slots.body.guidance"],
    [{ guidance: "" }, "invalid_slot_guidance", "content.slots.body.guidance"],
    [
      { guidance: "g".repeat(BOUNDS.propGuidanceChars + 1) },
      "slot_guidance_too_long",
      "content.slots.body.guidance",
    ],
    [{ minChildren: -1 }, "invalid_slot_min_children", "content.slots.body.minChildren"],
    [{ minChildren: 1.5 }, "invalid_slot_min_children", "content.slots.body.minChildren"],
    [
      { maxChildren: BOUNDS.nodesPerDocument + 1 },
      "invalid_slot_max_children",
      "content.slots.body.maxChildren",
    ],
    [{ maxChildren: 1.5 }, "invalid_slot_max_children", "content.slots.body.maxChildren"],
  ] as const)("rejects an invalid bounded slot field", (override, code, at) => {
    expect(rejection({ mode: "slots", slots: { body: slot(override) } })).toEqual([code, at]);
  });

  it("rejects inverted child cardinality after validating both bounds", () => {
    expect(
      rejection({ mode: "slots", slots: { body: slot({ minChildren: 5, maxChildren: 4 }) } }),
    ).toEqual(["inverted_slot_cardinality", "content.slots.body"]);
  });

  it("accepts omitted allowedTags and a bounded explicit tag set", () => {
    const unrestricted = accept({ mode: "slots", slots: { body: slot() } });
    const restricted = accept({
      mode: "slots",
      slots: { body: slot({ allowedTags: ["Text", "Image"] }) },
    });

    expect(
      unrestricted.mode === "slots" && unrestricted.slots["body"]?.allowedTags,
    ).toBeUndefined();
    expect(restricted.mode === "slots" && restricted.slots["body"]?.allowedTags).toEqual([
      "Text",
      "Image",
    ]);
  });

  it.each([
    ["Text", "invalid_allowed_tags", "content.slots.body.allowedTags"],
    [[], "empty_allowed_tags", "content.slots.body.allowedTags"],
    [["bad tag"], "invalid_allowed_tag", "content.slots.body.allowedTags.0"],
    [["Screen"], "screen_not_allowed_in_slot", "content.slots.body.allowedTags.0"],
    [["Text", "Text"], "duplicate_allowed_tag", "content.slots.body.allowedTags.1"],
    [
      Array.from({ length: BOUNDS.componentsPerCatalog + 1 }, (_, index) => `Tag${index}`),
      "too_many_allowed_tags",
      "content.slots.body.allowedTags",
    ],
  ] as const)("rejects an invalid allowedTags declaration", (allowedTags, code, at) => {
    expect(rejection({ mode: "slots", slots: { body: slot({ allowedTags }) } })).toEqual([
      code,
      at,
    ]);
  });
});

describe("validateComponentContentSpec - totality", () => {
  it.each([undefined, null, 1, "children", [], new Date(0)])(
    "returns a structured rejection for %j",
    (value) => {
      expect(() => validateComponentContentSpec(value)).not.toThrow();
      expect(validateComponentContentSpec(value).ok).toBe(false);
    },
  );

  it("survives hostile getters and proxies", () => {
    const getter = {
      get mode(): never {
        throw new Error("boom");
      },
    };
    const proxy = new Proxy(
      { mode: "children" },
      {
        ownKeys(): never {
          throw new Error("boom");
        },
      },
    );

    expect(rejection(getter)).toEqual(["content_read_failed", "content"]);
    expect(rejection(proxy)).toEqual(["content_read_failed", "content"]);
  });
});
