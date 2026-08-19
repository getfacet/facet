import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import type {
  FacetAssetDescriptor,
  FacetAssetRegistry,
  FacetAssetRegistryValidationResult,
  FacetImageAsset,
} from "./asset-registry.js";
import { resolveFacetAsset, validateFacetAssetRegistry } from "./asset-registry.js";

function image(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "image",
    src: "https://cdn.example.com/assets/hero.png",
    ...overrides,
  };
}

function acceptRegistry(value: unknown): FacetAssetRegistry {
  const result = validateFacetAssetRegistry(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.registry;
}

function rejection(value: unknown): readonly [string, string] {
  const result = validateFacetAssetRegistry(value);
  return result.ok ? ["accepted", "accepted"] : [result.code, result.at];
}

describe("validateFacetAssetRegistry - immutable image snapshots", () => {
  it("accepts the explicit empty default registry", () => {
    const registry = acceptRegistry({});

    expect(Object.keys(registry)).toEqual([]);
    expect(Object.getPrototypeOf(registry)).toBeNull();
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it("accepts HTTPS and data-image descriptors and snapshots every level", () => {
    const source = {
      hero: image({ width: 1600, height: 900 }),
      logo: image({ src: "data:image/png;base64,iVBORw0KGgo=" }),
      mark: image({ src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E" }),
    };

    const registry = acceptRegistry(source);

    expect(registry).toEqual(source);
    expect(Object.getPrototypeOf(registry)).toBeNull();
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry["hero"])).toBe(true);

    source.hero.src = "https://attacker.example/replaced.png";
    source.hero.width = 1;
    source.logo = image({ src: "https://attacker.example/replaced-logo.png" });
    expect(registry["hero"]).toEqual({
      kind: "image",
      src: "https://cdn.example.com/assets/hero.png",
      width: 1600,
      height: 900,
    });
    expect(registry["logo"]?.kind).toBe("image");
  });

  it("keeps the public descriptor, registry, and result types usable", () => {
    const descriptor: FacetImageAsset = {
      kind: "image",
      src: "https://example.com/image.webp",
    };
    const asset: FacetAssetDescriptor = descriptor;
    const registry: FacetAssetRegistry = { hero: asset };
    const result: FacetAssetRegistryValidationResult = { ok: true, registry };

    expect(result.registry.hero).toBe(descriptor);
  });

  it("stores prototype-shaped valid Facet keys as own entries", () => {
    const source = Object.create(null) as Record<string, unknown>;
    source["constructor"] = image();
    const registry = acceptRegistry(source);

    expect(Object.hasOwn(registry, "constructor")).toBe(true);
    expect(resolveFacetAsset(registry, "constructor", "image")).toEqual(registry["constructor"]);
  });
});

describe("validateFacetAssetRegistry - closed bounded input", () => {
  it("requires a plain key-to-descriptor record", () => {
    expect(rejection(undefined)).toEqual(["asset_registry_not_an_object", "assetRegistry"]);
    expect(rejection([])).toEqual(["asset_registry_not_an_object", "assetRegistry"]);
    expect(rejection(new Date(0))).toEqual(["asset_registry_not_an_object", "assetRegistry"]);
  });

  it("requires bounded Facet keys and reports the sorted invalid key first", () => {
    expect(rejection({ "z bad": image(), "a bad": image() })).toEqual([
      "invalid_asset_key",
      "assetRegistry.a bad",
    ]);

    const tooMany = Object.fromEntries(
      Array.from({ length: BOUNDS.dataModelObjectKeys + 1 }, (_, index) => [
        `Asset${index}`,
        image(),
      ]),
    );
    expect(rejection(tooMany)).toEqual(["too_many_assets", "assetRegistry"]);
  });

  it("accepts a key at B-06 and rejects one character past it", () => {
    const atLimit = `A${"a".repeat(BOUNDS.identifierChars - 1)}`;
    const pastLimit = `A${"a".repeat(BOUNDS.identifierChars)}`;

    expect(acceptRegistry({ [atLimit]: image() })[atLimit]?.kind).toBe("image");
    expect(rejection({ [pastLimit]: image() })).toEqual([
      "invalid_asset_key",
      `assetRegistry.${pastLimit}`,
    ]);
  });

  it("rejects non-image and open descriptors", () => {
    expect(rejection({ hero: null })).toEqual(["invalid_asset_descriptor", "assetRegistry.hero"]);
    expect(rejection({ hero: image({ kind: "video" }) })).toEqual([
      "invalid_asset_kind",
      "assetRegistry.hero.kind",
    ]);
    expect(rejection({ hero: image({ alt: "not registry metadata", zzz: true }) })).toEqual([
      "unknown_asset_descriptor_key",
      "assetRegistry.hero.alt",
    ]);
  });

  it.each([
    ["", "invalid_image_asset_src"],
    ["http://example.com/image.png", "invalid_image_asset_src"],
    ["javascript:alert(1)", "invalid_image_asset_src"],
    ["//example.com/image.png", "invalid_image_asset_src"],
    ["https:///missing-host.png", "invalid_image_asset_src"],
    ["data:text/plain,hello", "invalid_image_asset_src"],
    ["data:image/png", "invalid_image_asset_src"],
    ["data:image/png,", "invalid_image_asset_src"],
    ["x".repeat(BOUNDS.dataModelStringChars + 1), "image_asset_src_too_long"],
  ] as const)("rejects an unsafe or over-bound image source", (src, code) => {
    expect(rejection({ hero: image({ src }) })).toEqual([code, "assetRegistry.hero.src"]);
  });

  it("accepts an image source at the B-19 limit", () => {
    const prefix = "data:image/png,";
    const src = `${prefix}${"a".repeat(BOUNDS.dataModelStringChars - prefix.length)}`;

    expect(acceptRegistry({ hero: image({ src }) })["hero"]?.src).toBe(src);
  });

  it.each([
    ["width", 0],
    ["width", -1],
    ["width", 1.5],
    ["width", Number.NaN],
    ["width", Number.POSITIVE_INFINITY],
    ["width", Number.MAX_SAFE_INTEGER + 1],
    ["height", 0],
    ["height", "100"],
  ] as const)("requires %s to be a positive safe integer", (dimension, value) => {
    expect(rejection({ hero: image({ [dimension]: value }) })).toEqual([
      "invalid_image_asset_dimension",
      `assetRegistry.hero.${dimension}`,
    ]);
  });

  it("rejects symbol metadata that cannot be represented in a registry record", () => {
    const source = { hero: image() };
    Object.defineProperty(source, Symbol("hidden"), { value: image(), enumerable: true });

    expect(rejection(source)).toEqual(["invalid_asset_key", "assetRegistry"]);
  });
});

describe("resolveFacetAsset", () => {
  const registry = acceptRegistry({
    hero: image({ width: 1200 }),
    logo: image({ src: "data:image/webp;base64,UklGRg==" }),
  });

  it("resolves bare and authored keys only for the expected kind", () => {
    const hero = resolveFacetAsset(registry, "hero", "image");

    expect(hero).toEqual(registry["hero"]);
    expect(Object.isFrozen(hero)).toBe(true);
    expect(resolveFacetAsset(registry, "asset:logo", "image")).toEqual(registry["logo"]);
    expect(resolveFacetAsset(registry, "hero")).toEqual(registry["hero"]);
  });

  it("returns null for unknown, malformed, or kind-mismatched references", () => {
    expect(resolveFacetAsset(registry, "missing", "image")).toBeNull();
    expect(resolveFacetAsset(registry, "asset:", "image")).toBeNull();
    expect(resolveFacetAsset(registry, "https://example.com/image.png", "image")).toBeNull();
    expect(resolveFacetAsset(registry, "hero", "video")).toBeNull();
    expect(resolveFacetAsset(registry, null, "image")).toBeNull();
  });

  it("fails closed for a forged malformed registry", () => {
    const forged = Object.freeze({
      hero: Object.freeze({ kind: "image", src: "http://example.com/image.png" }),
    }) as unknown as FacetAssetRegistry;

    expect(resolveFacetAsset(forged, "hero", "image")).toBeNull();
  });
});

describe("asset registry totality", () => {
  it("survives hostile registry and descriptor access", () => {
    const hostileRegistry = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("boom");
        },
      },
    );
    const hostileDescriptor = {
      get kind(): never {
        throw new Error("boom");
      },
    };

    expect(() => validateFacetAssetRegistry(hostileRegistry)).not.toThrow();
    expect(rejection(hostileRegistry)).toEqual(["asset_registry_read_failed", "assetRegistry"]);
    expect(rejection({ hero: hostileDescriptor })).toEqual([
      "asset_registry_read_failed",
      "assetRegistry",
    ]);
  });

  it("makes resolver failures total too", () => {
    const revoked = Proxy.revocable({ hero: image() }, {});
    revoked.revoke();

    expect(() =>
      resolveFacetAsset(revoked.proxy as unknown as FacetAssetRegistry, "hero", "image"),
    ).not.toThrow();
    expect(
      resolveFacetAsset(revoked.proxy as unknown as FacetAssetRegistry, "hero", "image"),
    ).toBeNull();
  });
});
