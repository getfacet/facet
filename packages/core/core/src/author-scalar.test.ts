import { describe, expect, it } from "vitest";

import { isAuthoredNumberLiteral, parseAuthoredNumber } from "./author-scalar.js";

describe("authored numeric scalar parsing", () => {
  it("accepts exactly the plain decimal spellings Facet authors may write", () => {
    expect(parseAuthoredNumber("0")).toBe(0);
    expect(parseAuthoredNumber("-0")).toBe(-0);
    expect(parseAuthoredNumber("42")).toBe(42);
    expect(parseAuthoredNumber("-3.5")).toBe(-3.5);
    expect(parseAuthoredNumber("0.0000001")).toBe(0.0000001);
    expect(isAuthoredNumberLiteral("12.0")).toBe(true);
  });

  it("rejects alternate number spellings that would create drift", () => {
    for (const value of ["", "+1", "01", "1.", ".5", "1e3", "0x10", "Infinity", "NaN"]) {
      expect(parseAuthoredNumber(value)).toBeNull();
      expect(isAuthoredNumberLiteral(value)).toBe(false);
    }
  });

  it("rejects syntactically valid decimal literals that overflow JavaScript numbers", () => {
    const overflow = `1${"0".repeat(400)}`;

    expect(isAuthoredNumberLiteral(overflow)).toBe(true);
    expect(parseAuthoredNumber(overflow)).toBeNull();
  });

  it("rejects decimal literals that would parse to a different numeric value", () => {
    for (const value of [
      "9007199254740992",
      "9007199254740993",
      "-9007199254740992",
      "1.0000000000000001",
      "0.1234567890123456789012345",
    ]) {
      expect(isAuthoredNumberLiteral(value)).toBe(true);
      expect(parseAuthoredNumber(value)).toBeNull();
    }
  });
});
