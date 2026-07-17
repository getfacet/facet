import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

describe("workspace facet-bridge bin", () => {
  it("registers the TypeScript resolver and reaches CLI validation", () => {
    const result = spawnSync(process.execPath, ["src/dev-bin.mjs"], {
      cwd: packageRoot,
      env: { ...process.env, FACET_RUNNER: "definitely-invalid" },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid FACET_RUNNER "definitely-invalid"');
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
