import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as rootExports from "./index.js";

const NODE_BUILTIN_IMPORT =
  /from\s+["'](?:node:)?(?:assert|buffer|child_process|cluster|crypto|dns|events|fs|http|https|net|os|path|process|stream|string_decoder|tls|url|util|worker_threads|zlib)["']/;

function sourceText(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("@facet/ag-ui package entrypoint", () => {
  it("exposes browser-safe event and transport exports from the root", () => {
    expect(rootExports).toHaveProperty("AgUiTransport");
    expect(rootExports).toHaveProperty("createHttpAgUiTransport");
    expect(rootExports).toHaveProperty("agUiEventToServerMessages");
    expect(rootExports).toHaveProperty("serverMessagesToAgUiEvents");
  });

  it("does not expose Node-only server exports from the root", () => {
    expect(rootExports).not.toHaveProperty("handleAgUiRequest");
    expect(rootExports).not.toHaveProperty("runFacetAsAgUi");
    expect(rootExports).not.toHaveProperty("writeAgUiSseEvent");
  });

  it("keeps the root source free of server and Node builtin imports", () => {
    const source = sourceText("./index.ts");

    expect(source).not.toMatch(/from\s+["']\.\/server\.js["']/);
    expect(source).not.toMatch(/export\s+\*\s+from\s+["']\.\/server\.js["']/);
    expect(source).not.toMatch(NODE_BUILTIN_IMPORT);
  });

  it("registers root and server TypeScript path aliases separately", () => {
    const tsconfig = JSON.parse(sourceText("../../../../tsconfig.base.json")) as {
      readonly compilerOptions?: {
        readonly paths?: Record<string, readonly string[]>;
      };
    };

    expect(tsconfig.compilerOptions?.paths?.["@facet/ag-ui"]).toEqual([
      "packages/extensions/ag-ui/src/index.ts",
    ]);
    expect(tsconfig.compilerOptions?.paths?.["@facet/ag-ui/server"]).toEqual([
      "packages/extensions/ag-ui/src/server.ts",
    ]);
  });
});
