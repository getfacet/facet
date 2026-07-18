import { DEFAULT_PATTERNS, DEFAULT_THEME } from "@facet/assets";
import { describe, expect, it } from "vitest";

import {
  ASSET_SNAPSHOT_SCHEMA_VERSION,
  MAX_ASSET_DOCUMENT_BYTES,
  createDefaultAssetSnapshot,
  createRunAssetSnapshot,
  importAssetBundle,
} from "./asset-snapshot.js";

function expectRejectedWithPrior(
  prior: ReturnType<typeof createDefaultAssetSnapshot>,
  result: ReturnType<typeof importAssetBundle>,
  issueCode: string,
): void {
  expect(result.accepted).toBe(false);
  expect(result.snapshot).toBe(prior);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: issueCode })]),
  );
}

function nestedValue(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}

describe("asset snapshots", () => {
  it("rejects an invalid bundle transactionally and freezes a run snapshot", () => {
    const prior = createDefaultAssetSnapshot();
    const invalidTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    invalidTheme.tokens = {};

    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: invalidTheme,
        patterns: [],
      }),
      "invalid-theme",
    );

    const invalidPattern = {
      ...structuredClone(DEFAULT_PATTERNS[0]),
      root: "missing-node",
    };
    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: structuredClone(DEFAULT_THEME),
        patterns: [structuredClone(DEFAULT_PATTERNS[0]), invalidPattern],
      }),
      "invalid-pattern",
    );

    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: 2,
        theme: structuredClone(DEFAULT_THEME),
        patterns: [],
      }),
      "unsupported-version",
    );

    const tooDeepTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    tooDeepTheme.extra = nestedValue(40);
    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: tooDeepTheme,
        patterns: [],
      }),
      "too-deep",
    );

    const oversizedTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    oversizedTheme.description = "x".repeat(MAX_ASSET_DOCUMENT_BYTES + 1);
    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: oversizedTheme,
        patterns: [],
      }),
      "document-too-large",
    );

    const evidenceStarvingPatterns = Array.from({ length: 25 }, (_, index) => ({
      ...structuredClone(DEFAULT_PATTERNS[0]),
      name: `evidence-starving-${String(index)}`,
      description: "x".repeat(MAX_ASSET_DOCUMENT_BYTES - 4_096),
    }));
    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: structuredClone(DEFAULT_THEME),
        patterns: evidenceStarvingPatterns,
      }),
      "bundle-too-large",
    );

    const cyclicTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    cyclicTheme.self = cyclicTheme;
    expectRejectedWithPrior(
      prior,
      importAssetBundle(prior, {
        schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
        theme: cyclicTheme,
        patterns: [],
      }),
      "cyclic-input",
    );

    const mutableTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    mutableTheme.name = "custom-theme";
    const mutablePatterns = structuredClone(DEFAULT_PATTERNS) as unknown as Array<
      Record<string, unknown>
    >;
    mutablePatterns[0]!.name = "custom-hero";

    const imported = importAssetBundle(prior, {
      schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
      theme: mutableTheme,
      patterns: mutablePatterns,
    });

    expect(imported.accepted).toBe(true);
    if (!imported.accepted) {
      throw new Error("Expected valid custom assets to be imported");
    }

    expect(imported.snapshot.source).toBe("custom");
    expect(imported.snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(imported.snapshot)).toBe(true);
    expect(Object.isFrozen(imported.snapshot.theme.tokens.paint.light.color)).toBe(true);
    expect(Object.isFrozen(imported.snapshot.patterns)).toBe(true);

    const runSnapshot = createRunAssetSnapshot(imported.snapshot);
    const runDigest = runSnapshot.digest;
    const runThemeName = runSnapshot.theme.name;
    const runPatternName = runSnapshot.patterns[0]?.name;

    expect(runSnapshot).not.toBe(imported.snapshot);
    expect(Object.isFrozen(runSnapshot)).toBe(true);
    expect(Object.isFrozen(runSnapshot.theme.tokens.paint.light.color)).toBe(true);
    expect(runSnapshot.digest).toBe(imported.snapshot.digest);

    mutableTheme.name = "mutated-after-import";
    mutablePatterns[0]!.name = "mutated-after-import";
    const replacementTheme = structuredClone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    replacementTheme.name = "replacement-theme";
    const replacement = importAssetBundle(imported.snapshot, {
      schemaVersion: ASSET_SNAPSHOT_SCHEMA_VERSION,
      theme: replacementTheme,
      patterns: structuredClone(DEFAULT_PATTERNS),
    });

    expect(replacement.accepted).toBe(true);
    expect(replacement.snapshot.digest).not.toBe(runDigest);
    expect(runSnapshot.digest).toBe(runDigest);
    expect(runSnapshot.theme.name).toBe(runThemeName);
    expect(runSnapshot.patterns[0]?.name).toBe(runPatternName);
    expect(createDefaultAssetSnapshot().digest).toBe(createDefaultAssetSnapshot().digest);
  });
});
