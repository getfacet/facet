import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BRICK_TYPES,
  MEDIA_ICON_NAMES,
  MEDIA_KINDS,
  isContainer,
  type BoxNode,
  type BrickType,
  type ChartKind,
  type ChartNode,
  type ChartSeries,
  type ContainerNode,
  type FacetNode,
  type InputNode,
  type KeyValueItem,
  type KeyValueNode,
  type ListItem,
  type ListNode,
  type LoadingNode,
  type MediaIconName,
  type MediaNode,
  type ProgressNode,
  type TableColumn,
  type TableNode,
  type TableRow,
  type TextNode,
} from "./nodes.js";
import type { ChartAxis, ColumnWidth, LineStyle, TextAlign } from "./tokens.js";

const FINAL_BRICK_TYPES = [
  "box",
  "text",
  "media",
  "input",
  "richtext",
  "table",
  "chart",
  "list",
  "keyValue",
  "progress",
  "loading",
] as const;

const RETIRED_PUBLIC_NAMES = [
  "PRIMITIVE_BRICK_TYPES", // style-hard-cut: allowed-negative
  "PrimitiveBrickType", // style-hard-cut: allowed-negative
  "PrimitiveBrickNode", // style-hard-cut: allowed-negative
  "INTRINSIC_COMPONENT_TYPES", // style-hard-cut: allowed-negative
  "IntrinsicComponentType", // style-hard-cut: allowed-negative
  "LEGACY_COMPONENT_TYPES", // style-hard-cut: allowed-negative
  "LegacyComponentType", // style-hard-cut: allowed-negative
  "COMPONENT_NODE_TYPES", // style-hard-cut: allowed-negative
  "ComponentNodeType", // style-hard-cut: allowed-negative
  "IntrinsicComponentNode", // style-hard-cut: allowed-negative
  "LegacyComponentNode", // style-hard-cut: allowed-negative
  "ComponentNode", // style-hard-cut: allowed-negative
  "ButtonNode", // style-hard-cut: allowed-negative
  "TabItem",
  "TabsNode", // style-hard-cut: allowed-negative
  "NavItem",
  "NavNode", // style-hard-cut: allowed-negative
  "MetricNode", // style-hard-cut: allowed-negative
  "StatNode", // style-hard-cut: allowed-negative
  "FormNode", // style-hard-cut: allowed-negative
  "FilterBarFilter",
  "FilterBarNode", // style-hard-cut: allowed-negative
] as const;

const NODES_SOURCE = readFileSync(new URL("./nodes.ts", import.meta.url), "utf8");
const SLOT_MARKER_SOURCE = readFileSync(new URL("./slot-marker.ts", import.meta.url), "utf8");
const ISSUES_SOURCE = readFileSync(new URL("./issues.ts", import.meta.url), "utf8");
const NODES_AST = ts.createSourceFile(
  "nodes.ts",
  NODES_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function interfaceOwnMembers(name: string): readonly string[] {
  const declaration = NODES_AST.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (declaration === undefined) throw new Error(`interface ${name} not found in nodes.ts`);
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) =>
      ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : "",
    )
    .filter((memberName) => memberName.length > 0);
}

function exportedDeclarationNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of NODES_AST.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

