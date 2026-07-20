import { describe, expect, it, vi } from "vitest";

import {
  LAB_ROUTES,
  PRODUCT_AREAS,
  focusSelectedRoute,
  isProductAreaActive,
  moveProductAreaFocus,
  resolveLabRoute,
} from "./navigation.js";

describe("Lab navigation", () => {
  it("supports named keyboard navigation across every product area", () => {
    expect(PRODUCT_AREAS.map(({ id, label, path }) => ({ id, label, path }))).toEqual([
      { id: "catalog", label: "Catalog", path: "/catalog" },
      { id: "generate", label: "Generate", path: "/generate" },
      { id: "runs", label: "Runs", path: "/runs" },
      { id: "replay", label: "Replay", path: "/replay" },
      { id: "sandbox", label: "Sandbox", path: "/sandbox" },
    ]);
    expect(new Set(PRODUCT_AREAS.flatMap(({ routes }) => routes)).size).toBe(LAB_ROUTES.length);

    expect(moveProductAreaFocus("catalog", "ArrowRight")).toBe("generate");
    expect(moveProductAreaFocus("generate", "ArrowDown")).toBe("runs");
    expect(moveProductAreaFocus("runs", "End")).toBe("sandbox");
    expect(moveProductAreaFocus("sandbox", "ArrowRight")).toBe("catalog");
    expect(moveProductAreaFocus("catalog", "ArrowLeft")).toBe("sandbox");
    expect(moveProductAreaFocus("replay", "Home")).toBe("catalog");
    expect(moveProductAreaFocus("replay", "Escape")).toBeNull();

    const cases = [
      ["/", "catalog", "catalog"],
      ["/catalog/", "catalog", "catalog"],
      ["/generate", "generate", "generate"],
      ["/scenarios", "scenarios", "generate"],
      ["/runs", "runs", "runs"],
      ["/runs/11111111-1111-4111-8111-111111111111", "run-detail", "runs"],
      ["/replay", "replay", "replay"],
      ["/replay/11111111-1111-4111-8111-111111111111", "replay", "replay"],
      ["/compare", "compare", "replay"],
      ["/sandbox", "sandbox", "sandbox"],
      ["/settings", "settings", "sandbox"],
      ["/unknown", "not-found", null],
    ] as const;
    for (const [path, routeId, areaId] of cases) {
      const route = resolveLabRoute(path);
      expect(route.id, path).toBe(routeId);
      expect(route.areaId, path).toBe(areaId);
      for (const area of PRODUCT_AREAS) {
        expect(isProductAreaActive(area.id, route), `${path}:${area.id}`).toBe(area.id === areaId);
      }
    }
  });

  it("moves a selected route to the top without letting focus restore the old scroll", () => {
    const target = { focus: vi.fn() };
    const viewport = { scrollTo: vi.fn() };

    focusSelectedRoute(target, viewport);

    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("still resets the route scroll when no focus target is mounted", () => {
    const viewport = { scrollTo: vi.fn() };

    focusSelectedRoute(null, viewport);

    expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
