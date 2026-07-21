import { existsSync } from "node:fs";

import { DEFAULT_THEME } from "@facet/assets";
import {
  BRICK_TYPES,
  validateAuthorTree,
  type BoxNode,
  type ChartNode,
  type FacetNode,
  type InputNode,
  type KeyValueNode,
  type ListNode,
  type MediaNode,
  type RichTextNode,
  type TableNode,
} from "@facet/core";
import { describe, expect, it } from "vitest";

import { BRICK_SAMPLE_CONSTRUCTORS, createBrickSample } from "./catalog-brick-samples.js";

function requireSample(brick: string, preset?: string) {
  const sample = createBrickSample(brick, preset);
  if (sample === undefined) throw new Error(`Expected ${brick} sample.`);
  return sample;
}

function nodeAs<T extends FacetNode>(node: FacetNode | undefined, type: T["type"]): T {
  if (node?.type !== type) throw new Error(`Expected ${type} node.`);
  return node as T;
}

describe("catalog Brick samples", () => {
  it("covers representative Brick samples", () => {
    expect(Object.keys(BRICK_SAMPLE_CONSTRUCTORS)).toEqual(BRICK_TYPES);

    for (const brick of BRICK_TYPES) {
      const sample = requireSample(brick);
      expect(validateAuthorTree(sample.tree, DEFAULT_THEME).issues, brick).toEqual([]);
    }

    const primaryAction = requireSample("box", "primaryAction");
    const primaryActionNode = nodeAs<BoxNode>(
      primaryAction.tree.nodes[primaryAction.nodeId],
      "box",
    );
    expect(primaryActionNode.style?.preset).toBe("primaryAction");
    expect(primaryActionNode.onPress).toEqual({ kind: "agent", name: "catalog_primary_action" });
    expect(primaryAction.tree.nodes["box-content"]).toMatchObject({
      type: "text",
      value: "Continue",
      style: { preset: "actionLabel" },
    });

    const successBadge = requireSample("box", "successBadge");
    expect(successBadge.tree.nodes["box-content"]).toMatchObject({
      type: "text",
      value: "Ready",
      style: { preset: "successBadge" },
    });

    const warningAlert = requireSample("box", "warningAlert");
    expect(warningAlert.tree.nodes["box-alert-title"]).toMatchObject({
      type: "text",
      value: "Review contrast",
      style: { preset: "warningAlert" },
    });

    const media = nodeAs<MediaNode>(requireSample("media").tree.nodes["sample-media"], "media");
    expect(media.src).toBe("/facet-catalog.svg");
    expect(existsSync(new URL("../../public/facet-catalog.svg", import.meta.url))).toBe(true);
    const thumbnail = nodeAs<MediaNode>(
      requireSample("media", "thumbnail").tree.nodes["sample-media"],
      "media",
    );
    expect(thumbnail.src).toBe("/facet-catalog-thumbnail.svg");
    expect(existsSync(new URL("../../public/facet-catalog-thumbnail.svg", import.meta.url))).toBe(
      true,
    );

    const inputSample = requireSample("input");
    const inputNodes = Object.values(inputSample.tree.nodes).filter(
      (node): node is InputNode => node.type === "input",
    );
    expect(inputNodes.map(({ input }) => input)).toEqual(["text", "email", "select", "checkbox"]);
    expect(inputNodes.find(({ input }) => input === "select")?.options).toEqual([
      "Starter",
      "Pro",
      "Enterprise",
    ]);

    const richtext = nodeAs<RichTextNode>(
      requireSample("richtext").tree.nodes["sample-richtext"],
      "richtext",
    );
    expect(richtext.blocks.map(({ type }) => type)).toEqual([
      "heading",
      "paragraph",
      "listItem",
      "quote",
    ]);
    expect(
      richtext.blocks
        .flatMap(({ runs }) => runs)
        .flatMap(({ marks }) => marks ?? [])
        .map(({ kind }) => kind),
    ).toContain("link");

    const table = nodeAs<TableNode>(requireSample("table").tree.nodes["sample-table"], "table");
    expect(table.columns.some(({ sortable }) => sortable === true)).toBe(true);
    expect(table.rows).toHaveLength(3);

    const chart = nodeAs<ChartNode>(requireSample("chart").tree.nodes["sample-chart"], "chart");
    expect(chart.labels).toHaveLength(4);
    expect(chart.series).toHaveLength(2);

    const list = nodeAs<ListNode>(requireSample("list").tree.nodes["sample-list"], "list");
    expect(list.items.some(({ body }) => (body?.length ?? 0) > 90)).toBe(true);

    const keyValue = nodeAs<KeyValueNode>(
      requireSample("keyValue").tree.nodes["sample-key-value"],
      "keyValue",
    );
    expect(keyValue.items.some(({ value }) => value.length > 80)).toBe(true);
  });
});
