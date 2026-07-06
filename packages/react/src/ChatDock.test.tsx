import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ChatDock palette usage", () => {
  it("ChatDock uses shared palette values instead of stale literal hexes", () => {
    const source = readFileSync(new URL("./ChatDock.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("#fbfbfc");
    expect(source).not.toContain("#d7dbe0");
  });
});
