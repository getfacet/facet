import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "@facet/assets";

import {
  DEFERRED_SERVICE_SURFACE_COMPONENTS,
  SERVICE_SURFACE_GROUPS,
  SHIPPED_SERVICE_SURFACE_COMPONENTS,
} from "./service-surfaces.js";

describe("service surface taxonomy", () => {
  it("locks the twelve target service families", () => {
    expect(SERVICE_SURFACE_GROUPS.map((group) => group.id)).toEqual([
      "landing",
      "personal-profile-resume",
      "commerce",
      "saas",
      "analytics",
      "booking-consultation",
      "support",
      "onboarding",
      "operations-board",
      "calendar-scheduling",
      "messaging",
      "form-result",
    ]);
  });

  it("marks only work-oriented families as dashboard-like", () => {
    const dashboardGroups = SERVICE_SURFACE_GROUPS.filter((group) => group.dashboardLike);

    expect(dashboardGroups.map((group) => group.id)).toEqual([
      "saas",
      "analytics",
      "operations-board",
    ]);
  });

  it("maps every group to safe shipped components", () => {
    const shipped = new Set<string>(SHIPPED_SERVICE_SURFACE_COMPONENTS);

    for (const group of SERVICE_SURFACE_GROUPS) {
      expect(group.shippedComponents.length, group.id).toBeGreaterThanOrEqual(4);
      expect(
        group.shippedComponents.filter((tag) => !shipped.has(tag)),
        group.id,
      ).toEqual([]);
    }
  });

  it("keeps the shipped service-surface vocabulary in lockstep with the default catalog", () => {
    const catalogTags = DEFAULT_CATALOG.components.map((component) => component.tag);

    expect(SHIPPED_SERVICE_SURFACE_COMPONENTS).toEqual(catalogTags);
  });

  it("covers every shipped component across the twelve families", () => {
    const used = new Set(SERVICE_SURFACE_GROUPS.flatMap((group) => group.shippedComponents));
    expect([...used].sort()).toEqual([...SHIPPED_SERVICE_SURFACE_COMPONENTS].sort());
  });

  it("has no deferred components outside the approved catalog", () => {
    expect(DEFERRED_SERVICE_SURFACE_COMPONENTS).toEqual([]);
  });
});
