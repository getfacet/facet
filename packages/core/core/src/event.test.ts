import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { validateVisitorEvent } from "./event.js";
import type { VisitorEvent, VisitorEventValidationResult } from "./event.js";

/**
 * The complete declared member set, sorted. D-07 counts the payload body as six
 * fields — `eventName`, `sourceNodeId`, `screen`, `stageRevision`, `arg?`,
 * `collect` — and WU-17 adds the client-stable `eventId` that keys dedupe, so a
 * payload without `arg` carries six keys and one with `arg` carries seven.
 * Both counts are asserted exactly below; nothing else may appear.
 */
const DECLARED_KEYS: readonly string[] = [
  "arg",
  "collect",
  "eventId",
  "eventName",
  "screen",
  "sourceNodeId",
  "stageRevision",
];

/** The same set minus the one optional member. */
const REQUIRED_KEYS: readonly string[] = DECLARED_KEYS.filter((key) => key !== "arg");

/** `ViewSnapshot` and every field it carried are deleted by D-07. */ // component-hard-cut: allowed-negative
const DELETED_VIEW_SNAPSHOT_KEYS: readonly string[] = ["colorMode", "sort", "toggled", "viewport"];

/** The exact key set of a rejection — one structured error, never a list. */
const REJECTION_KEYS: readonly string[] = ["at", "code", "detail", "ok"];

/** The module source, read once — the single-source and privacy scans both read it. */
const SOURCE = readFileSync(new URL("./event.ts", import.meta.url), "utf8");

/**
 * The default fixture is a **bare ULID**, deliberately: `eventId` is an opaque
 * client idempotency token, and no prefix is required of anything that mints
 * one. A downstream WU minting `01HZ...` straight from a ULID library is
 * correct; so is a prefixed `e-...`. Both are exercised below.
 */
const BARE_ULID = "01HZXQ7M9CABCDEFGHJKMNPQRS";

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: BARE_ULID,
    eventName: "refresh",
    sourceNodeId: "n4",
    screen: "dashboard",
    stageRevision: 7,
    collect: {},
    ...overrides,
  };
}

