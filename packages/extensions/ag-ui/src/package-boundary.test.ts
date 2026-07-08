import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(sourceDir, "../../../..");

function repoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function sourceFiles(root: string): readonly string[] {
  const result: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      result.push(...sourceFiles(path));
      continue;
    }

    if (/\.(?:ts|tsx|js|jsx|json)$/.test(entry)) {
      result.push(path);
    }
  }

  return result;
}

describe("@facet/ag-ui package boundaries", () => {
  it("keeps official AG-UI dependencies isolated from @facet/core", () => {
    const corePackageJson = repoFile("packages/core/core/package.json");
    const coreSources = sourceFiles(join(repoRoot, "packages/core/core"));

    expect(corePackageJson).not.toContain("@ag-ui/");
    expect(
      coreSources
        .map((path) => [path, readFileSync(path, "utf8")] as const)
        .filter(([, source]) => source.includes("@ag-ui/"))
        .map(([path]) => path),
    ).toEqual([]);
  });

  it("keeps the root @facet/ag-ui entrypoint browser-safe", () => {
    const rootIndex = repoFile("packages/extensions/ag-ui/src/index.ts");

    expect(rootIndex).not.toMatch(/from\s+["']\.\/server\.js["']/);
    expect(rootIndex).not.toMatch(/export\s+\*\s+from\s+["']\.\/server\.js["']/);
    expect(rootIndex).toContain('export * from "./events.js";');
    expect(rootIndex).toContain('export * from "./transport.js";');
    expect(existsSync(join(repoRoot, "packages/extensions/ag-ui/src/server.ts"))).toBe(true);
  });

  it("documents AG-UI as an isolated public adapter with native fallback posture", () => {
    const agents = repoFile("AGENTS.md");
    const packageBoundaries = repoFile("docs/PACKAGE-BOUNDARIES.md");

    expect(agents).toContain(
      "| Extensions | `packages/extensions/ag-ui` | `@facet/ag-ui` | Official AG-UI adapter/event layer, browser transport and Node server adapter, keeping Facet safety. |",
    );
    expect(agents).toContain("`@facet/ag-ui`");
    expect(packageBoundaries).toContain("`@facet/ag-ui`");
    expect(packageBoundaries).toMatch(/@facet\/core` remains dependency-free/);
    expect(packageBoundaries).toMatch(/native `@facet\/client`\/`@facet\/server`.*reference fallback/s);
    expect(packageBoundaries).toMatch(/quickstart\/playground.*native.*local\/reference fallback/s);
  });

  it("documents AG-UI stage authority and the deferred external dial-out adapter", () => {
    const architecture = repoFile("docs/ARCHITECTURE.md");
    const packageBoundaries = repoFile("docs/PACKAGE-BOUNDARIES.md");
    const docs = `${architecture}\n${packageBoundaries}`;

    expect(architecture).toMatch(/AG-UI.*optional\/public edge adapter.*`@facet\/ag-ui`/s);
    expect(architecture).toMatch(/Facet owns.*stage spec.*renderer.*patch safety/s);
    expect(architecture).toMatch(/`STATE_DELTA`\/`STATE_SNAPSHOT`.*reserved.*`\/facet\/stage`/s);
    expect(architecture).toMatch(/`RunAgentInput\.state` is not stage\s+authority/);
    expect(docs).toMatch(/[Ee]xternal NAT-safe AG-UI dial-out.*deferred.*`@facet\/ag-ui\/agent`/s);
    expect(docs).toMatch(/native `@facet\/agent-client` remains unchanged/);
  });
});
