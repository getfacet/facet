/**
 * The proof that the collect payload carries exactly what was named, and never
 * a secret.
 *
 * Four claims carry the weight here, and every one of them is a claim about
 * what the payload *cannot* contain.
 *
 * **A field the interaction did not name is never sent.** The list on the
 * activating component is the whole request; a store holding ten values answers
 * with the one that was asked for. That is the "explicit `collect` only" half of
 * DC-022, and it is asserted from the store side rather than the list side —
 * anything else would pass while the builder shipped a snapshot of the screen.
 *
 * **A sensitive value never reaches the payload.** The assertion is not "the
 * entry says `omitted_sensitive`" but "the marker string does not occur anywhere
 * in the serialized result, entries and issues alike". An exclusion that is true
 * of the entry and false of the diagnostics is not an exclusion (D-08).
 *
 * **A named field with no source is a stated absence, never a missing key.** The
 * closed entry union makes `collect_source_unavailable` the only honest answer,
 * and the test pins the key's *presence*: an agent must never be able to read a
 * dropped field as "the visitor left it blank".
 *
 * **Whatever the sources say, the payload validates.** The strongest available
 * statement about a builder feeding a validated boundary is that its output is
 * accepted by that boundary, so the hostile sweep at the end embeds each built
 * payload in an otherwise well-formed event and runs `validateVisitorEvent` over
 * it. `B-22` and `B-23` are read from `BOUNDS` on both sides, so the pair cannot
 * drift into two numbers.
 *
 * The suite runs in the **node** environment: this module is pure logic over
 * plain data, it renders nothing, and it touches no DOM. Its React counterpart
 * carries the jsdom docblock instead.
 */

import { BOUNDS, validateVisitorEvent } from "@facet/core";
import { describe, expect, it } from "vitest";

import type { CollectReader, CollectSource } from "./collect.js";
import { buildCollectPayload, parseCollectNames } from "./collect.js";

/** A value marker that is recognisable anywhere it leaks. */
const SECRET = "hunter2-correct-horse-battery-staple";

/** A reader over a fixed table, which is what a field store looks like from here. */
function readerOver(table: Readonly<Record<string, CollectSource>>): CollectReader {
  return (name) => table[name] ?? { kind: "unavailable" };
}

/** One accepted event around a built payload, so the boundary can judge it. */
function eventAround(collect: Record<string, unknown>): Record<string, unknown> {
  return {
    eventId: "01JBQ8Z5R7X",
    eventName: "submit",
    sourceNodeId: "n4",
    screen: "signup",
    stageRevision: 7,
    collect,
  };
}

/** `count` distinct legal collect names. */
function names(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => `field${index + 1}`);
}