function accept(value: unknown): VisitorEvent {
  const result = validateVisitorEvent(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.event;
}

function rejection(value: unknown): string {
  const result = validateVisitorEvent(value);
  return result.ok ? "accepted" : result.code;
}

function rejectionAt(value: unknown): string {
  const result = validateVisitorEvent(value);
  return result.ok ? "accepted" : result.at;
}

function sortedKeys(value: object): readonly string[] {
  return Object.keys(value).sort();
}

/** `count` collected fields, each a legal value entry. */
function collectOf(count: number): Record<string, unknown> {
  const collect: Record<string, unknown> = {};
  for (let index = 1; index <= count; index += 1) {
    collect[`f${index}`] = { kind: "value", value: "x" };
  }
  return collect;
}

function textOf(length: number): string {
  return "v".repeat(length);
}

describe("VisitorEvent payload shape (D-07)", () => {
  it("accepts a well-formed event and carries exactly the declared fields", () => {
    const accepted = accept(event());
    expect(sortedKeys(accepted)).toEqual(REQUIRED_KEYS);
    expect(sortedKeys(accepted)).toHaveLength(6);
    expect(accepted.eventId).toBe(BARE_ULID);
    expect(accepted.eventName).toBe("refresh");
    expect(accepted.sourceNodeId).toBe("n4");
    expect(accepted.screen).toBe("dashboard");
    expect(accepted.stageRevision).toBe(7);
    expect(accepted.collect).toEqual({});
  });

  it("carries exactly seven keys once the one optional member is present", () => {
    const accepted = accept(event({ arg: "monthly" }));
    expect(sortedKeys(accepted)).toEqual(DECLARED_KEYS);
    expect(sortedKeys(accepted)).toHaveLength(7);
    expect(accepted.arg).toBe("monthly");
  });

  it("never injects an absent optional member", () => {
    const accepted = accept(event());
    expect("arg" in accepted).toBe(false);
  });

  it("has no toggled, sort, viewport or colorMode member from the deleted view snapshot", () => {
    const accepted = accept(event({ arg: "monthly" }));
    for (const deleted of DELETED_VIEW_SNAPSHOT_KEYS) {
      expect(deleted in accepted).toBe(false);
      expect(DECLARED_KEYS).not.toContain(deleted);
    }
  });

  it.each(DELETED_VIEW_SNAPSHOT_KEYS)("rejects a payload carrying %s", (deleted) => {
    const value = event({ [deleted]: "anything" });
    expect(rejection(value)).toBe("unknown_event_key");
    expect(rejectionAt(value)).toBe(deleted);
  });

  it("rejects any other unknown key — the payload form is closed", () => {
    expect(rejection(event({ viewState: {} }))).toBe("unknown_event_key");
    expect(rejectionAt(event({ viewState: {} }))).toBe("viewState");
  });

  it("names the first unknown key in sorted order, so the rejection is deterministic", () => {
    const value = event({ zeta: 1, alpha: 1 });
    expect(rejectionAt(value)).toBe("alpha");
    expect(rejectionAt(value)).toBe(rejectionAt({ ...value }));
  });

  it("freezes the accepted event and its collect map", () => {
    const accepted = accept(event({ collect: { amount: { kind: "value", value: "12" } } }));
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.collect)).toBe(true);
  });

  it("rejects a payload that omits collect — an empty map is stated, never inferred", () => {
    const withoutCollect: Record<string, unknown> = event();
    delete withoutCollect["collect"];
    expect(rejection(withoutCollect)).toBe("invalid_collect");
  });

  it.each(["eventId", "eventName", "sourceNodeId", "screen", "stageRevision"])(
    "rejects a payload that omits %s",
    (key) => {
      const value: Record<string, unknown> = event();
      delete value[key];
      expect(validateVisitorEvent(value).ok).toBe(false);
    },
  );
});

/**
 * `eventId` is an **opaque client idempotency token**, not an authored Facet
 * name, so it takes its own grammar: it may start with a digit, which the
 * identifier grammar forbids. Rejecting a bare ULID or UUID — the two things a
 * client is overwhelmingly likely to mint — would be integration friction
 * buying nothing, because the one property D-01 actually needs is the colon
 * ban, and that survives on its own.
 */
