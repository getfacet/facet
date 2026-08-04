import { DEFAULT_CATALOG } from "@facet/assets";
import { describe, expect, it } from "vitest";

import { screenPatterns } from "./screen-gallery-fixtures.js";

describe("screen gallery fixtures", () => {
  it("validates default screen patterns against the default catalog", () => {
    const patterns = screenPatterns(DEFAULT_CATALOG);

    expect(patterns.map((pattern) => pattern.id)).toEqual([
      "revenue-command-center",
      "customer-success-review",
      "workspace-settings-flow",
      "support-operations-board",
      "security-audit-console",
      "brand-campaign-studio",
      "product-launch-dossier",
      "service-control-panel",
      "ecommerce-order-desk",
      "booking-reservation-manager",
      "subscription-billing-center",
      "personal-finance-wallet",
      "resume-bio-profile",
    ]);

    for (const pattern of patterns) {
      expect(pattern.roles.length, pattern.id).toBeGreaterThan(0);
      expect(pattern.result.ok, pattern.id).toBe(true);
      if (!pattern.result.ok) continue;

      expect(pattern.result.fixture.tag).toBe("Screen");
      expect(pattern.result.fixture.document.nodes[pattern.result.fixture.targetNodeId]?.tag).toBe(
        "Screen",
      );
    }
  });

  it("keeps table rows in the data model rather than inline screen markup", () => {
    const table = screenPatterns().find((pattern) => pattern.id === "revenue-command-center");

    expect(table?.result.ok).toBe(true);
    if (table === undefined || !table.result.ok) {
      throw new Error("Missing revenue command center pattern");
    }

    expect(table.result.fixture.source).toContain('rows="data:pipelineRows"');
    expect(table.result.fixture.source).not.toContain('rows="[');
    expect(table.result.fixture.data["pipelineRows"]).toEqual([
      { account: "Acme", stage: "Negotiation", owner: "Mina", arr: 42000 },
      { account: "Northwind", stage: "Legal", owner: "Jules", arr: 31000 },
      { account: "Globex", stage: "Expansion", owner: "Ari", arr: 28000 },
      { account: "Initech", stage: "Risk review", owner: "Nora", arr: 19000 },
    ]);
  });
});
