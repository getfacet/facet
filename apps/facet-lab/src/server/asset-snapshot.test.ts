import { describe, expect, it } from "vitest";

import { createDefaultAssetSnapshot, createRunAssetSnapshot } from "./asset-snapshot.js";

describe("asset snapshots", () => {
  it("builds only detached, deeply frozen package-default snapshots", () => {
    const selected = createDefaultAssetSnapshot();
    const runSnapshot = createRunAssetSnapshot(selected);

    expect(selected.source).toBe("default");
    expect(selected.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.theme.tokens.paint.light.color)).toBe(true);
    expect(Object.isFrozen(selected.patterns)).toBe(true);

    expect(runSnapshot).not.toBe(selected);
    expect(runSnapshot.source).toBe("default");
    expect(runSnapshot.digest).toBe(selected.digest);
    expect(Object.isFrozen(runSnapshot)).toBe(true);
    expect(Object.isFrozen(runSnapshot.theme.tokens.paint.light.color)).toBe(true);
    expect(createDefaultAssetSnapshot().digest).toBe(selected.digest);
  });
});
