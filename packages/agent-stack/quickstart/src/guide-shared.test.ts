import { describe, expect, it } from "vitest";
import { QUICKSTART_NAV_ITEMS, quickstartNavNodes } from "./guide-shared.js";

describe("quickstartNavNodes", () => {
  it("builds the stable nine-node navigation subtree for one screen namespace", () => {
    const nodes = quickstartNavNodes("home");
    const expectedIds = [
      "qs.nav.home",
      ...QUICKSTART_NAV_ITEMS.flatMap(({ to }) => [`qs.nav.home.${to}`, `qs.nav.home.${to}.label`]),
    ];

    expect(Object.keys(nodes)).toEqual(expectedIds);
    expect(nodes["qs.nav.home"]?.type).toBe("box");
    for (const item of QUICKSTART_NAV_ITEMS) {
      expect(nodes[`qs.nav.home.${item.to}`]).toMatchObject({
        activeWhen: { screen: item.to },
        onPress: { kind: "navigate", to: item.to },
      });
      expect(nodes[`qs.nav.home.${item.to}.label`]).toMatchObject({
        value: item.label,
        activeWhen: { screen: item.to },
      });
    }
  });
});
