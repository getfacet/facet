import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as runtime from "./index.js";

const BARREL_EXPORT_CONTRACT = [
  "FacetRuntime",
  "bootstrapSession",
  "SessionBootstrapOptions",
  "Session",
  "SessionIssue",
  "StageStore",
  "MemoryStageStore",
  "loadSession",
  "validatePersistedSession",
  "Sink",
  "MemorySink",
  "ConversationRecord",
  "SummaryStore",
  "MemorySummaryStore",
] as const;

const VALUE_EXPORTS = [
  "FacetRuntime",
  "MemorySink",
  "MemoryStageStore",
  "MemorySummaryStore",
  "bootstrapSession",
  "loadSession",
  "validatePersistedSession",
] as const;

function barrelSource(): string {
  return readFileSync(new URL("./index.ts", import.meta.url), "utf8");
}

function exportedNames(source: string): readonly string[] {
  const names = new Set<string>();
  const re = /export(?: type)? \{([^}]+)\}/g;
  for (const match of source.matchAll(re)) {
    const body = match[1];
    if (body === undefined) {
      continue;
    }
    for (const raw of body.split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();
      if (name !== undefined && name.length > 0) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe("@facet/runtime barrel", () => {
  it("declares exactly Barrel Export Contract list 5 with no export star", () => {
    const source = barrelSource();

    expect(source).not.toMatch(/export\s+\*/u);
    expect(exportedNames(source)).toEqual([...BARREL_EXPORT_CONTRACT].sort());
  });

  it("exposes exactly one package export entry and no Node/file asset symbols", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      readonly exports?: unknown;
    };

    expect(pkg.exports).toEqual({ ".": "./src/index.ts" });
    expect(Object.keys(runtime).sort()).toEqual([...VALUE_EXPORTS].sort());
    expect("publishData" in runtime).toBe(false);
    expect("FileAssets" in runtime).toBe(false); // component-hard-cut: allowed-negative
    expect("MemoryAssets" in runtime).toBe(false); // component-hard-cut: allowed-negative
    expect("loadAssets" in runtime).toBe(false); // component-hard-cut: allowed-negative
    expect("AssetsStore" in runtime).toBe(false); // component-hard-cut: allowed-negative
  });

  it("keeps Node built-ins outside the root barrel graph", () => {
    const source = barrelSource();

    expect(source).not.toContain("node:");
    expect(source).not.toContain("@facet/assets");
    expect(source).not.toContain("./assets.js");
    expect(source).not.toContain("./redaction.js");
  });
});
