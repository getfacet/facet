import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildQuickstartDesignPageBundle,
  QuickstartDesignPageBundleError,
} from "./design-page-bundle.js";
import { resolveQuickstartDesignOverlay, type QuickstartResolvedDesign } from "./design-overlay.js";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DESIGN_OVERLAY_TYPE_IMPORT = join(SOURCE_DIRECTORY, "design-overlay.js").replaceAll(sep, "/");

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeFixture(): Promise<{
  readonly root: string;
  readonly bundleParent: string;
  readonly overlayPath: string;
  readonly mountPath: string;
  readonly resolvedDesign: QuickstartResolvedDesign;
}> {
  const root = await mkdtemp(join(tmpdir(), "facet-design-page-bundle-test-"));
  temporaryRoots.push(root);
  const designDirectory = join(root, "facet-design");
  const bundleParent = join(root, "generated-bundles");
  await mkdir(designDirectory, { recursive: true });
  await mkdir(bundleParent, { recursive: true });

  const overlayPath = join(designDirectory, "index.tsx");
  await writeFile(
    overlayPath,
    `import type { QuickstartDesignOverlay } from "${DESIGN_OVERLAY_TYPE_IMPORT}";

const PromoHero = () => (
  <section data-facet-test-registry="PROMO_REGISTRY_SENTINEL">
    PROMO_REGISTRY_SENTINEL
  </section>
);

export default {
  components: [
    {
      tag: "PromoHero",
      whenToUse: "Use for a promotional hero fixture.",
      props: {},
      acceptsChildren: false,
    },
  ],
  registry: { PromoHero },
  notes: [
    {
      id: "bundle-fixture",
      title: "Bundle fixture",
      body: "The registry implementation must ship in the browser bundle.",
    },
  ],
} satisfies QuickstartDesignOverlay;
`,
  );

  const mountPath = join(root, "mount-design-page.ts");
  await writeFile(
    mountPath,
    `export function mountQuickstartDesignPage(options: {
  readonly overlay: { readonly registry?: unknown };
}): void {
  console.log("MOUNT_STUB_SENTINEL", options.overlay.registry);
}
`,
  );

  const resolved = resolveQuickstartDesignOverlay({
    components: [
      {
        tag: "PromoHero",
        whenToUse: "Use for a promotional hero fixture.",
        props: {},
        acceptsChildren: false,
      },
    ],
    registry: { PromoHero: () => null },
    notes: [
      {
        id: "bundle-fixture",
        title: "Bundle fixture",
        body: "The registry implementation must ship in the browser bundle.",
      },
    ],
  });
  if (!resolved.ok) {
    throw new Error(`${resolved.error.code}: ${resolved.error.detail}`);
  }

  return { root, bundleParent, overlayPath, mountPath, resolvedDesign: resolved.design };
}

describe("quickstart design page bundle", () => {
  it("builds a browser bundle that imports the overlay registry", async () => {
    const fixture = await makeFixture();

    const bundle = await buildQuickstartDesignPageBundle({
      overlayModulePath: fixture.overlayPath,
      pageMountModulePath: fixture.mountPath,
      temporaryParentDirectory: fixture.bundleParent,
      resolvedDesign: fixture.resolvedDesign,
      minify: false,
    });

    try {
      const output = await readFile(bundle.bundlePath, "utf8");

      expect(relative(fixture.bundleParent, bundle.temporaryDirectory).startsWith("..")).toBe(
        false,
      );
      expect(relative(bundle.temporaryDirectory, bundle.generatedEntryPath)).toBe(
        "design-entry.tsx",
      );
      expect(relative(bundle.temporaryDirectory, bundle.bundlePath)).toBe("app.js");
      expect(output).toContain("PROMO_REGISTRY_SENTINEL");
      expect(output).toContain("MOUNT_STUB_SENTINEL");
      expect(output).toContain("__FACET_QUICKSTART_DISABLE_AUTOMOUNT__");
      expect(output).toContain("mountQuickstartDesignPage");
      expect(output).not.toContain("__FACET_DESIGN_OVERLAY_JSON__");
    } finally {
      await bundle.cleanup();
    }

    expect(existsSync(bundle.temporaryDirectory)).toBe(false);
    expect(existsSync(fixture.overlayPath)).toBe(true);
    expect(existsSync(fixture.mountPath)).toBe(true);
  });

  it("embeds the resolved design metadata instead of re-reading module metadata", async () => {
    const fixture = await makeFixture();
    await writeFile(
      fixture.overlayPath,
      `const PromoHero = () => null;

export default {
  components: [
    {
      tag: "BrowserOnly",
      whenToUse: "Use for a divergent browser-only fixture.",
      props: {},
      acceptsChildren: false,
    },
  ],
  registry: { PromoHero },
};
`,
      "utf8",
    );

    const bundle = await buildQuickstartDesignPageBundle({
      overlayModulePath: fixture.overlayPath,
      pageMountModulePath: fixture.mountPath,
      temporaryParentDirectory: fixture.bundleParent,
      resolvedDesign: fixture.resolvedDesign,
      minify: false,
    });

    try {
      const generatedEntry = await readFile(bundle.generatedEntryPath, "utf8");
      expect(generatedEntry).toContain('"tag":"PromoHero"');
      expect(generatedEntry).not.toContain("BrowserOnly");
    } finally {
      await bundle.cleanup();
    }
  });

  it("surfaces build failures and removes generated paths", async () => {
    const fixture = await makeFixture();
    await writeFile(fixture.overlayPath, "export default ;\n");

    await expect(
      buildQuickstartDesignPageBundle({
        overlayModulePath: fixture.overlayPath,
        pageMountModulePath: fixture.mountPath,
        temporaryParentDirectory: fixture.bundleParent,
        resolvedDesign: fixture.resolvedDesign,
      }),
    ).rejects.toThrow(QuickstartDesignPageBundleError);

    await expect(
      buildQuickstartDesignPageBundle({
        overlayModulePath: fixture.overlayPath,
        pageMountModulePath: fixture.mountPath,
        temporaryParentDirectory: fixture.bundleParent,
        resolvedDesign: fixture.resolvedDesign,
      }),
    ).rejects.toThrow(/Failed to build quickstart design page bundle/);

    expect(await readdir(fixture.bundleParent)).toEqual([]);
  });
});
