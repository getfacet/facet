import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as server from "./index.js";

const BARREL_EXPORT_CONTRACT = [
  "createFacetServer",
  "FacetServer",
  "FacetServerOptions",
  "FacetServerObservation",
  "FacetServerObserver",
] as const;

const VALUE_EXPORTS = ["createFacetServer"] as const;

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function exportedNames(text: string): readonly string[] {
  const names = new Set<string>();
  const re = /export(?: type)? \{([^}]+)\}/g;
  for (const match of text.matchAll(re)) {
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

describe("@facet/server barrel", () => {
  it("exports exactly Barrel Export Contract list 8 and no retired names", () => {
    const text = source("./index.ts");

    expect(text).not.toMatch(/export\s+\*/u);
    expect(exportedNames(text)).toEqual([...BARREL_EXPORT_CONTRACT].sort());
    expect(text).not.toMatch(/\b(say|reset|ViewSnapshot)\b/u); // style-hard-cut: allowed-negative
    expect(Object.keys(server).sort()).toEqual([...VALUE_EXPORTS].sort());
  });
});