describe("parseCollectNames", () => {
  it("collects nothing when the interaction names nothing", () => {
    for (const authored of [undefined, null, "", "   ", 7, true, {}, []]) {
      const parsed = parseCollectNames(authored);

      expect(parsed.names).toEqual([]);
      expect(parsed.issues).toEqual([]);
    }
  });

  it("reads a space-separated list in authored order", () => {
    expect(parseCollectNames("email password region").names).toEqual([
      "email",
      "password",
      "region",
    ]);
  });

  it("treats any run of whitespace as one separator", () => {
    expect(parseCollectNames("  email \t password \n region  ").names).toEqual([
      "email",
      "password",
      "region",
    ]);
  });

  it("names a field once however many times the list repeats it", () => {
    const parsed = parseCollectNames("email email email");

    expect(parsed.names).toEqual(["email"]);
    expect(parsed.issues).toEqual([]);
  });

  it("drops a token that is not a Facet identifier and says which position it was", () => {
    // The rejected token is never echoed back: the list is authored text, and a
    // diagnostic that quotes it would carry untrusted content into a structured
    // issue for no gain. The position is enough to find it.
    const parsed = parseCollectNames("email __proto__ region");

    expect(parsed.names).toEqual(["email", "region"]);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.code).toBe("invalid_collect_name");
    expect(parsed.issues[0]?.at).toBe("collect");
    expect(parsed.issues[0]?.detail).not.toContain("__proto__");
  });

  it("rejects a name past B-06 and accepts one at the limit", () => {
    const atLimit = `f${"x".repeat(BOUNDS.identifierChars - 1)}`;
    const pastLimit = `f${"x".repeat(BOUNDS.identifierChars)}`;

    expect(parseCollectNames(atLimit).names).toEqual([atLimit]);
    expect(parseCollectNames(pastLimit).names).toEqual([]);
    expect(parseCollectNames(pastLimit).issues[0]?.code).toBe("invalid_collect_name");
  });

  it("bounds corrupt collect lists without materializing every token", () => {
    const authored = names(100_000).join(" ");
    const parsed = parseCollectNames(authored);

    expect(parsed.names).toHaveLength(BOUNDS.collectFieldsPerEvent + 1);
    expect(parsed.names).toEqual([...names(BOUNDS.collectFieldsPerEvent + 1)]);
    expect(parsed.issues).toEqual([]);
  });

  it("bounds a huge malformed collect token without echoing it", () => {
    const parsed = parseCollectNames("x".repeat(100_000));

    expect(parsed.names).toEqual([]);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.code).toBe("invalid_collect_name");
    expect(JSON.stringify(parsed)).not.toContain("x".repeat(BOUNDS.identifierChars + 2));
  });
});