describe("unified public node model", () => {
  it("locks the final 11-brick roster", () => {
    expect(BRICK_TYPES).toEqual(FINAL_BRICK_TYPES);
    expect(new Set(BRICK_TYPES).size).toBe(11);
    expectTypeOf<BrickType>().toEqualTypeOf<(typeof FINAL_BRICK_TYPES)[number]>();
    expectTypeOf<FacetNode["type"]>().toEqualTypeOf<BrickType>();
  });

  it("keeps retired tier and node names out of the public node module", () => {
    const exports = exportedDeclarationNames();
    for (const retired of RETIRED_PUBLIC_NAMES) expect(exports.has(retired), retired).toBe(false);
    expect(NODES_SOURCE).not.toContain('"./component-nodes.js"');
  });

  it("keeps ContainerNode and isContainer box-only", () => {
    expectTypeOf<ContainerNode>().toEqualTypeOf<BoxNode>();

    const box: FacetNode = { id: "box", type: "box", children: [] };
    const text: FacetNode = { id: "text", type: "text", value: "hello" };
    const table: FacetNode = { id: "table", type: "table", columns: [], rows: [] };
    expect(isContainer(box)).toBe(true);
    expect(isContainer(text)).toBe(false);
    expect(isContainer(table)).toBe(false);
  });

  it("gives every data and feedback brick an optional closed style", () => {
    expectTypeOf<keyof TableNode>().toEqualTypeOf<
      "id" | "type" | "columns" | "rows" | "caption" | "emptyLabel" | "from" | "style"
    >();
    expectTypeOf<keyof ChartNode>().toEqualTypeOf<
      "id" | "type" | "kind" | "series" | "labels" | "title" | "from" | "style"
    >();
    expectTypeOf<keyof ListNode>().toEqualTypeOf<"id" | "type" | "items" | "from" | "style">();
    expectTypeOf<keyof KeyValueNode>().toEqualTypeOf<"id" | "type" | "items" | "from" | "style">();
    expectTypeOf<keyof ProgressNode>().toEqualTypeOf<"id" | "type" | "value" | "label" | "style">();
    expectTypeOf<keyof LoadingNode>().toEqualTypeOf<"id" | "type" | "label" | "style">();
    expectTypeOf<ChartKind>().toEqualTypeOf<"bar" | "line" | "donut">();

    const column: TableColumn = { key: "amount", label: "Amount", sortable: true };
    const row: TableRow = { amount: 12 };
    const series: ChartSeries = { label: "Revenue", values: [12] };
    const keyValue: KeyValueItem = { key: "amount", label: "Amount", value: "12" };
    const item: ListItem = { title: "Revenue", body: "12" };
    expect({ column, row, series, keyValue, item }).toEqual({
      column,
      row,
      series,
      keyValue,
      item,
    });
  });

  it("gives media chart and table product-grade closed fields", () => {
    expect(BRICK_TYPES).toEqual(FINAL_BRICK_TYPES);
    expect(MEDIA_KINDS).toEqual(["image", "video", "icon"]);
    expect(MEDIA_ICON_NAMES).toEqual([
      "activity",
      "alert",
      "arrowRight",
      "bell",
      "calendar",
      "cart",
      "check",
      "chevronDown",
      "chevronRight",
      "clock",
      "database",
      "download",
      "externalLink",
      "file",
      "filter",
      "grid",
      "heart",
      "help",
      "home",
      "info",
      "link",
      "mail",
      "menu",
      "minus",
      "moreHorizontal",
      "play",
      "plus",
      "search",
      "settings",
      "sort",
      "star",
      "table",
      "user",
      "users",
      "x",
    ]);
    expectTypeOf<MediaIconName>().toEqualTypeOf<(typeof MEDIA_ICON_NAMES)[number]>();
    expectTypeOf<MediaNode["kind"]>().toEqualTypeOf<"image" | "video" | "icon">();
    expectTypeOf<keyof MediaNode>().toEqualTypeOf<
      "id" | "type" | "kind" | "src" | "icon" | "alt" | "poster" | "controls" | "style"
    >();
    expectTypeOf<TableColumn["align"]>().toEqualTypeOf<TextAlign | undefined>();
    expectTypeOf<ChartSeries["lineStyle"]>().toEqualTypeOf<LineStyle | undefined>();
    expectTypeOf<MediaNode["src"]>().toEqualTypeOf<string | undefined>();

    const image: MediaNode = {
      id: "hero",
      type: "media",
      kind: "image",
      src: "https://example.com/hero.png",
      alt: "Hero image",
    };
    const icon: MediaNode = {
      id: "status",
      type: "media",
      kind: "icon",
      icon: "check",
      alt: "Complete",
      style: {
        width: "fit",
        iconSize: "lg",
        color: "accent",
        background: "accentSurface",
        borderColor: "accent",
        borderWidth: "thin",
        borderRadius: "full",
        padding: "sm",
      },
    };
    const column: TableColumn = { key: "amount", label: "Amount", sortable: true, align: "end" };
    const series: ChartSeries = { label: "Forecast", values: [12, 18], lineStyle: "dashed" };
    const text: TextNode = {
      id: "headline",
      type: "text",
      value: "Balanced headline",
      style: { textWrap: "balance", lineClamp: 2 },
    };
    const table: TableNode = {
      id: "table",
      type: "table",
      columns: [column],
      rows: [{ amount: 12 }],
      style: {
        caption: { textWrap: "balance" },
        header: { textWrap: "nowrap" },
        cell: { lineClamp: 1 },
      },
    };
    const chart: ChartNode = {
      id: "chart",
      type: "chart",
      kind: "line",
      series: [series],
      style: {
        plot: { axisColor: "border", gridColor: "mutedForeground", labelColor: "foreground" },
      },
    };
    const list: ListNode = {
      id: "list",
      type: "list",
      items: [{ title: "Insight", body: "Two line preview" }],
      style: { title: { lineClamp: 2 }, body: { textWrap: "wrap", lineClamp: 3 } },
    };

    expect({ image, icon, table, chart, list, text }).toMatchObject({
      icon: { kind: "icon", icon: "check" },
      table: { columns: [{ align: "end" }] },
      chart: { series: [{ lineStyle: "dashed" }] },
      list: { style: { body: { textWrap: "wrap", lineClamp: 3 } } },
      text: { style: { textWrap: "balance", lineClamp: 2 } },
    });
  });

  it("uses neutral brick validation support wording", () => {
    for (const source of [NODES_SOURCE, SLOT_MARKER_SOURCE, ISSUES_SOURCE]) {
      expect(source).not.toMatch(/\b(?:component|components|intrinsic)\b/i);
    }
  });
});

