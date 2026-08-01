import { describe, expect, it } from "vitest";

import {
  dataValueEntryCount,
  dataValueFields,
  dataValuePresenceCount,
  dataValueShape,
  describeDataValue,
} from "./data-descriptor.js";

describe("data value descriptors", () => {
  it("describes published arrays and objects with sorted field names", () => {
    expect(
      describeDataValue("rows", [{ z: 1, a: 2 }, { b: 3 }, null, ["not", "a", "row"]]),
    ).toEqual({
      path: "rows",
      shape: "array",
      fields: ["a", "b", "z"],
      count: 4,
    });

    expect(describeDataValue("settings", { beta: true, alpha: false })).toEqual({
      path: "settings",
      shape: "object",
      fields: ["alpha", "beta"],
      count: 2,
    });
  });

  it("supports presence counts for compact observation summaries", () => {
    expect(describeDataValue("rows", [{ id: 1 }], { count: "presence" }).count).toBe(1);
    expect(describeDataValue("rows", [], { count: "presence" }).count).toBe(0);
    expect(describeDataValue("missing", undefined, { count: "presence" }).count).toBe(0);
  });

  it("keeps scalar shape, fields, and counts stable", () => {
    expect(dataValueShape(null)).toBe("null");
    expect(dataValueShape("x")).toBe("string");
    expect(dataValueFields(1)).toEqual([]);
    expect(dataValueEntryCount(false)).toBe(1);
    expect(dataValuePresenceCount(false)).toBe(1);
  });

  it("describes hostile containers without throwing", () => {
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const hostileKeys = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("hostile keys");
        },
      },
    );

    for (const value of [revoked.proxy, hostileKeys]) {
      expect(() => describeDataValue("hostile", value)).not.toThrow();
      expect(describeDataValue("hostile", value)).toEqual({
        path: "hostile",
        shape: "object",
        fields: [],
        count: 0,
      });
    }
  });

  it("does not use an array iterator while collecting descriptor fields", () => {
    const rows = [{ name: "Ada" }, { email: "ada@example.test" }];
    Object.defineProperty(rows, Symbol.iterator, {
      value: (): never => {
        throw new Error("hostile iterator");
      },
    });

    expect(describeDataValue("rows", rows)).toEqual({
      path: "rows",
      shape: "array",
      fields: ["email", "name"],
      count: 2,
    });
  });
});
