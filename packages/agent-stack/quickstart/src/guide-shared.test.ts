import { describe, expect, it } from "vitest";
import { buildQuickstartNavigation, QUICKSTART_NAV_ITEMS } from "./guide-shared.js";

describe("buildQuickstartNavigation", () => {
  it("builds the stable nine-node navigation subtree for one screen namespace", () => {
    const nodes = buildQuickstartNavigation("home");
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
