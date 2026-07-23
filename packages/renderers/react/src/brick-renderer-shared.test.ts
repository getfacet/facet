import type { CSSProperties } from "react";
import { describe, expect, it } from "vitest";
import { intrinsicBoxStyle } from "./brick-renderer-shared.js";

// intrinsicBoxStyle wraps a data brick's nested box-shaped target. It must strip
// every flex-CONTAINER and flex-ITEM main-axis key so box-layout sizing (the new
// `basis` → flexBasis/flexShrink:0, RISK-API-9) never leaks into a data brick's
// intrinsic wrapper, where those properties have no coherent meaning.
describe("intrinsicBoxStyle box-layout denylist", () => {
  it("strips flexBasis and flexShrink (RISK-API-9)", () => {
    const style: CSSProperties = {
      flexBasis: "16rem",
      flexShrink: 0,
      color: "red",
    };
    const result = intrinsicBoxStyle(style);
    expect(result.flexBasis).toBeUndefined();
    expect(result.flexShrink).toBeUndefined();
    // A non-layout paint property survives.
    expect(result.color).toBe("red");
  });

  it("still strips the pre-existing flex-container + sizing keys", () => {
    const style: CSSProperties = {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: "1rem",
      alignItems: "center",
      justifyContent: "center",
      flexGrow: 1,
      flexBasis: "16rem",
      flexShrink: 0,
      width: "50%",
      minWidth: 10,
      maxWidth: "100%",
      overflowX: "auto",
      overflowY: "auto",
      maxHeight: "20rem",
      minHeight: 0,
    };
    const result = intrinsicBoxStyle(style);
    for (const key of [
      "display",
      "flexDirection",
      "flexWrap",
      "gap",
      "alignItems",
      "justifyContent",
      "flexGrow",
      "flexBasis",
      "flexShrink",
      "width",
      "overflowX",
      "overflowY",
      "maxHeight",
    ] as const) {
      expect(result[key]).toBeUndefined();
    }
  });

  it("returns an empty containment shell for undefined input without throwing", () => {
    expect(() => intrinsicBoxStyle(undefined)).not.toThrow();
    const result = intrinsicBoxStyle(undefined);
    expect(result.flexBasis).toBeUndefined();
    expect(result.flexShrink).toBeUndefined();
  });
});
