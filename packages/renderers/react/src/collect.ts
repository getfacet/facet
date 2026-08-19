/**
 * The collect payload — exactly the fields an interaction named, each with its
 * own stated outcome.
 *
 * The list an activating component writes is the **whole** request. A screen
 * holding ten values sends the two that were named and says nothing about the
 * rest, which is the "explicit `collect` only" half of DC-022: there is no
 * ambient snapshot of what the visitor has typed, so an agent learns a value
 * only by asking for it by name.
 *
 * Every named field produces a key. A field with no live source is reported as
 * `collect_source_unavailable` rather than left out, because a missing key would
 * read to the agent as "the visitor left it blank" — the silent `{}` D-08
 * exists to prevent. A field the catalog marked sensitive is reported as
 * `omitted_sensitive`, with **no value key at all**.
 *
 * That exclusion is the one thing in this module that must not be possible to
 * get wrong, so it is enforced twice by two modules that do not depend on each
 * other's correctness. `field-store.ts` answers a sensitive field with a source
 * that **carries no value** — there is nothing here to leak — and this module
 * still maps that kind to `omitted_sensitive` without ever reading a value from
 * the source. Removing either lock leaves the other holding.
 *
 * `B-22` and `B-23` are read from `@facet/core`'s `BOUNDS`, the same frozen
 * table `validateVisitorEvent` and the server's mirror read. Nothing here restates
 * a limit as a literal, and the suite's closing sweep states the property that
 * makes the pair meaningful: whatever the sources say, the payload this module
 * builds is accepted by the event boundary.
 *
 * Every function is **total**: a source that throws, answers with something
 * outside the closed union, or hands back a value past `B-23` yields a stated
 * absence rather than an exception or a corrupted payload.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point.
 */

import type { CollectedValue, VisitorEvent } from "@facet/core";
import { BOUNDS, isFacetIdentifier } from "@facet/core";

/**
 * What a field is, seen from the payload.
 *
 * The three kinds mirror the three outcomes an event entry can carry, and the
 * sensitive branch is deliberately **valueless**: a source that has nothing to
 * hand over cannot hand it over by mistake.
 */
export type CollectSource =
  | { readonly kind: "value"; readonly value: CollectedValue }
  | { readonly kind: "sensitive" }
  | { readonly kind: "unavailable" };

/** How the payload asks for one field. The field store is the only implementation. */
export type CollectReader = (name: string) => CollectSource;

/**
 * One thing the renderer could not do as written.
 *
 * Issues are **renderer-local diagnostics**, not part of the event: an
 * over-long list or an unwritable name is a fact about the authored markup, and
 * the payload still has to be sendable. The shape mirrors core's rejection
 * branch so both read the same way. No issue ever echoes authored text back —
 * a position or a validated identifier is enough to find the cause.
 */
export interface CollectIssue {
  readonly code: string;
  readonly at: string;
  readonly detail: string;
}

/** The parsed collect list: the names to ask for, and what was dropped. */
export interface CollectNames {
  readonly names: readonly string[];
  readonly issues: readonly CollectIssue[];
}

/** The built payload and the diagnostics from building it. */
export interface CollectPayload {
  readonly collect: VisitorEvent["collect"];
  readonly issues: readonly CollectIssue[];
}

/** One entry of the payload, derived from the event contract so the two cannot drift. */
type CollectEntry = VisitorEvent["collect"][string];

/** The closed source vocabulary, derived from the public union for the same reason. */
const SOURCE_KINDS: readonly CollectSource["kind"][] = ["value", "sensitive", "unavailable"];
const PARSED_COLLECT_NAME_LIMIT = BOUNDS.collectFieldsPerEvent + 1;
const COLLECT_LIST_SCAN_CHARS = PARSED_COLLECT_NAME_LIMIT * (BOUNDS.identifierChars + 1);

/** Whatever a source answered with, when it answered with nothing usable. */
const UNAVAILABLE: CollectSource = Object.freeze({ kind: "unavailable" });

function issue(code: string, at: string, detail: string): CollectIssue {
  return Object.freeze({ code, at, detail });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows whatever a reader returned to the closed source union.
 *
 * A `value` source must carry one branch of `CollectedValue`; every other shape
 * becomes a stated absence. Bounds are checked while building the payload so a
 * valid source can produce a precise renderer-local issue.
 */
function asSource(value: unknown): CollectSource | null {
  if (!isRecord(value)) return null;
  const kind = SOURCE_KINDS.find((candidate) => candidate === value["kind"]);
  if (kind === undefined) return null;
  if (kind !== "value") return { kind };
  const collected = value["value"];
  if (typeof collected === "string" || typeof collected === "boolean") {
    return { kind, value: collected };
  }
  if (!Array.isArray(collected)) {
    return null;
  }
  const length = collected.length;
  if (length > BOUNDS.dataModelArrayLength) {
    return {
      kind,
      value: Object.freeze(Array.from({ length: BOUNDS.dataModelArrayLength + 1 }, () => "")),
    };
  }
  const items: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = collected[index];
    if (typeof item !== "string") {
      return null;
    }
    items.push(item);
  }
  return { kind, value: Object.freeze(items) };
}

