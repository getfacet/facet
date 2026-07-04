import { describe, expect, it } from "vitest";
import { validateStamp } from "@facet/core";
import { DEFAULT_STAMPS } from "./stamps.js";

describe("DEFAULT_STAMPS", () => {
  it("every entry passes validateStamp with zero error issues", () => {
    for (const stamp of DEFAULT_STAMPS) {
      const { stamp: validated, issues } = validateStamp(stamp);
      expect(issues).toEqual([]);
      expect(validated).toBeDefined();
      expect(validated?.root).toBe(stamp.root);
    }
  });

  it("carries every node id under the stamp's own name prefix", () => {
    for (const stamp of DEFAULT_STAMPS) {
      const ids = Object.keys(stamp.nodes);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith(stamp.name))).toBe(true);
      expect(ids).not.toContain("root");
      expect(stamp.root).not.toBe("root");
      expect(stamp.root.startsWith(stamp.name)).toBe(true);
    }
  });

  it("has unique stamp names", () => {
    const names = DEFAULT_STAMPS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
