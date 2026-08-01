import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as client from "./index.js";

const BARREL_EXPORT_CONTRACT = [
  "SseTransport",
  "LocalTransport",
  "browserSessionKey",
  "persistScreen",
  "loadPersistedScreen",
] as const;
const BARREL_SOURCE_EXPORT_CONTRACT = [
  ...BARREL_EXPORT_CONTRACT,
  "SseVisitorMessageInput",
] as const;

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

describe("@facet/client barrel", () => {
  it("exports exactly Barrel Export Contract list 9 and no retired names", () => {
    const text = source("./index.ts");

    expect(text).not.toMatch(/export\s+\*/u);
    expect(exportedNames(text)).toEqual([...BARREL_SOURCE_EXPORT_CONTRACT].sort());
    expect(text).not.toMatch(/\b(withView|persistView|loadPersistedView|ViewSnapshot)\b/u); // component-hard-cut: allowed-negative
    expect(Object.keys(client).sort()).toEqual([...BARREL_EXPORT_CONTRACT].sort());
  });

  it("keeps production dependencies to @facet/core only", () => {
    const manifest = JSON.parse(source("../package.json")) as {
      readonly dependencies?: Readonly<Record<string, string>>;
    };

    expect(manifest.dependencies ?? {}).toEqual({ "@facet/core": "workspace:*" });
  });
});
