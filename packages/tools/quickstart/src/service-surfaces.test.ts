import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "@facet/assets";

import {
  DEFERRED_SERVICE_SURFACE_COMPONENTS,
  SERVICE_SURFACE_GROUPS,
  SHIPPED_SERVICE_SURFACE_COMPONENTS,
} from "./service-surfaces.js";

describe("service surface taxonomy", () => {
  it("locks the seven target service groups", () => {
    expect(SERVICE_SURFACE_GROUPS.map((group) => group.id)).toEqual([
      "personal-presence",
      "marketing-landing",
      "commerce-booking",
      "saas-workspace",
      "content-editorial",
      "data-report",
      "support-form-flow",
    ]);
  });

  it("treats dashboard/workspace as one service group, not the default identity", () => {
    const dashboardGroups = SERVICE_SURFACE_GROUPS.filter((group) => group.dashboardLike);

    expect(dashboardGroups.map((group) => group.id)).toEqual(["saas-workspace"]);
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
    const catalogTags = DEFAULT_CATALOG.components.map((component) => component.tag).sort();

    expect([...SHIPPED_SERVICE_SURFACE_COMPONENTS].sort()).toEqual(catalogTags);
  });

  it("does not force work/data components into every surface", () => {
    const workTags = new Set(["Metric"]);
    const groupsUsingWorkTags = SERVICE_SURFACE_GROUPS.filter((group) =>
      group.shippedComponents.some((tag) => workTags.has(tag)),
    );

    expect(groupsUsingWorkTags.map((group) => group.id).sort()).toEqual([
      "data-report",
      "saas-workspace",
    ]);
  });

  it("defers unsafe or overly-specific candidates instead of half-opening them", () => {
    expect(DEFERRED_SERVICE_SURFACE_COMPONENTS).toEqual(["Image", "Logo", "Pricing", "Form"]);
  });
});