/** Asks one source, treating a throwing reader as a source that is not there. */
function readSource(name: string, read: CollectReader): CollectSource {
  try {
    return asSource(read(name)) ?? UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Reads the authored collect list.
 *
 * The list is space-separated names and nothing else, so any run of whitespace
 * separates and a name is kept once however often it is written.
 *
 * **`collect` is a reserved framework prop, not an ordinary one**, and author
 * validation rejects a bad list **atomically** at author time — on a malformed
 * identifier, an over-`B-22` list, an unknown name, a cross-screen name, or an
 * ambiguous duplicate (WU-13). Against a validated document this function
 * therefore only ever sees a well-formed list, and the drop-and-report branches
 * below are **not** the acceptance path for an authored fault. They are totality
 * guards for the other input the renderer must survive — corrupt persisted
 * state, which degrades to a bounded safe subset with structured issues rather
 * than throwing (core invariant 3) — and for a non-string list that no validated
 * document can produce. Dropping rather than forwarding is the safe direction:
 * the event boundary rejects an illegal collect name outright, so passing one
 * through would take an otherwise valid interaction down with it.
 *
 * The report names the position rather than quoting the token — a diagnostic
 * that echoes authored text carries untrusted content for no gain.
 *
 * These renderer-local issue codes are a third vocabulary, distinct from both
 * author-side codes: `nonconforming_collect_request` answers "is the **catalog
 * declaration** conforming?" and `invalid-value` (discriminated by its repair
 * string) answers "is the **authored value** legal?". Neither is emitted here,
 * and `collect_source_unavailable` is a **runtime** entry kind, not an
 * author-time verdict.
 */
export function parseCollectNames(authored: unknown): CollectNames {
  if (typeof authored !== "string") {
    return { names: [], issues: [] };
  }
  const names: string[] = [];
  const seen = new Set<string>();
  const issues: CollectIssue[] = [];
  let token = "";
  let tokenTooLong = false;
  let position = 0;
  let stopped = false;

  const finishToken = (): void => {
    if (token.length === 0 && !tokenTooLong) return;
    position += 1;
    if (tokenTooLong || !isFacetIdentifier(token)) {
      issues.push(
        issue(
          "invalid_collect_name",
          "collect",
          `Name ${position} of the collect list is not a Facet identifier.`,
        ),
      );
    } else if (!seen.has(token)) {
      seen.add(token);
      names.push(token);
      if (names.length >= PARSED_COLLECT_NAME_LIMIT) {
        stopped = true;
      }
    }
    token = "";
    tokenTooLong = false;
  };

  for (let index = 0; index < authored.length && !stopped; index += 1) {
    if (index >= COLLECT_LIST_SCAN_CHARS) {
      issues.push(
        issue("invalid_collect_name", "collect", "The collect list is too large to read safely."),
      );
      stopped = true;
      break;
    }
    const char = authored[index] ?? "";
    if (/\s/u.test(char)) {
      finishToken();
      continue;
    }
    if (token.length <= BOUNDS.identifierChars) {
      token += char;
    } else {
      tokenTooLong = true;
    }
  }
  if (!stopped) {
    finishToken();
  }
  return { names, issues };
}

/**
 * Builds the payload for one interaction.
 *
 * The kept set is the authored prefix under `B-22`, so the same list always
 * sends the same fields; the overflow is reported rather than silently
 * truncating the request into a different one.
 *
 * A value past `B-23` becomes a stated absence. Truncating it would hand the
 * agent a plausible wrong value, which is worse than saying there is none — and
 * the store clamps its writes at the same bound, so this branch answers for
 * sources the store did not produce rather than for anything a visitor can type.
 */
export function buildCollectPayload(authored: unknown, read: CollectReader): CollectPayload {
  const parsed = parseCollectNames(authored);
  const issues: CollectIssue[] = [...parsed.issues];
  const limit = BOUNDS.collectFieldsPerEvent;
  const kept = parsed.names.slice(0, limit);
  if (parsed.names.length > limit) {
    issues.push(
      issue(
        "too_many_collect_fields",
        "collect",
        `The collect list names ${parsed.names.length} fields; the bound is ${limit}.`,
      ),
    );
  }

  const collect: Record<string, CollectEntry> = {};
  for (const name of kept) {
    const source = readSource(name, read);
    if (source.kind === "sensitive") {
      collect[name] = Object.freeze({ kind: "omitted_sensitive" });
      continue;
    }
    if (source.kind === "unavailable") {
      collect[name] = Object.freeze({ kind: "collect_source_unavailable" });
      continue;
    }
    const collected = boundedCollectedValue(source.value, name, issues);
    if (collected === null) {
      collect[name] = Object.freeze({ kind: "collect_source_unavailable" });
      continue;
    }
    collect[name] = Object.freeze({ kind: "value", value: collected });
  }

  return Object.freeze({ collect: Object.freeze(collect), issues: Object.freeze(issues) });
}

function boundedCollectedValue(
  value: CollectedValue,
  name: string,
  issues: CollectIssue[],
): CollectedValue | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length <= BOUNDS.collectedValueChars) {
      return value;
    }
    issues.push(
      issue(
        "collected_value_too_long",
        `collect.${name}`,
        "The collected value exceeds the bound, so no value is sent for it.",
      ),
    );
    return null;
  }
  if (value.length > BOUNDS.dataModelArrayLength) {
    issues.push(
      issue(
        "too_many_collected_values",
        `collect.${name}`,
        "The collected string array exceeds the data-array bound.",
      ),
    );
    return null;
  }
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string") {
      return null;
    }
    if (item.length > BOUNDS.collectedValueChars) {
      issues.push(
        issue(
          "collected_value_too_long",
          `collect.${name}[${index}]`,
          "A collected array item exceeds the bound, so no value is sent for it.",
        ),
      );
      return null;
    }
    items.push(item);
  }
  return Object.freeze(items);
}