describe("buildCollectPayload", () => {
  it("sends only the named fields, whatever else the store holds", () => {
    const read = readerOver({
      email: { kind: "value", value: "ada@example.com" },
      region: { kind: "value", value: "north" },
      notes: { kind: "value", value: "unlisted" },
    });

    const built = buildCollectPayload("email region", read);

    expect(Object.keys(built.collect).sort()).toEqual(["email", "region"]);
    expect(built.collect["email"]).toEqual({ kind: "value", value: "ada@example.com" });
    expect(built.issues).toEqual([]);
  });

  it("sends an empty map when the interaction names no field", () => {
    const built = buildCollectPayload(
      undefined,
      readerOver({ email: { kind: "value", value: "a" } }),
    );

    expect(built.collect).toEqual({});
    expect(validateVisitorEvent(eventAround({ ...built.collect })).ok).toBe(true);
  });

  it("states an unavailable source instead of dropping the key", () => {
    const built = buildCollectPayload("email", readerOver({}));

    // The key's presence is the assertion. A dropped key would read to the agent
    // as "the visitor left it blank", which is the silent `{}` D-08 forbids.
    expect(Object.hasOwn(built.collect, "email")).toBe(true);
    expect(built.collect["email"]).toEqual({ kind: "collect_source_unavailable" });
  });

  it("excludes a sensitive value from every part of the result", () => {
    const read = readerOver({
      email: { kind: "value", value: "ada@example.com" },
      token: { kind: "sensitive" },
    });

    const built = buildCollectPayload("email token", read);

    expect(built.collect["token"]).toEqual({ kind: "omitted_sensitive" });
    // No `value` key at all, not a key holding `undefined`: an entry that
    // carries the key reads to a consumer as a value that happened to be empty.
    expect(Object.hasOwn(built.collect["token"] ?? {}, "value")).toBe(false);
  });

  it("excludes a sensitive value even when the source hands one over anyway", () => {
    // The store's sensitive source carries no value key at all, so this input is
    // unreachable through it. The builder is asserted against it regardless:
    // two independent locks are what make the exclusion survive one of them
    // being edited away.
    const rogue = { kind: "sensitive", value: SECRET } as unknown as CollectSource;
    const built = buildCollectPayload("token", readerOver({ token: rogue }));

    expect(built.collect["token"]).toEqual({ kind: "omitted_sensitive" });
    // `toEqual` ignores a key whose value is `undefined`, so an entry that grew
    // a `value` key holding nothing would slip past the line above. `hasOwn`
    // states the key's absence itself.
    expect(Object.hasOwn(built.collect["token"] ?? {}, "value")).toBe(false);
    expect(JSON.stringify(built)).not.toContain(SECRET);
  });

  it("carries a value at the B-23 limit and states an absence past it", () => {
    const atLimit = "v".repeat(BOUNDS.collectedValueChars);
    const pastLimit = "v".repeat(BOUNDS.collectedValueChars + 1);
    const read = readerOver({
      short: { kind: "value", value: atLimit },
      long: { kind: "value", value: pastLimit },
    });

    const built = buildCollectPayload("short long", read);

    expect(built.collect["short"]).toEqual({ kind: "value", value: atLimit });
    expect(built.collect["long"]).toEqual({ kind: "collect_source_unavailable" });
    expect(built.issues.map((issue) => issue.code)).toEqual(["collected_value_too_long"]);
    expect(built.issues[0]?.at).toBe("collect.long");
    // Truncating instead would hand the agent a plausible wrong value, which is
    // worse than a stated absence; the payload still has to validate.
    expect(validateVisitorEvent(eventAround({ ...built.collect })).ok).toBe(true);
  });

  it("carries booleans and frozen string arrays without coercion", () => {
    const selected = ["north", "west"];
    const built = buildCollectPayload(
      "enabled regions",
      readerOver({
        enabled: { kind: "value", value: true },
        regions: { kind: "value", value: selected },
      }),
    );

    selected.push("mutated-after-build");

    expect(built.collect["enabled"]).toEqual({ kind: "value", value: true });
    expect(built.collect["regions"]).toEqual({ kind: "value", value: ["north", "west"] });
    const regions = built.collect["regions"];
    expect(regions?.kind === "value" && Object.isFrozen(regions.value)).toBe(true);
    expect(validateVisitorEvent(eventAround({ ...built.collect })).ok).toBe(true);
  });

  it("reads a collected string array by bounded index, not through a hostile iterator", () => {
    const selected = ["north", "west"];
    Object.defineProperty(selected, Symbol.iterator, {
      value: (): never => {
        throw new Error("hostile iterator");
      },
    });

    const built = buildCollectPayload(
      "regions",
      readerOver({ regions: { kind: "value", value: selected } }),
    );

    expect(built.collect["regions"]).toEqual({
      kind: "value",
      value: ["north", "west"],
    });
  });

  it("states an absence for an over-bound collected string array", () => {
    const tooMany = Array.from(
      { length: BOUNDS.dataModelArrayLength + 1 },
      (_unused, index) => `choice${index}`,
    );
    const longItem = ["v".repeat(BOUNDS.collectedValueChars + 1)];

    const built = buildCollectPayload(
      "many long",
      readerOver({
        many: { kind: "value", value: tooMany },
        long: { kind: "value", value: longItem },
      }),
    );

    expect(built.collect["many"]).toEqual({ kind: "collect_source_unavailable" });
    expect(built.collect["long"]).toEqual({ kind: "collect_source_unavailable" });
    expect(built.issues.map((item) => item.code).sort()).toEqual([
      "collected_value_too_long",
      "too_many_collected_values",
    ]);
    expect(validateVisitorEvent(eventAround({ ...built.collect })).ok).toBe(true);
  });

  it("carries B-22 fields and reports the overflow past it", () => {
    const table: Record<string, CollectSource> = {};
    for (const name of names(BOUNDS.collectFieldsPerEvent + 1)) {
      table[name] = { kind: "value", value: name };
    }
    const read = readerOver(table);

    const atLimit = buildCollectPayload(names(BOUNDS.collectFieldsPerEvent).join(" "), read);
    const pastLimit = buildCollectPayload(names(BOUNDS.collectFieldsPerEvent + 1).join(" "), read);

    expect(Object.keys(atLimit.collect)).toHaveLength(BOUNDS.collectFieldsPerEvent);
    expect(atLimit.issues).toEqual([]);
    expect(Object.keys(pastLimit.collect)).toHaveLength(BOUNDS.collectFieldsPerEvent);
    expect(pastLimit.issues.map((issue) => issue.code)).toEqual(["too_many_collect_fields"]);
    // The kept set is the authored prefix, so the same list always sends the
    // same fields.
    expect(Object.keys(pastLimit.collect)).toEqual([...names(BOUNDS.collectFieldsPerEvent)]);
    expect(validateVisitorEvent(eventAround({ ...pastLimit.collect })).ok).toBe(true);
  });

  it("keeps a corrupt huge collect list to the B-22 payload prefix", () => {
    const table: Record<string, CollectSource> = {};
    for (const name of names(BOUNDS.collectFieldsPerEvent + 1)) {
      table[name] = { kind: "value", value: name };
    }

    const built = buildCollectPayload(names(100_000).join(" "), readerOver(table));

    expect(Object.keys(built.collect)).toEqual([...names(BOUNDS.collectFieldsPerEvent)]);
    expect(built.issues.map((issue) => issue.code)).toEqual(["too_many_collect_fields"]);
    expect(validateVisitorEvent(eventAround({ ...built.collect })).ok).toBe(true);
  });

  it("states an absence when the source itself throws", () => {
    const read: CollectReader = () => {
      throw new Error("the store is gone");
    };

    const built = buildCollectPayload("email", read);

    expect(built.collect["email"]).toEqual({ kind: "collect_source_unavailable" });
  });

  it("states an absence when the source answers with something outside the union", () => {
    const table = {
      a: undefined,
      b: null,
      c: "value",
      d: { kind: "nonsense" },
      e: { kind: "value" },
      f: { kind: "value", value: 7 },
      g: { value: "orphan" },
    } as unknown as Readonly<Record<string, CollectSource>>;

    const built = buildCollectPayload("a b c d e f g", readerOver(table));

    for (const name of ["a", "b", "c", "d", "e", "f", "g"]) {
      expect(built.collect[name]).toEqual({ kind: "collect_source_unavailable" });
    }
  });

  it("produces a frozen payload, byte-identical across repeat runs", () => {
    const read = readerOver({
      email: { kind: "value", value: "ada@example.com" },
      token: { kind: "sensitive" },
    });

    const first = buildCollectPayload("email token missing", read);
    const second = buildCollectPayload("email token missing", read);

    expect(Object.isFrozen(first.collect)).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("builds a payload the event boundary accepts, for every hostile list", () => {
    // The sensitive source is the **rogue** one, carrying a value it should not
    // have. Over a well-behaved `{ kind: "sensitive" }` the leak sweep below
    // would be vacuous — the marker would appear in no input, so nothing could
    // carry it out under any implementation. Handing the builder a value it must
    // refuse to read is what gives the sweep something to detect.
    const read = readerOver({
      email: { kind: "value", value: "ada@example.com" },
      token: { kind: "sensitive", value: SECRET } as unknown as CollectSource,
      long: { kind: "value", value: "v".repeat(BOUNDS.collectedValueChars + 1) },
    });
    const lists: readonly unknown[] = [
      undefined,
      "",
      "email",
      "email email email",
      "email __proto__ constructor prototype token",
      "  \t\n  ",
      "1nvalid email",
      `${"x".repeat(BOUNDS.identifierChars + 1)} email`,
      names(BOUNDS.collectFieldsPerEvent * 2).join(" "),
      "long email token missing",
      { toString: () => "email" },
      Symbol.iterator,
    ];

    for (const list of lists) {
      const built = buildCollectPayload(list, read);
      const result = validateVisitorEvent(eventAround({ ...built.collect }));

      expect(result.ok, `list ${String(typeof list)} produced a rejected payload`).toBe(true);
      expect(JSON.stringify(built)).not.toContain(SECRET);
    }
  });
});
