/**
 * WU-1 (Decision A) — unit coverage for the pure verdict-aggregation rule.
 *
 * These tests pin the HARD/SOFT/quorum policy that decides the live-journey
 * tier: HARD lenses (safety/render/responsiveness) fail the tier on any fail or
 * below-quorum (insufficient) row; SOFT lenses (fidelity/diversity) only warn.
 * Below quorum / a missing (lens,visitor) row is NEVER a silent pass — it is
 * `insufficient` ⇒ a HARD fail. Fully deterministic, no I/O.
 */
import { describe, expect, it } from "vitest";
import type { LensPolicy, Vote } from "./verdict.js";
import { aggregateVerdict, DEFAULT_LENS_POLICY, expectedMatrix } from "./verdict.js";

/** N identical votes for one (lens, visitor). */
function votes(
  lens: Vote["lens"],
  visitor: string,
  verdict: Vote["verdict"],
  count = 1,
): Vote[] {
  return Array.from({ length: count }, () => ({ lens, visitor, verdict }));
}

/** Every HARD lens passing at quorum for one visitor. */
function hardPass(visitor: string): Vote[] {
  return [
    ...votes("safety", visitor, "pass", 2),
    ...votes("render", visitor, "pass", 2),
    ...votes("responsiveness", visitor, "pass", 2),
  ];
}

/** Every SOFT lens passing at quorum for one visitor. */
function softPass(visitor: string): Vote[] {
  return [...votes("fidelity", visitor, "pass", 2), ...votes("diversity", visitor, "pass", 1)];
}

describe("aggregateVerdict — HARD/SOFT/quorum rule", () => {
  it("a soft-lens fail is a warning, not a tier fail", () => {
    // DC-003: request-fidelity (SOFT) fails, every HARD lens passes ⇒ PASS with
    // exactly one warning, no blocking entry.
    const result = aggregateVerdict([
      ...hardPass("v1"),
      ...votes("fidelity", "v1", "fail", 2), // SOFT majority fail
      ...votes("diversity", "v1", "pass", 1),
    ]);

    expect(result.result).toBe("PASS");
    expect(result.blocking).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("fidelity");
    expect(result.perLens).toContainEqual({ lens: "fidelity", visitor: "v1", outcome: "fail" });
  });

  it("a HARD lens below quorum (all-abstain) is insufficient and fails the tier", () => {
    // DC-004: safety gets only abstentions (0 valid < quorum 2) ⇒ insufficient
    // ⇒ HARD FAIL, never a silent pass.
    const result = aggregateVerdict([
      ...votes("safety", "v1", "abstain", 2),
      ...votes("render", "v1", "pass", 2),
      ...votes("responsiveness", "v1", "pass", 2),
      ...softPass("v1"),
    ]);

    expect(result.result).toBe("FAIL");
    expect(result.blocking.some((b) => b.includes("safety"))).toBe(true);
    expect(result.perLens).toContainEqual({
      lens: "safety",
      visitor: "v1",
      outcome: "insufficient",
    });
  });

  it("a missing HARD (lens, visitor) row is insufficient, not a silent pass", () => {
    // DC-004: v1 is judged (appears via other lenses) but render produced NO
    // vote row at all. The expected (lens × visitor) matrix still demands it, so
    // render×v1 is insufficient ⇒ HARD FAIL — a dead judge is never a pass.
    const result = aggregateVerdict([
      ...votes("safety", "v1", "pass", 2),
      // render: no rows at all
      ...votes("responsiveness", "v1", "pass", 2),
      ...softPass("v1"),
    ]);

    expect(result.result).toBe("FAIL");
    expect(result.perLens).toContainEqual({
      lens: "render",
      visitor: "v1",
      outcome: "insufficient",
    });
    expect(result.blocking.some((b) => b.includes("render"))).toBe(true);
  });

  it("a tie in HARD votes fails (conservative)", () => {
    // render has 1 pass + 1 fail (both valid, quorum met) ⇒ tie ⇒ fail ⇒ FAIL.
    const result = aggregateVerdict([
      ...votes("safety", "v1", "pass", 2),
      ...votes("render", "v1", "pass", 1),
      ...votes("render", "v1", "fail", 1),
      ...votes("responsiveness", "v1", "pass", 2),
      ...softPass("v1"),
    ]);

    expect(result.result).toBe("FAIL");
    expect(result.perLens).toContainEqual({ lens: "render", visitor: "v1", outcome: "fail" });
  });

  it("happy path: all HARD pass and no SOFT fail ⇒ PASS with no warnings", () => {
    // DC-001 aggregation contract: a clean run has zero warnings and zero
    // blocking rows and every per-lens outcome is `pass`.
    const result = aggregateVerdict([...hardPass("v1"), ...softPass("v1")]);

    expect(result.result).toBe("PASS");
    expect(result.warnings).toEqual([]);
    expect(result.blocking).toEqual([]);
    expect(result.perLens.every((row) => row.outcome === "pass")).toBe(true);
    expect(result.perLens.length).toBe(DEFAULT_LENS_POLICY.length);
  });

  it("an empty vote list fails closed (no silent pass)", () => {
    const result = aggregateVerdict([]);
    expect(result.result).toBe("FAIL");
    expect(result.blocking.length).toBeGreaterThan(0);
  });

  it("a SOFT lens below quorum warns but never fails the tier", () => {
    // diversity (SOFT, quorum 1) has only abstains ⇒ insufficient ⇒ warning,
    // HARD all pass ⇒ still PASS.
    const result = aggregateVerdict([
      ...hardPass("v1"),
      ...votes("fidelity", "v1", "pass", 2),
      ...votes("diversity", "v1", "abstain", 1),
    ]);

    expect(result.result).toBe("PASS");
    expect(result.warnings.some((w) => w.includes("diversity"))).toBe(true);
    expect(result.blocking).toEqual([]);
  });
});

describe("expectedMatrix", () => {
  it("returns the full (lens × visitor) set for the given visitors", () => {
    const rows = expectedMatrix(["a", "b"], DEFAULT_LENS_POLICY);
    expect(rows.length).toBe(DEFAULT_LENS_POLICY.length * 2);
    expect(rows).toContainEqual({ lens: "safety", visitor: "a" });
    expect(rows).toContainEqual({ lens: "diversity", visitor: "b" });
    // one row per (lens, visitor) pair — no duplicates
    const keys = new Set(rows.map((r) => `${r.lens}:${r.visitor}`));
    expect(keys.size).toBe(rows.length);
  });

  it("honours a custom policy subset", () => {
    const policy: LensPolicy[] = [{ lens: "safety", severity: "hard", quorum: 1 }];
    const rows = expectedMatrix(["v1", "v2", "v3"], policy);
    expect(rows).toEqual([
      { lens: "safety", visitor: "v1" },
      { lens: "safety", visitor: "v2" },
      { lens: "safety", visitor: "v3" },
    ]);
  });

  it("defaults to DEFAULT_LENS_POLICY when no policy is passed", () => {
    const rows = expectedMatrix(["only"]);
    expect(rows.length).toBe(DEFAULT_LENS_POLICY.length);
  });
});