describe("analytics-data-surface node fields", () => {
  it("accepts per-column width, per-series axis, and table emptyLabel", () => {
    expectTypeOf<TableColumn["width"]>().toEqualTypeOf<ColumnWidth | undefined>();
    expectTypeOf<ChartSeries["axis"]>().toEqualTypeOf<ChartAxis | undefined>();
    expectTypeOf<TableNode["emptyLabel"]>().toEqualTypeOf<string | undefined>();

    const column: TableColumn = { key: "amount", label: "Amount", align: "end", width: "narrow" };
    const series: ChartSeries = {
      label: "Sessions",
      values: [3, 4],
      lineStyle: "dashed",
      axis: "secondary",
    };
    const table: TableNode = {
      id: "table",
      type: "table",
      columns: [column],
      rows: [],
      emptyLabel: "No results yet",
    };
    const chart: ChartNode = { id: "chart", type: "chart", kind: "line", series: [series] };
    expect({ table, chart }).toMatchObject({
      table: { emptyLabel: "No results yet", columns: [{ width: "narrow" }] },
      chart: { series: [{ axis: "secondary" }] },
    });
  });
});

describe("native Brick regression guards", () => {
  it("keeps shared look and box concerns inherited from private packs", () => {
    const boxOwn = interfaceOwnMembers("BoxNode");
    const textOwn = interfaceOwnMembers("TextNode");
    for (const field of ["style", "activeWhen"] as const) {
      expect(boxOwn).not.toContain(field);
      expect(textOwn).not.toContain(field);
    }
    for (const field of ["onPress", "onHold", "backdrop"] as const) {
      expect(boxOwn).not.toContain(field);
    }
    expect(boxOwn).toContain("type");
    expect(boxOwn).toContain("hidden");
  });

  it("keeps native Brick discriminants and public field sets", () => {
    expectTypeOf<BoxNode["type"]>().toEqualTypeOf<"box">();
    expectTypeOf<TextNode["type"]>().toEqualTypeOf<"text">();
    expectTypeOf<MediaNode["type"]>().toEqualTypeOf<"media">();
    expectTypeOf<InputNode["type"]>().toEqualTypeOf<"input">();
    expectTypeOf<Extract<FacetNode, { type: "box" }>>().toEqualTypeOf<BoxNode>();
    expectTypeOf<Extract<FacetNode, { type: "text" }>>().toEqualTypeOf<TextNode>();
    expectTypeOf<Extract<FacetNode, { type: "media" }>>().toEqualTypeOf<MediaNode>();
    expectTypeOf<Extract<FacetNode, { type: "input" }>>().toEqualTypeOf<InputNode>();

    expectTypeOf<keyof BoxNode>().toEqualTypeOf<
      | "id"
      | "type"
      | "style"
      | "onPress"
      | "onHold"
      | "hidden"
      | "backdrop"
      | "overlay"
      | "activeWhen"
      | "children"
    >();
    expectTypeOf<keyof TextNode>().toEqualTypeOf<
      "id" | "type" | "value" | "style" | "from" | "column" | "row" | "activeWhen"
    >();
    expectTypeOf<keyof MediaNode>().toEqualTypeOf<
      "id" | "type" | "kind" | "src" | "icon" | "alt" | "poster" | "controls" | "style"
    >();
    expectTypeOf<keyof InputNode>().toEqualTypeOf<
      "id" | "type" | "name" | "input" | "options" | "label" | "placeholder" | "style"
    >();
  });
});
