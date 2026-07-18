import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readAppFile(path: string): string {
  return readFileSync(join(APP_ROOT, path), "utf8");
}

function readPackageJson(): Record<string, unknown> {
  const value: unknown = JSON.parse(readAppFile("package.json"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Facet Lab package.json must be an object");
  }
  return value as Record<string, unknown>;
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Facet Lab package.json ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

describe("Facet Lab scaffold", () => {
  it("defines a private leaf app with separated entry graphs", () => {
    const packageJson = readPackageJson();
    const scripts = recordField(packageJson, "scripts");
    const dependencies = recordField(packageJson, "dependencies");
    const devDependencies = recordField(packageJson, "devDependencies");

    expect(packageJson["name"]).toBe("@facet/lab");
    expect(packageJson["private"]).toBe(true);
    expect(packageJson["type"]).toBe("module");
    expect(Object.keys(dependencies)).not.toContain("@facet/quickstart");
    expect(Object.keys(devDependencies)).not.toContain("@facet/quickstart");
    expect(devDependencies).toMatchObject({
      "@axe-core/playwright": expect.any(String),
      playwright: expect.any(String),
    });

    expect(scripts["dev"]).toBe("vite");
    expect(scripts["serve"]).toBe("tsx src/server/main.ts");
    expect(scripts["build"]).toBe("vite build");
    expect(scripts["test"]).toBe("vitest run src");
    expect(scripts["test:e2e"]).toBe("vitest run e2e");
    expect(scripts["test:e2e:deterministic"]).toContain("deterministic.journey.test.ts");
    expect(scripts["test:e2e:boundaries"]).toContain("boundaries.journey.test.ts");
    expect(scripts["test:e2e:a11y"]).toContain("accessibility.journey.test.ts");
    expect(scripts["test:e2e:live"]).toContain("live-provider.journey.test.ts");

    const html = readAppFile("index.html");
    expect(html).toContain('src="/src/browser/main.tsx"');
    expect(html).not.toContain("/src/server/");

    const viteConfig = readAppFile("vite.config.ts");
    expect(viteConfig).toContain('host: "127.0.0.1"');
    expect(viteConfig).toContain('"src/**/*.test.{ts,tsx}"');
    expect(viteConfig).toContain('"e2e/**/*.journey.test.ts"');
    expect(viteConfig).not.toContain("src/server/main");

    const tsconfig = JSON.parse(readAppFile("tsconfig.json")) as Record<string, unknown>;
    expect(tsconfig["extends"]).toBe("../../tsconfig.base.json");
    expect(tsconfig["include"]).toEqual(["src", "e2e", "vite.config.ts"]);
  });
});