describe("eventId format", () => {
  it.each([
    { label: "a bare ULID", eventId: BARE_ULID },
    { label: "a bare lowercase UUID", eventId: "4f47ac10-b58c-c000-8000-000000000000" },
    { label: "a bare uppercase UUID", eventId: "4F47AC10-B58C-C000-8000-000000000000" },
    { label: "a UUID starting with a letter", eventId: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
    { label: "an event-prefixed id", eventId: "e-01HZXQ7M9C" },
    { label: "a visitor-prefixed id", eventId: "v-01HZXQ7M9C" },
    { label: "a short id", eventId: "e1" },
    { label: "an underscored id", eventId: "event_7" },
    { label: "an all-digit id", eventId: "1730000000000" },
  ])("accepts $label", ({ eventId }) => {
    expect(accept(event({ eventId })).eventId).toBe(eventId);
  });

  it("rejects an id carrying the messageId separator, in bare and prefixed form", () => {
    // `turnId = eventId` and `messageId = `${turnId}:${role}``, so a colon in the
    // id would make the derived messageId ambiguous. This is the one property
    // D-01 needs from the grammar, and it does not depend on the first character.
    expect(rejection(event({ eventId: "e-7:assistant" }))).toBe("invalid_event_id");
    expect(rejection(event({ eventId: "01HZXQ7M9C:assistant" }))).toBe("invalid_event_id");
    expect(rejection(event({ eventId: ":" }))).toBe("invalid_event_id");
  });

  it.each([
    { label: "an empty id", eventId: "" },
    { label: "a prototype-shaped id", eventId: "__proto__" },
    { label: "an id leading with an underscore", eventId: "_01HZXQ7M9C" },
    { label: "an id leading with a hyphen", eventId: "-01HZXQ7M9C" },
    { label: "an id with an inner space", eventId: "e 7" },
    { label: "an id with a leading space", eventId: " e7" },
    { label: "an id with a trailing newline", eventId: "e7\n" },
    { label: "an id with a tab", eventId: "e\t7" },
    { label: "a non-ASCII id", eventId: "évent7" },
    { label: "an id with a non-ASCII digit", eventId: "e٧" },
    { label: "a dotted id", eventId: "e.7" },
    { label: "a slashed id", eventId: "e/7" },
    { label: "an id with a NUL", eventId: "e\u00007" },
    { label: "a non-string id", eventId: 7 },
    { label: "a null id", eventId: null },
    { label: "an object id", eventId: {} },
  ])("rejects $label", ({ eventId }) => {
    expect(rejection(event({ eventId }))).toBe("invalid_event_id");
    expect(rejectionAt(event({ eventId }))).toBe("eventId");
  });

  it("accepts a digit-leading id of exactly B-06 characters and rejects one past it", () => {
    const atLimit = `0${"x".repeat(BOUNDS.identifierChars - 1)}`;
    const pastLimit = `${atLimit}x`;
    expect(atLimit).toHaveLength(BOUNDS.identifierChars);
    expect(pastLimit).toHaveLength(BOUNDS.identifierChars + 1);
    expect(accept(event({ eventId: atLimit })).eventId).toBe(atLimit);
    expect(rejection(event({ eventId: pastLimit }))).toBe("invalid_event_id");
  });

  it("keeps the id grammar separate from the identifier grammar", () => {
    // The divergence is exactly the first character, and it is one-directional:
    // a digit-leading id is a legal `eventId` and an illegal Facet name. Pinning
    // both halves stops a later edit from quietly collapsing the two grammars —
    // in either direction.
    for (const digitLeading of [BARE_ULID, "4f47ac10-b58c-c000-8000-000000000000", "7"]) {
      expect(accept(event({ eventId: digitLeading })).eventId).toBe(digitLeading);
      for (const named of ["eventName", "sourceNodeId", "screen"]) {
        expect(validateVisitorEvent(event({ [named]: digitLeading })).ok).toBe(false);
        expect(rejectionAt(event({ [named]: digitLeading }))).toBe(named);
      }
    }
    // Everything the identifier grammar forbids beyond that first character is
    // still forbidden for an id.
    for (const shared of ["", "a:b", "user.name", "__proto__", " lead"]) {
      expect(rejection(event({ eventId: shared }))).toBe("invalid_event_id");
      expect(validateVisitorEvent(event({ eventName: shared })).ok).toBe(false);
    }
  });

  it("keeps the id grammar private — it is not a second exported name-checker", () => {
    expect(SOURCE).toMatch(/^const EVENT_ID_PATTERN =/m);
    expect(SOURCE).not.toMatch(/^export (const|function) EVENT_ID|^export function isEventId/m);
  });
});

describe("eventName, sourceNodeId and screen", () => {
  it.each([
    { field: "eventName", code: "invalid_event_name" },
    { field: "sourceNodeId", code: "invalid_source_node_id" },
    { field: "screen", code: "invalid_screen" },
  ])("rejects a $field that is not a Facet identifier", ({ field, code }) => {
    for (const bad of ["", "a:b", "user.name", "__proto__", " lead", 7, null, {}]) {
      expect(rejection(event({ [field]: bad }))).toBe(code);
      expect(rejectionAt(event({ [field]: bad }))).toBe(field);
    }
  });

  it("accepts a generated node id and a declared screen name", () => {
    const accepted = accept(event({ sourceNodeId: "n412", screen: "orderDetail" }));
    expect(accepted.sourceNodeId).toBe("n412");
    expect(accepted.screen).toBe("orderDetail");
  });
});

describe("stageRevision", () => {
  it("accepts a fresh session's revision and a later one", () => {
    expect(accept(event({ stageRevision: 0 })).stageRevision).toBe(0);
    expect(accept(event({ stageRevision: 4_096 })).stageRevision).toBe(4_096);
  });

  it.each([
    { label: "a fractional revision", stageRevision: 1.5 },
    { label: "a negative revision", stageRevision: -1 },
    { label: "NaN", stageRevision: Number.NaN },
    { label: "Infinity", stageRevision: Number.POSITIVE_INFINITY },
    { label: "an unsafe integer", stageRevision: Number.MAX_SAFE_INTEGER + 2 },
    { label: "a numeric string", stageRevision: "7" },
    { label: "a bigint-shaped object", stageRevision: {} },
    { label: "an absent revision", stageRevision: undefined },
  ])("rejects $label", ({ stageRevision }) => {
    expect(rejection(event({ stageRevision }))).toBe("invalid_stage_revision");
    expect(rejectionAt(event({ stageRevision }))).toBe("stageRevision");
  });
});

describe("collect entries (D-08)", () => {
  it("accepts a collected value", () => {
    const accepted = accept(event({ collect: { amount: { kind: "value", value: "12" } } }));
    expect(accepted.collect["amount"]).toEqual({ kind: "value", value: "12" });
  });

  it("accepts boolean and string-array collected values", () => {
    const accepted = accept(
      event({
        collect: {
          enabled: { kind: "value", value: true },
          interests: { kind: "value", value: ["analytics", "commerce"] },
        },
      }),
    );

    expect(accepted.collect["enabled"]).toEqual({ kind: "value", value: true });
    expect(accepted.collect["interests"]).toEqual({
      kind: "value",
      value: ["analytics", "commerce"],
    });
    const interests = accepted.collect["interests"];
    expect(interests?.kind === "value" && Array.isArray(interests.value)).toBe(true);
    if (interests?.kind === "value" && Array.isArray(interests.value)) {
      expect(Object.isFrozen(interests.value)).toBe(true);
    }
  });

  it("preserves a collect_source_unavailable entry rather than dropping it", () => {
    // D-08: a collectable node that never registers yields a structured error,
    // never a silent `{}` — the agent must be able to see that the value is
    // missing rather than read an absent key as "the visitor left it blank".
    const accepted = accept(event({ collect: { amount: { kind: "collect_source_unavailable" } } }));
    expect(accepted.collect["amount"]).toEqual({ kind: "collect_source_unavailable" });
    expect(Object.keys(accepted.collect)).toEqual(["amount"]);
    expect(accepted.collect).not.toEqual({});
  });

  it("preserves an omitted_sensitive entry and refuses one carrying the value", () => {
    const accepted = accept(event({ collect: { secret: { kind: "omitted_sensitive" } } }));
    expect(accepted.collect["secret"]).toEqual({ kind: "omitted_sensitive" });
    const leaking = event({
      collect: { secret: { kind: "omitted_sensitive", value: "hunter2" } },
    });
    expect(rejection(leaking)).toBe("unknown_collect_entry_key");
    expect(rejectionAt(leaking)).toBe("collect.secret.value");
  });

  it("accepts an empty collect — an event that names no field collects nothing", () => {
    expect(accept(event({ collect: {} })).collect).toEqual({});
  });

  it.each([
    { label: "an unknown entry kind", entry: { kind: "raw", value: "x" } },
    { label: "a missing kind", entry: { value: "x" } },
    { label: "a numeric collected value", entry: { kind: "value", value: 12 } },
    { label: "an object collected value", entry: { kind: "value", value: {} } },
    { label: "a mixed collected array", entry: { kind: "value", value: ["valid", false] } },
    { label: "a value entry with no value", entry: { kind: "value" } },
    { label: "a non-object entry", entry: "x" },
    { label: "a null entry", entry: null },
    { label: "an array entry", entry: [] },
  ])("rejects $label", ({ entry }) => {
    expect(validateVisitorEvent(event({ collect: { amount: entry } })).ok).toBe(false);
  });

  it("rejects an unknown key on a collect entry — the entry form is closed", () => {
    const value = event({ collect: { amount: { kind: "value", value: "1", unit: "usd" } } });
    expect(rejection(value)).toBe("unknown_collect_entry_key");
    expect(rejectionAt(value)).toBe("collect.amount.unit");
  });

  it.each(["", "a:b", "user.name", "__proto__", " amount", "amount!"])(
    "rejects the disallowed collect name %j",
    (name) => {
      const value = event({ collect: { [name]: { kind: "value", value: "x" } } });
      expect(rejection(value)).toBe("invalid_collect_name");
      expect(rejectionAt(value)).toBe(`collect.${name}`);
    },
  );

  it("rejects a collect name past B-06", () => {
    const pastLimit = `f${"x".repeat(BOUNDS.identifierChars)}`;
    expect(pastLimit).toHaveLength(BOUNDS.identifierChars + 1);
    expect(rejection(event({ collect: { [pastLimit]: { kind: "value", value: "x" } } }))).toBe(
      "invalid_collect_name",
    );
  });

  it.each([
    { label: "an array", collect: [] },
    { label: "a string", collect: "x" },
  ])("rejects a collect map that is $label", ({ collect }) => {
    expect(rejection(event({ collect }))).toBe("invalid_collect");
    expect(rejectionAt(event({ collect }))).toBe("collect");
  });
});

describe("B-22 — collect fields per event (DC-026, browser half)", () => {
  it("accepts exactly B-22 collected fields", () => {
    const atLimit = collectOf(BOUNDS.collectFieldsPerEvent);
    expect(Object.keys(atLimit)).toHaveLength(BOUNDS.collectFieldsPerEvent);
    expect(Object.keys(accept(event({ collect: atLimit })).collect)).toHaveLength(
      BOUNDS.collectFieldsPerEvent,
    );
  });

  it("rejects one field past B-22", () => {
    const pastLimit = collectOf(BOUNDS.collectFieldsPerEvent + 1);
    expect(Object.keys(pastLimit)).toHaveLength(BOUNDS.collectFieldsPerEvent + 1);
    expect(rejection(event({ collect: pastLimit }))).toBe("too_many_collect_fields");
    expect(rejectionAt(event({ collect: pastLimit }))).toBe("collect");
  });

  it("separates the accepted and rejected fixtures by exactly one field", () => {
    const accepted = Object.keys(collectOf(BOUNDS.collectFieldsPerEvent)).length;
    const rejected = Object.keys(collectOf(BOUNDS.collectFieldsPerEvent + 1)).length;
    expect(rejected - accepted).toBe(1);
    expect(accepted).toBe(BOUNDS.collectFieldsPerEvent);
  });
});

describe("B-23 — collected value and arg length (DC-026, browser half)", () => {
  it("accepts a collected value of exactly B-23 characters", () => {
    const atLimit = textOf(BOUNDS.collectedValueChars);
    expect(atLimit).toHaveLength(BOUNDS.collectedValueChars);
    const accepted = accept(event({ collect: { note: { kind: "value", value: atLimit } } }));
    expect(accepted.collect["note"]).toEqual({ kind: "value", value: atLimit });
  });

  it("rejects a collected value one character past B-23", () => {
    const pastLimit = textOf(BOUNDS.collectedValueChars + 1);
    expect(pastLimit).toHaveLength(BOUNDS.collectedValueChars + 1);
    const value = event({ collect: { note: { kind: "value", value: pastLimit } } });
    expect(rejection(value)).toBe("collected_value_too_long");
    expect(rejectionAt(value)).toBe("collect.note.value");
  });

  it("applies B-23 to every collected string-array item", () => {
    const atLimit = textOf(BOUNDS.collectedValueChars);
    const accepted = accept(
      event({ collect: { tags: { kind: "value", value: [atLimit, "short"] } } }),
    );
    expect(accepted.collect["tags"]).toEqual({
      kind: "value",
      value: [atLimit, "short"],
    });

    const pastLimit = textOf(BOUNDS.collectedValueChars + 1);
    const rejected = event({
      collect: { tags: { kind: "value", value: ["short", pastLimit] } },
    });
    expect(rejection(rejected)).toBe("collected_value_too_long");
    expect(rejectionAt(rejected)).toBe("collect.tags.value[1]");
  });

  it("bounds collected string-array item count with the existing array bound", () => {
    const atLimit = new Array(BOUNDS.dataModelArrayLength).fill("value");
    expect(
      accept(event({ collect: { tags: { kind: "value", value: atLimit } } })).collect["tags"],
    ).toEqual({ kind: "value", value: atLimit });

    const pastLimit = [...atLimit, "one-more"];
    const rejected = event({ collect: { tags: { kind: "value", value: pastLimit } } });
    expect(rejection(rejected)).toBe("too_many_collected_values");
    expect(rejectionAt(rejected)).toBe("collect.tags.value");
  });

  it("accepts an arg of exactly B-23 characters", () => {
    const atLimit = textOf(BOUNDS.collectedValueChars);
    expect(accept(event({ arg: atLimit })).arg).toBe(atLimit);
  });

  it("rejects an arg one character past B-23", () => {
    const pastLimit = textOf(BOUNDS.collectedValueChars + 1);
    expect(rejection(event({ arg: pastLimit }))).toBe("arg_too_long");
    expect(rejectionAt(event({ arg: pastLimit }))).toBe("arg");
  });

  it("separates every accepted and rejected fixture by exactly one character", () => {
    expect(
      textOf(BOUNDS.collectedValueChars + 1).length - textOf(BOUNDS.collectedValueChars).length,
    ).toBe(1);
    expect(textOf(BOUNDS.collectedValueChars)).toHaveLength(BOUNDS.collectedValueChars);
  });

  it.each([
    { label: "a non-string arg", arg: 7 },
    { label: "an explicitly undefined arg", arg: undefined },
    { label: "a null arg", arg: null },
  ])("rejects $label", ({ arg }) => {
    expect(rejection(event({ arg }))).toBe("invalid_arg");
    expect(rejectionAt(event({ arg }))).toBe("arg");
  });

  it("accepts an empty arg — an explicit empty argument is not an absent one", () => {
    expect(accept(event({ arg: "" })).arg).toBe("");
  });
});

describe("B-22/B-23 are single-sourced", () => {
  const source = readFileSync(new URL("./event.ts", import.meta.url), "utf8");

  it("reads both bounds from BOUNDS", () => {
    expect(source).toContain('import { BOUNDS } from "./bounds.js"');
    expect(source).toContain("BOUNDS.collectFieldsPerEvent");
    expect(source).toContain("BOUNDS.collectedValueChars");
  });

  it("restates neither limit as a local literal", () => {
    expect(source).not.toMatch(/\b32\b/);
    expect(source).not.toMatch(/\b2_?000\b/);
  });

  it("exposes exactly one validator, so renderer collection and server /event agree", async () => {
    const module: Record<string, unknown> = await import("./event.js");
    expect(Object.keys(module).sort()).toEqual(["validateVisitorEvent"]);
    expect(typeof module["validateVisitorEvent"]).toBe("function");
  });
});

describe("B-27 — aggregate visitor event JSON bytes", () => {
  it("rejects an individually valid string array before it can exceed the transport body", () => {
    const item = textOf(BOUNDS.collectedValueChars);
    const oversized = new Array(3_000).fill(item);
    const candidate = event({ collect: { tags: { kind: "value", value: oversized } } });

    expect(Buffer.byteLength(JSON.stringify(candidate), "utf8")).toBeGreaterThan(
      BOUNDS.visitorEventJsonBytes,
    );
    expect(rejection(candidate)).toBe("event_payload_too_large");
    expect(rejectionAt(candidate)).toMatch(/^collect\.tags\.value\[\d+\]$/);
  });

  it("keeps a substantial bounded array valid below the aggregate limit", () => {
    const item = textOf(BOUNDS.collectedValueChars);
    const candidate = event({
      collect: { tags: { kind: "value", value: new Array(1_000).fill(item) } },
    });

    expect(Buffer.byteLength(JSON.stringify(candidate), "utf8")).toBeLessThan(
      BOUNDS.visitorEventJsonBytes,
    );
    expect(rejection(candidate)).toBe("accepted");
  });

  it("counts surrogate pairs, multibyte text, and escaped controls at the byte boundary", () => {
    const wide = "🙂".repeat(1_000);
    const exactTail = `${"\n".repeat(310)}x`;
    const values = [...new Array<string>(999).fill(wide), exactTail];
    const atBoundary = event({ collect: { tags: { kind: "value", value: values } } });
    const oneByteOver = event({
      collect: { tags: { kind: "value", value: [...values.slice(0, -1), `${exactTail}x`] } },
    });

    expect(rejection(atBoundary)).toBe("accepted");
    expect(rejection(oneByteOver)).toBe("event_payload_too_large");
    expect(rejectionAt(oneByteOver)).toBe("collect.tags.value[999]");
  });
});

describe("validateVisitorEvent totality", () => {
  const throwingGetter: Record<string, unknown> = {};
  Object.defineProperty(throwingGetter, "eventId", {
    enumerable: true,
    get() {
      throw new Error("hostile");
    },
  });

  const cyclicCollect: Record<string, unknown> = {};
  cyclicCollect["self"] = cyclicCollect;

  const hostileKeys = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("hostile");
      },
    },
  );

  it.each([
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "a number", value: 42 },
    { label: "a string", value: "event" },
    { label: "a boolean", value: true },
    { label: "an array", value: [] },
    { label: "a function", value: () => undefined },
    { label: "a throwing getter", value: throwingGetter },
    { label: "a proxy with throwing ownKeys", value: hostileKeys },
    { label: "a cyclic collect map", value: event({ collect: cyclicCollect }) },
    {
      label: "a self-referential payload",
      value: (() => {
        const self: Record<string, unknown> = event();
        self["self"] = self;
        return self;
      })(),
    },
  ])("never throws for $label", ({ value }) => {
    let result: VisitorEventValidationResult | undefined;
    expect(() => {
      result = validateVisitorEvent(value);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  it("carries exactly one structured error, never an aggregated list", () => {
    const result = validateVisitorEvent({ eventId: "e-1", eventName: "!", screen: "!" });
    expect(result.ok).toBe(false);
    expect(sortedKeys(result)).toEqual(REJECTION_KEYS);
    if (result.ok) {
      return;
    }
    expect(typeof result.code).toBe("string");
    expect(result.code.length).toBeGreaterThan(0);
    expect(typeof result.at).toBe("string");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("accepts a valid event, so the rejection assertions above are not vacuous", () => {
    const result = validateVisitorEvent(event({ arg: "monthly" }));
    expect(result.ok).toBe(true);
    expect(sortedKeys(result)).toEqual(["event", "ok"]);
  });

  it("returns the same first failure for the same input on every run", () => {
    const value = event({ eventName: "!", screen: "!", stageRevision: -1 });
    const first = validateVisitorEvent(value);
    const second = validateVisitorEvent({ ...value });
    expect(first).toEqual(second);
  });

  it("does not mutate the value it was given", () => {
    const value = event({ collect: { amount: { kind: "value", value: "12" } } });
    const before = JSON.stringify(value);
    validateVisitorEvent(value);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.isFrozen(value)).toBe(false);
  });
});
