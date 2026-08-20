import assert from "node:assert/strict";
import test from "node:test";

import {
  conditionTarget,
  expectedBins,
  expectedPackageCount,
  expectedRuntimeExports,
  exportSurfaces,
  packageDirectories,
  packageRoots,
  retiredBinNames,
} from "./package-smoke.mjs";

test("pins the public package-smoke inventory", () => {
  assert.deepEqual(packageRoots, [
    "packages/core",
    "packages/renderers",
    "packages/agents",
    "packages/adapters",
    "packages/tools",
  ]);
  assert.equal(expectedPackageCount, 11);
  assert.equal(packageDirectories().length, expectedPackageCount);
  assert.deepEqual(Object.keys(expectedBins), ["facet-quickstart"]);
  assert.deepEqual(retiredBinNames, ["facet", "facet-bridge"]);
});

test("pins core exports added for shared contract helpers", () => {
  assert.equal(expectedRuntimeExports["@facet/core"].includes("parseAuthoredNumber"), true);
  assert.equal(expectedRuntimeExports["@facet/core"].includes("describeDataValue"), true);
  assert.equal(expectedRuntimeExports["@facet/core"].includes("dataValuePresenceCount"), true);
  assert.equal(expectedRuntimeExports["@facet/core"].includes("deriveComponentContentClass"), true);
  assert.equal(expectedRuntimeExports["@facet/core"].includes("resolveFacetAsset"), true);
  assert.equal(expectedRuntimeExports["@facet/core"].includes("validateFacetAssetRegistry"), true);
});

test("pins the agent-facing grouped catalog formatter", () => {
  assert.equal(expectedRuntimeExports["@facet/agent-tools"].includes("formatCatalogIndex"), true);
});

test("normalizes export surfaces and condition targets", () => {
  assert.deepEqual(exportSurfaces("@facet/example", "./dist/index.js"), [
    { specifier: "@facet/example", conditions: "./dist/index.js" },
  ]);
  assert.deepEqual(
    exportSurfaces("@facet/example", {
      ".": { import: "./dist/index.js", require: "./dist/index.cjs" },
      "./react": { import: "./dist/react.js" },
    }),
    [
      {
        specifier: "@facet/example",
        conditions: { import: "./dist/index.js", require: "./dist/index.cjs" },
      },
      { specifier: "@facet/example/react", conditions: { import: "./dist/react.js" } },
    ],
  );
  assert.equal(conditionTarget({ import: "./dist/index.js" }, "import"), "./dist/index.js");
  assert.equal(conditionTarget({ import: "./dist/index.js" }, "require"), undefined);
});
