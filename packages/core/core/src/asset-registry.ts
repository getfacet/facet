import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";
import { isPlainObject } from "./json-shape.js";

/** The trusted image descriptor admitted by Facet V1. */
export interface FacetImageAsset {
  readonly kind: "image";
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
}

/** The closed V1 asset descriptor union. */
export type FacetAssetDescriptor = FacetImageAsset;

/** One immutable host-pinned asset snapshot, keyed by Facet identifiers. */
export type FacetAssetRegistry = Readonly<Record<string, FacetAssetDescriptor>>;

/** The result of validating and snapshotting a host asset registry. */
export type FacetAssetRegistryValidationResult =
  | { readonly ok: true; readonly registry: FacetAssetRegistry }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

type AssetRejection = Extract<FacetAssetRegistryValidationResult, { readonly ok: false }>;

const REGISTRY_AT = "assetRegistry";
const DESCRIPTOR_KEYS: readonly string[] = ["kind", "src", "width", "height"];
const ASSET_PREFIX = "asset:";
const IMAGE_MEDIA_TYPE = /^image\/[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const DATA_PARAMETER = /^[A-Za-z0-9!#$&^_.+-]+(?:=[A-Za-z0-9!#$&^_.+%'~-]+)?$/;

/**
 * Validates a host registry and returns a null-prototype immutable snapshot.
 * No property read or reflection failure escapes this trust boundary.
 */
export function validateFacetAssetRegistry(value: unknown): FacetAssetRegistryValidationResult {
  try {
    return validateRegistry(value);
  } catch {
    return reject(
      "asset_registry_read_failed",
      REGISTRY_AT,
      "Reading the asset registry threw; it must be plain data.",
    );
  }
}

function validateRegistry(value: unknown): FacetAssetRegistryValidationResult {
  if (!isPlainObject(value)) {
    return reject(
      "asset_registry_not_an_object",
      REGISTRY_AT,
      "An asset registry must be a plain object.",
    );
  }
  const keys = boundedEnumerableKeys(value, BOUNDS.dataModelObjectKeys);
  if (keys === null) {
    return reject("too_many_assets", REGISTRY_AT, "Asset registry size exceeds B-18.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return reject("invalid_asset_key", REGISTRY_AT, "Asset keys must be string Facet identifiers.");
  }

  const registry = Object.create(null) as Record<string, FacetAssetDescriptor>;
  for (const key of keys) {
    const at = `${REGISTRY_AT}.${key}`;
    if (!isFacetIdentifier(key)) {
      return reject("invalid_asset_key", at, "An asset key must be a Facet identifier.");
    }
    const descriptor = validateDescriptor(value[key], at);
    if (!descriptor.ok) {
      return descriptor;
    }
    defineFrozenEntry(registry, key, descriptor.descriptor);
  }
  return { ok: true, registry: Object.freeze(registry) };
}

function validateDescriptor(
  value: unknown,
  at: string,
): { readonly ok: true; readonly descriptor: FacetAssetDescriptor } | AssetRejection {
  if (!isPlainObject(value)) {
    return reject("invalid_asset_descriptor", at, "An asset descriptor must be a plain object.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return reject(
      "unknown_asset_descriptor_key",
      at,
      "An asset descriptor accepts string keys only.",
    );
  }
  const unknownKey = firstUnknownKey(value, DESCRIPTOR_KEYS);
  if (unknownKey !== undefined) {
    return reject(
      "unknown_asset_descriptor_key",
      `${at}.${unknownKey}`,
      "The asset descriptor form is closed.",
    );
  }

  if (value["kind"] !== "image") {
    return reject("invalid_asset_kind", `${at}.kind`, "Facet V1 admits image assets only.");
  }

  const src = value["src"];
  if (typeof src !== "string" || src.length === 0) {
    return reject(
      "invalid_image_asset_src",
      `${at}.src`,
      "An image source must be an HTTPS URL or data:image URI.",
    );
  }
  if (src.length > BOUNDS.dataModelStringChars) {
    return reject("image_asset_src_too_long", `${at}.src`, "Image source length exceeds B-19.");
  }
  if (!isSafeImageSource(src)) {
    return reject(
      "invalid_image_asset_src",
      `${at}.src`,
      "An image source must be an HTTPS URL or data:image URI.",
    );
  }

  const dimensions: { width?: number; height?: number } = {};
  for (const name of ["width", "height"] as const) {
    if (!(name in value)) {
      continue;
    }
    const dimension = value[name];
    if (typeof dimension !== "number" || !Number.isSafeInteger(dimension) || dimension <= 0) {
      return reject(
        "invalid_image_asset_dimension",
        `${at}.${name}`,
        `${name} must be a positive safe integer.`,
      );
    }
    dimensions[name] = dimension;
  }

  return {
    ok: true,
    descriptor: Object.freeze({ kind: "image", src, ...dimensions }),
  };
}

/**
 * Resolves a bare key or `asset:<key>` reference from a validated registry.
 * Unknown keys, unsupported kinds, forged descriptors, and hostile inputs all
 * fail closed with `null`.
 */
export function resolveFacetAsset(
  registry: FacetAssetRegistry,
  reference: unknown,
  expectedKind: FacetAssetDescriptor["kind"] = "image",
): FacetAssetDescriptor | null {
  try {
    if (!isPlainObject(registry) || expectedKind !== "image" || typeof reference !== "string") {
      return null;
    }
    const key = reference.startsWith(ASSET_PREFIX)
      ? reference.slice(ASSET_PREFIX.length)
      : reference;
    if (!isFacetIdentifier(key) || !Object.hasOwn(registry, key)) {
      return null;
    }
    const descriptor = registry[key];
    const validation = validateDescriptor(descriptor, `${REGISTRY_AT}.${key}`);
    if (!validation.ok) {
      return null;
    }
    return validation.descriptor;
  } catch {
    return null;
  }
}

function isSafeImageSource(value: string): boolean {
  if (value.startsWith("https://")) {
    if (hasUrlControlOrSpace(value)) {
      return false;
    }
    const authorityEnd = value.slice("https://".length).search(/[/?#]/);
    const authority =
      authorityEnd < 0
        ? value.slice("https://".length)
        : value.slice("https://".length, "https://".length + authorityEnd);
    if (authority.length === 0 || authority.includes("\\")) {
      return false;
    }
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && parsed.hostname.length > 0;
    } catch {
      return false;
    }
  }
  if (!value.startsWith("data:image/")) {
    return false;
  }
  const comma = value.indexOf(",");
  if (comma < 0 || comma === value.length - 1) {
    return false;
  }
  const metadata = value.slice("data:".length, comma);
  const [mediaType, ...parameters] = metadata.split(";");
  if (mediaType === undefined || !IMAGE_MEDIA_TYPE.test(mediaType)) {
    return false;
  }
  return parameters.every(
    (parameter, index) =>
      parameter.length > 0 &&
      (parameter === "base64" ? index === parameters.length - 1 : DATA_PARAMETER.test(parameter)),
  );
}

function hasUrlControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function firstUnknownKey(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): string | undefined {
  const keys = boundedEnumerableKeys(record, BOUNDS.propsPerElement);
  return keys?.find((key) => !allowed.includes(key));
}

function boundedEnumerableKeys(
  record: Readonly<Record<string, unknown>>,
  limit: number,
): readonly string[] | null {
  const keys: string[] = [];
  for (const key in record) {
    if (!Object.hasOwn(record, key)) {
      break;
    }
    keys.push(key);
    if (keys.length > limit) {
      return null;
    }
  }
  return Object.freeze(keys.sort());
}

function defineFrozenEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  });
}

function reject(code: string, at: string, detail: string): AssetRejection {
  return { ok: false, code, at, detail };
}
