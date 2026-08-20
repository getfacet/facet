import type { ComponentMountProps } from "@facet/core";
import { describe, expect, it } from "vitest";

import {
  arrayProp,
  countProp,
  enumProp,
  flagProp,
  imageAssetProp,
  numberProp,
  stringProp,
  textProp,
} from "./style.js";

type ResolvedProps = ComponentMountProps["props"];

function resolved(values: Record<string, ResolvedProps[string]>): ResolvedProps {
  return values;
}

describe("trusted component prop readers", () => {
  it("reads strings without erasing an intentional empty value", () => {
    const props = resolved({ empty: "", label: "  Account  ", count: 2 });

    expect(stringProp(props, "empty", "fallback")).toBe("");
    expect(stringProp(props, "count", "fallback")).toBe("fallback");
    expect(textProp(props, "label")).toBe("  Account  ");
    expect(textProp(props, "empty")).toBeUndefined();
  });

  it("folds enums, flags, finite numbers, and whole-number counts to their bounds", () => {
    const props = resolved({
      tone: "unexpected",
      enabled: "true",
      amount: 140,
      columns: 3.9,
      notFinite: Number.NaN,
    });

    expect(enumProp(props, "tone", ["neutral", "accent"] as const, "neutral")).toBe("neutral");
    expect(flagProp(props, "enabled", false)).toBe(false);
    expect(numberProp(props, "amount", 0, 100, 0)).toBe(100);
    expect(numberProp(props, "notFinite", 0, 100, 7)).toBe(7);
    expect(countProp(props, "columns", 1, 4, 2)).toBe(3);
  });

  it("returns a bounded copy of array props", () => {
    const values = [1, 2, 3, 4];
    const result = arrayProp(resolved({ values }), "values", 2);

    expect(result).toEqual([1, 2]);
    expect(result).not.toBe(values);
    expect(arrayProp(resolved({ values: "not-an-array" }), "values", 2)).toEqual([]);
  });

  it("admits only a validated resolved image descriptor", () => {
    const descriptor = {
      kind: "image" as const,
      src: "https://cdn.example.test/product.png",
      width: 800,
      height: 600,
    };

    expect(imageAssetProp(resolved({ asset: descriptor }), "asset")).toEqual(descriptor);
    expect(imageAssetProp(resolved({ asset: descriptor.src }), "asset")).toBeUndefined();
    expect(
      imageAssetProp(resolved({ asset: { kind: "image", src: "javascript:alert(1)" } }), "asset"),
    ).toBeUndefined();
    expect(
      imageAssetProp(
        resolved({ asset: { kind: "image", src: descriptor.src, width: 0 } }),
        "asset",
      ),
    ).toBeUndefined();
  });

  it("is total over hostile prop records and values", () => {
    const hostileProps = new Proxy(Object.create(null) as ResolvedProps, {
      getOwnPropertyDescriptor(): PropertyDescriptor {
        throw new Error("descriptor trap");
      },
    });
    const hostileArray = new Proxy([], {
      get(): never {
        throw new Error("array trap");
      },
    });
    const hostileAsset = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("asset trap");
        },
      },
    );

    expect(stringProp(hostileProps, "label", "fallback")).toBe("fallback");
    expect(enumProp(hostileProps, "tone", ["neutral"] as const, "neutral")).toBe("neutral");
    expect(flagProp(hostileProps, "enabled", false)).toBe(false);
    expect(numberProp(hostileProps, "amount", 0, 100, 7)).toBe(7);
    expect(arrayProp(hostileProps, "values", 2)).toEqual([]);
    expect(arrayProp(resolved({ values: hostileArray }), "values", 2)).toEqual([]);
    expect(imageAssetProp(resolved({ asset: hostileAsset }), "asset")).toBeUndefined();
  });
});
