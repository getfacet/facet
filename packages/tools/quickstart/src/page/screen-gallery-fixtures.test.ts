import { DEFAULT_CATALOG } from "@facet/assets";
import { describe, expect, it } from "vitest";

import { resolveQuickstartDesignOverlay } from "../design-overlay.js";
import { screenPatterns } from "./screen-gallery-fixtures.js";

function activeOverlayExamples() {
  const result = resolveQuickstartDesignOverlay({
    examples: [
      {
        id: "launch-operations-screen",
        kind: "screen",
        label: "Launch operations",
        description: "Active design launch screen with table-backed rollout data.",
        tags: ["Screen", "Grid", "Card", "Metric", "Table"],
        data: {
          launchRows: [
            { item: "Creative brief", owner: "Mina", status: "Ready" },
            { item: "Partner proof", owner: "Jules", status: "Review" },
          ],
        },
        markup: `<Facet entry="preview">
  <Screen name="preview" title="Launch operations" maxWidth="wide" padding="lg">
    <Grid columns="2" gap="md" collapse="true">
      <Card title="Readiness" tone="accent" padding="lg">
        <Metric label="Launch score" value="92" unit="%" />
      </Card>
      <Card title="Rollout queue" tone="neutral" padding="md">
        <Table rows="data:launchRows" caption="Launch queue" />
      </Card>
    </Grid>
  </Screen>
</Facet>`,
      },
      {
        id: "launch-card-component",
        kind: "component",
        label: "Launch card",
        tags: ["Screen", "Card", "Text"],
        markup: `<Facet entry="preview">
  <Screen name="preview" title="Launch card">
    <Card title="Component example" tone="neutral" padding="md">
      <Text value="Component examples belong in the Components tab." />
    </Card>
  </Screen>
</Facet>`,
      },
    ],
  });

  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.detail}`);
  }

  return result.design;
}

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

  it("keeps revenue card statuses distinct from the two primary header actions", () => {
    const pattern = screenPatterns().find((candidate) => candidate.id === "revenue-command-center");

    expect(pattern?.result.ok).toBe(true);
    if (pattern === undefined || !pattern.result.ok) {
      throw new Error("Missing revenue command center pattern");
    }

    const source = pattern.result.fixture.source;
    const buttonLabels = [...source.matchAll(/<Button label="([^"]+)"/g)].map((match) => match[1]);

    expect(buttonLabels).toEqual(["Refresh", "Create plan"]);
    expect(source).toContain('<Badge label="On track" tone="positive" />');
    expect(source).toContain('<Badge label="Needs attention" tone="warning" />');
    expect(source).toContain('<Badge label="Strong signal" tone="positive" />');
    expect(source).toContain('<Badge label="Ready" tone="neutral" />');
    expect(source).not.toContain("Open forecast");
    expect(source).not.toContain("Review risks");
    expect(source).not.toContain("Plan outreach");
    expect(source).not.toContain("Update notes");
  });

  it("appends active overlay screen examples without changing default patterns", () => {
    const defaultPatterns = screenPatterns(DEFAULT_CATALOG);
    const design = activeOverlayExamples();
    const patterns = screenPatterns({ catalog: design.catalog, examples: design.examples });

    expect(patterns.slice(0, defaultPatterns.length).map((pattern) => pattern.id)).toEqual(
      defaultPatterns.map((pattern) => pattern.id),
    );
    expect(patterns.map((pattern) => pattern.id)).toContain("launch-operations-screen");
    expect(patterns.map((pattern) => pattern.id)).not.toContain("launch-card-component");
    expect(patterns.find((pattern) => pattern.id === "revenue-command-center")?.source).toBe(
      "default",
    );

    const overlayPattern = patterns.find((pattern) => pattern.id === "launch-operations-screen");
    expect(overlayPattern?.source).toBe("imported");
    expect(overlayPattern?.label).toBe("Launch operations");
    expect(overlayPattern?.description).toBe(
      "Active design launch screen with table-backed rollout data.",
    );
    expect(overlayPattern?.roles).toEqual(["Screen", "Grid", "Card", "Metric", "Table"]);
    expect(overlayPattern?.result.ok).toBe(true);
    if (overlayPattern === undefined || !overlayPattern.result.ok) {
      throw new Error("Missing active design screen pattern");
    }

    expect(overlayPattern.result.fixture.document).toBe(design.examples[0]?.document);
    expect(overlayPattern.result.fixture.source).toContain("<Screen");
    expect(overlayPattern.result.fixture.source).toContain('rows="data:launchRows"');
    expect(overlayPattern.result.fixture.data["launchRows"]).toEqual([
      { item: "Creative brief", owner: "Mina", status: "Ready" },
      { item: "Partner proof", owner: "Jules", status: "Review" },
    ]);
  });

  it("keeps active screen pattern ids selectable when they collide with default ids", () => {
    const result = resolveQuickstartDesignOverlay({
      examples: [
        {
          id: "revenue-command-center",
          kind: "screen",
          label: "Custom revenue command center",
          tags: ["Screen", "Text"],
          markup: `<Facet entry="preview">
  <Screen name="preview">
    <Text value="Custom active revenue screen" />
  </Screen>
</Facet>`,
        },
      ],
    });
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.detail}`);
    }

    const patterns = screenPatterns({
      catalog: result.design.catalog,
      examples: result.design.examples,
    });

    expect(patterns.map((pattern) => pattern.id)).toContain("revenue-command-center");
    expect(patterns.map((pattern) => pattern.id)).toContain("active:revenue-command-center");
    expect(patterns.find((pattern) => pattern.id === "active:revenue-command-center")?.label).toBe(
      "Custom revenue command center",
    );
  });
});
