import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BRICK_TYPES,
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
  type MediaNode,
  type ProgressNode,
  type TableColumn,
  type TableNode,
  type TableRow,
  type TextNode,
  type Tone,
} from "./nodes.js";

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
  "PRIMITIVE_BRICK_TYPES", // composition-hard-cut: allowed-negative
  "PrimitiveBrickType", // composition-hard-cut: allowed-negative
  "PrimitiveBrickNode", // composition-hard-cut: allowed-negative
  "INTRINSIC_COMPONENT_TYPES", // composition-hard-cut: allowed-negative
  "IntrinsicComponentType", // composition-hard-cut: allowed-negative
  "LEGACY_COMPONENT_TYPES", // composition-hard-cut: allowed-negative
  "LegacyComponentType", // composition-hard-cut: allowed-negative
  "COMPONENT_NODE_TYPES", // composition-hard-cut: allowed-negative
  "ComponentNodeType", // composition-hard-cut: allowed-negative
  "IntrinsicComponentNode", // composition-hard-cut: allowed-negative
  "LegacyComponentNode", // composition-hard-cut: allowed-negative
  "ComponentNode", // composition-hard-cut: allowed-negative
  "ButtonNode", // composition-hard-cut: allowed-negative
  "TabItem",
  "TabsNode", // composition-hard-cut: allowed-negative
  "NavItem",
  "NavNode", // composition-hard-cut: allowed-negative
  "MetricNode", // composition-hard-cut: allowed-negative
  "StatNode", // composition-hard-cut: allowed-negative
  "FormNode", // composition-hard-cut: allowed-negative
  "FilterBarFilter",
  "FilterBarNode", // composition-hard-cut: allowed-negative
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

  it("preserves the six survivor interfaces and supporting public types", () => {
    expectTypeOf<keyof TableNode>().toEqualTypeOf<
      "id" | "type" | "columns" | "rows" | "caption" | "variant" | "from"
    >();
    expectTypeOf<keyof ChartNode>().toEqualTypeOf<
      "id" | "type" | "kind" | "series" | "labels" | "title" | "variant" | "from"
    >();
    expectTypeOf<keyof ListNode>().toEqualTypeOf<"id" | "type" | "items" | "variant" | "from">();
    expectTypeOf<keyof KeyValueNode>().toEqualTypeOf<
      "id" | "type" | "items" | "variant" | "from"
    >();
    expectTypeOf<keyof ProgressNode>().toEqualTypeOf<
      "id" | "type" | "value" | "label" | "tone" | "variant"
    >();
    expectTypeOf<keyof LoadingNode>().toEqualTypeOf<"id" | "type" | "label" | "variant">();
    expectTypeOf<ChartKind>().toEqualTypeOf<"bar" | "line" | "donut">();
    expectTypeOf<Tone>().toEqualTypeOf<
      "neutral" | "accent" | "info" | "success" | "warning" | "danger"
    >();

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

  it("uses neutral brick validation support wording", () => {
    for (const source of [NODES_SOURCE, SLOT_MARKER_SOURCE, ISSUES_SOURCE]) {
      expect(source).not.toMatch(/\b(?:component|components|intrinsic)\b/i);
    }
  });
});

describe("primitive node regression guards", () => {
  it("keeps shared look and box concerns inherited from private packs", () => {
    const boxOwn = interfaceOwnMembers("BoxNode");
    const textOwn = interfaceOwnMembers("TextNode");
    for (const field of ["style", "activeVariant", "activeStyle", "active"] as const) {
      expect(boxOwn).not.toContain(field);
      expect(textOwn).not.toContain(field);
    }
    for (const field of ["onPress", "onHold", "backdrop"] as const) {
      expect(boxOwn).not.toContain(field);
    }
    expect(boxOwn).toContain("type");
    expect(boxOwn).toContain("hidden");
  });

  it("keeps primitive discriminants and public field sets", () => {
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
      | "variant"
      | "style"
      | "onPress"
      | "onHold"
      | "hidden"
      | "backdrop"
      | "overlay"
      | "activeVariant"
      | "activeStyle"
      | "active"
      | "children"
    >();
    expectTypeOf<keyof TextNode>().toEqualTypeOf<
      | "id"
      | "type"
      | "value"
      | "variant"
      | "style"
      | "from"
      | "column"
      | "row"
      | "activeVariant"
      | "activeStyle"
      | "active"
    >();
    expectTypeOf<keyof MediaNode>().toEqualTypeOf<
      "id" | "type" | "kind" | "src" | "variant" | "alt" | "poster" | "controls" | "style"
    >();
    expectTypeOf<keyof InputNode>().toEqualTypeOf<
      "id" | "type" | "name" | "variant" | "input" | "options" | "label" | "placeholder" | "style"
    >();
  });
});
