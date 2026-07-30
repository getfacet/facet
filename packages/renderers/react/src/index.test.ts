import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as react from "./index.js";
import type {
  ComponentRegistry,
  ConversationItem,
  RendererBootstrap,
  StageRendererProps,
  UseFacetResult,
} from "./index.js";

const RUNTIME_EXPORTS = [
  "ConversationSurface",
  "CorruptSubtreeState",
  "CrashState",
  "ModalFrame",
  "PreparingState",
  "StageRenderer",
  "SubtreeBoundary",
  "bootstrapRenderer",
  "createRegistry",
  "resolveTheme",
  "useFacet",
];

const RETIRED_SYMBOLS = [
  "ChatDock",
  "DEFAULT_THEME",
  "BrickRenderer",
  "PatternRenderer",
  "ViewSnapshot", // style-hard-cut: allowed-negative
  "viewSnapshot",
];

const BANNED_CAPABILITIES: readonly [label: string, pattern: RegExp][] = [
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["EventSource", /\bEventSource\b/],
  ["node builtin import", /(?:from\s+["']node:|import\s*\(\s*["']node:|require\s*\(\s*["']node:)/],
];

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));

function sourceOf(file: string): string {
  return readFileSync(join(SOURCE_ROOT, file), "utf8");
}

function sourceFor(specifier: string): [file: string, source: string] | null {
  const stem = specifier.replace(/\.js$/, "");
  for (const extension of [".ts", ".tsx"]) {
    const candidate = `${stem}${extension}`;
    try {
      return [candidate.replace(/^\.\//, ""), sourceOf(candidate)];
    } catch {
      // Try the other extension.
    }
  }
  return null;
}

function localSpecifiers(source: string): readonly string[] {
  return [
    ...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g),
  ]
    .map((match) => match[1] ?? "")
    .filter((specifier) => extname(specifier) === ".js");
}

function reachableSources(entry: string): readonly [file: string, source: string][] {
  const seen = new Set<string>();
  const queue = [entry];
  const reached: [string, string][] = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const source = sourceOf(file);
    reached.push([file, source]);
    for (const specifier of localSpecifiers(source)) {
      const resolved = sourceFor(specifier);
      if (resolved !== null) {
        queue.push(resolved[0]);
      }
    }
  }
  return reached;
}

function typeWitness(_: {
  readonly bootstrap: RendererBootstrap;
  readonly registry: ComponentRegistry;
  readonly props: StageRendererProps;
  readonly item: ConversationItem;
  readonly result: UseFacetResult;
}): void {
  // Compile-time only.
}

describe("@facet/react barrel", () => {
  it("exports exactly the runtime key set in the Barrel Export Contract", () => {
    expect(Object.keys(react).sort()).toEqual(RUNTIME_EXPORTS);
  });

  it("keeps the required type names reachable from the barrel", () => {
    expect(typeWitness).toBeTypeOf("function");
  });

  it("does not publish retired chat, theme singleton, brick, or snapshot names", () => {
    const source = sourceOf("index.ts");

    for (const symbol of RETIRED_SYMBOLS) {
      expect(Object.keys(react)).not.toContain(symbol);
      expect(source).not.toContain(symbol);
    }
  });

  it("uses explicit named exports, not export-star widening", () => {
    expect(sourceOf("index.ts")).not.toMatch(/export\s+\*/);
  });

  it("keeps network and Node capability unreachable from the barrel graph", () => {
    const scanned = reachableSources("index.ts");
    expect(scanned.map(([file]) => file).sort()).toContain("index.ts");

    for (const [file, source] of scanned) {
      for (const [label, pattern] of BANNED_CAPABILITIES) {
        expect(pattern.test(source), `${file} reaches ${label}`).toBe(false);
      }
    }
  });
});
