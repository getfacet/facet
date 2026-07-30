import { describe, expect, it } from "vitest";

import { nextRevision } from "./revision.js";
import type { CasOutcome, StageRevision } from "./revision.js";

/** Casts a value the declared parameter type cannot express, for totality. */
function junk(value: unknown): StageRevision {
  return value as StageRevision;
}

/** The first revision the sequence produces above the conventional initial `0`. */
const FIRST = 1;

describe("nextRevision — monotonicity", () => {
  it("produces the first revision from a fresh session's initial 0", () => {
    expect(nextRevision(0)).toBe(FIRST);
  });

  it("strictly increases, one commit at a time", () => {
    let revision: StageRevision = 0;
    const seen: StageRevision[] = [];
    for (let commit = 0; commit < 100; commit += 1) {
      const advanced = nextRevision(revision);
      expect(advanced).toBeGreaterThan(revision);
      seen.push(advanced);
      revision = advanced;
    }
    expect(revision).toBe(100);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("is pure: the same revision always yields the same successor", () => {
    expect(nextRevision(41)).toBe(nextRevision(41));
    expect(nextRevision(41)).toBe(42);
  });

  it("never decreases, even one step below the safe-integer ceiling", () => {
    const penultimate = Number.MAX_SAFE_INTEGER - 1;
    expect(nextRevision(penultimate)).toBe(Number.MAX_SAFE_INTEGER);
    // Saturation: the sequence stops rather than stepping to a value that float
    // arithmetic can no longer tell apart from its neighbour.
    expect(nextRevision(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(nextRevision(Number.MAX_SAFE_INTEGER)).not.toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("nextRevision — totality", () => {
  const notRevisions: readonly (readonly [string, unknown])[] = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a negative count", -1],
    ["a fraction", 1.5],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
    ["a numeric string", "3"],
    ["null", null],
    ["undefined", undefined],
    ["an object", { revision: 3 }],
    ["a bigint", 3n],
  ];

  for (const [label, value] of notRevisions) {
    it(`restarts the sequence at the first revision for ${label}`, () => {
      expect(() => nextRevision(junk(value))).not.toThrow();
      expect(nextRevision(junk(value))).toBe(FIRST);
    });
  }
});

describe("CasOutcome — the conflict table", () => {
  const committed: CasOutcome = { ok: true, revision: 7 };
  const conflict: CasOutcome = { ok: false, reason: "conflict", currentRevision: 9 };

  it("carries exactly the committed members on a commit", () => {
    expect(Object.keys(committed)).toEqual(["ok", "revision"]);
  });

  it("carries exactly one structured reason and the current revision on a conflict", () => {
    expect(Object.keys(conflict)).toEqual(["ok", "reason", "currentRevision"]);
    if (conflict.ok) {
      throw new Error("the conflict fixture must not narrow to a commit");
    }
    expect(conflict.reason).toBe("conflict");
    expect(conflict.currentRevision).toBe(9);
  });

  it("distinguishes committed from conflict by narrowing on ok alone", () => {
    const describeOutcome = (outcome: CasOutcome): string =>
      outcome.ok ? `committed at ${outcome.revision}` : `conflict at ${outcome.currentRevision}`;

    expect(describeOutcome(committed)).toBe("committed at 7");
    expect(describeOutcome(conflict)).toBe("conflict at 9");
  });

  it("tells the loser what to re-read: retrying from currentRevision advances it", () => {
    if (conflict.ok) {
      throw new Error("the conflict fixture must not narrow to a commit");
    }
    // A stale write is rejected, never merged (D-03): the loser re-reads at
    // `currentRevision` and its retry commits at the next revision above it.
    const retried: CasOutcome = { ok: true, revision: nextRevision(conflict.currentRevision) };
    expect(retried.ok && retried.revision).toBe(10);
    expect(retried.ok && retried.revision).toBeGreaterThan(conflict.currentRevision);
  });
});
