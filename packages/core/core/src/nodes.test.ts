import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  isContainer,
  PRIMITIVE_BRICK_TYPES,
  type BoxNode,
  type ContainerNode,
  type FacetNode,
  type FormNode,
  type InputNode,
  type MediaNode,
  type TextNode,
} from "./nodes.js";
import { BRICK_REGISTRY, CORE_NODE_TYPES } from "./brick-registry.js";
import { COMPONENT_NODE_TYPES, INTRINSIC_COMPONENT_TYPES } from "./component-nodes.js";

const SURVIVING_INTRINSIC_COMPONENT_TYPES = [
  "button",
  "tabs",
  "nav",
  "table",
  "chart",
  "metric",
  "keyValue",
  "progress",
  "list",
  "form",
  "filterBar",
  "loading",
] as const;

const SURVIVING_COMPONENT_NODE_TYPES = [...SURVIVING_INTRINSIC_COMPONENT_TYPES, "stat"] as const;

const SURVIVING_PUBLIC_NODE_TYPES = [
  ...PRIMITIVE_BRICK_TYPES,
  ...SURVIVING_COMPONENT_NODE_TYPES,
] as const;

/**
 * Preservation test for the `node-mixins` PURE REFACTOR.
 *
 * WU-1 authors this as the RED artifact; WU-2 recomposes the four flat
 * primitive interfaces from module-private packs (Styleable/ActiveLook/
 * BaseNode/ContainerFields/DataBound) and flips the dedup assertion GREEN.
 *
 * Three guarantees are pinned here:
 *   1. Dedup (source-AST single-source) — RED now: the active-look fields and
 *      `style` must NOT be repeated as direct members of BOTH BoxNode and
 *      TextNode (they belong in one shared pack). FAILS against the current
 *      flat interfaces, PASSES once WU-2 moves them behind `extends`.
 *   2. Discriminant + exhaustiveness — GREEN now: each primitive keeps its
 *      literal `type` and `Extract<FacetNode,{type:K}>` still narrows.
 *   3. Field-set preservation — GREEN now: each primitive's public key set is
 *      byte-identical (catches a silently added/removed field).
 *
 * The `expectTypeOf` guards are enforced by `pnpm typecheck` (vitest's runtime
 * expectTypeOf is a no-op, matching the precedent in index.test.ts). The dedup
 * assertion is a genuine runtime check and is the one that must FAIL now.
 */

// --- Source-AST helpers (mirror of index.test.ts) --------------------------

const NODES_SOURCE = readFileSync(new URL("./nodes.ts", import.meta.url), "utf8");
const NODES_AST = ts.createSourceFile(
  "nodes.ts",
  NODES_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

/** The names of the property signatures declared DIRECTLY in an interface body
 * (heritage/`extends` members are excluded — that is exactly the point). */
function interfaceOwnMembers(name: string): readonly string[] {
  const decl = NODES_AST.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (decl === undefined) {
    throw new Error(`interface ${name} not found in nodes.ts`);
  }
  return decl.members
    .filter(ts.isPropertySignature)
    .map((member) =>
      ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : "",
    )
    .filter((memberName) => memberName.length > 0);
}

// The active-look trio (PR-1 duplication) plus the `style` slot: the fields the
// refactor folds into a single shared Styleable/ActiveLook pack.
const SHARED_LOOK_FIELDS = ["style", "activeVariant", "activeStyle", "active"] as const;

// --- 1. Dedup (source-AST single-source) — THE RED ARTIFACT ----------------

describe("node interface packs — active-look/style single-source (dedup)", () => {
  it("declares the active-look + style fields in ONE shared pack, not repeated in both BoxNode and TextNode bodies", () => {
    const boxOwn = interfaceOwnMembers("BoxNode");
    const textOwn = interfaceOwnMembers("TextNode");

    // Single-source: each shared-look field must be inherited from a shared
    // Styleable/ActiveLook pack via `extends`, NOT declared directly inside
    // either primitive body. Against the current flat interfaces (which repeat
    // `style`/`activeVariant`/`activeStyle`/`active` in BOTH BoxNode AND
    // TextNode) this FAILS — the valid RED. WU-2 flips it GREEN.
    for (const field of SHARED_LOOK_FIELDS) {
      expect(
        boxOwn,
        `"${field}" is declared directly inside interface BoxNode; it must be single-sourced in a shared Styleable/ActiveLook pack (extends), not repeated on the primitive`,
      ).not.toContain(field);
      expect(
        textOwn,
        `"${field}" is declared directly inside interface TextNode; it must be single-sourced in a shared Styleable/ActiveLook pack (extends), not repeated on the primitive`,
      ).not.toContain(field);
    }
  });
});

// --- 1b. Box concern packs (source-AST single-source) — RED ARTIFACT --------

/** True iff an interface with `name` is declared in nodes.ts. */
function interfaceExists(name: string): boolean {
  return NODES_AST.statements.some(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
}

/** True iff the interface `name` is declared with an `export` modifier. */
function interfaceIsExported(name: string): boolean {
  const decl = NODES_AST.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  return (
    decl?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
  );
}

describe("box concern packs — Pressable/Layered single-source (dedup)", () => {
  it("moves onPress/onHold/backdrop out of BoxNode's direct body into extends packs", () => {
    const boxOwn = interfaceOwnMembers("BoxNode");
    // These three now come via the Pressable/Layered packs (single-sourced), so
    // they must NOT be declared directly inside the BoxNode body. Against the
    // current flat BoxNode (which declares all three directly) this FAILS — the
    // valid RED. WU-1's GREEN change flips it.
    for (const field of ["onPress", "onHold", "backdrop"] as const) {
      expect(
        boxOwn,
        `"${field}" is declared directly inside interface BoxNode; it must be single-sourced in the Pressable/Layered concern pack (extends), not repeated on the primitive`,
      ).not.toContain(field);
    }
  });

  it("declares Pressable and Layered as module-private (not exported) concern packs", () => {
    for (const pack of ["Pressable", "Layered"] as const) {
      expect(interfaceExists(pack), `interface ${pack} must be declared in nodes.ts`).toBe(true);
      expect(
        interfaceIsExported(pack),
        `interface ${pack} must be module-private (declared without \`export\`)`,
      ).toBe(false);
    }
  });

  it("keeps `type` and `hidden` as direct own members of BoxNode", () => {
    const boxOwn = interfaceOwnMembers("BoxNode");
    expect(boxOwn, "`type` must stay a direct literal member of BoxNode").toContain("type");
    expect(boxOwn, "`hidden` must stay a direct member of BoxNode (not a pack)").toContain(
      "hidden",
    );
  });
});

// --- 2. Discriminant + exhaustiveness (type-level, GREEN now) ---------------

describe("node discriminated-union preservation (exhaustiveness guard)", () => {
  it("keeps each primitive's literal `type` discriminant as a direct member", () => {
    expectTypeOf<BoxNode["type"]>().toEqualTypeOf<"box">();
    expectTypeOf<TextNode["type"]>().toEqualTypeOf<"text">();
    expectTypeOf<MediaNode["type"]>().toEqualTypeOf<"media">();
    expectTypeOf<InputNode["type"]>().toEqualTypeOf<"input">();
  });

  it("resolves Extract<FacetNode,{type:K}> back to each concrete primitive interface", () => {
    expectTypeOf<Extract<FacetNode, { type: "box" }>>().toEqualTypeOf<BoxNode>();
    expectTypeOf<Extract<FacetNode, { type: "text" }>>().toEqualTypeOf<TextNode>();
    expectTypeOf<Extract<FacetNode, { type: "media" }>>().toEqualTypeOf<MediaNode>();
    expectTypeOf<Extract<FacetNode, { type: "input" }>>().toEqualTypeOf<InputNode>();
  });

  it("keeps the FacetNode union's `type` members exactly the expected literal set", () => {
    // The four primitives are exactly box/text/media/input.
    expectTypeOf<(BoxNode | TextNode | MediaNode | InputNode)["type"]>().toEqualTypeOf<
      "box" | "text" | "media" | "input"
    >();

    // The full FacetNode discriminant set (primitives + intrinsic/legacy
    // components) — a broken discriminated union would drift this set.
    expectTypeOf<FacetNode["type"]>().toEqualTypeOf<(typeof SURVIVING_PUBLIC_NODE_TYPES)[number]>();
  });
});

describe("container composition reference cutover", () => {
  it("retired container patterns are not node types", () => {
    expect(INTRINSIC_COMPONENT_TYPES).toEqual(SURVIVING_INTRINSIC_COMPONENT_TYPES);
    expect(COMPONENT_NODE_TYPES).toEqual(SURVIVING_COMPONENT_NODE_TYPES);
    expect(CORE_NODE_TYPES).toEqual(SURVIVING_PUBLIC_NODE_TYPES);
    expect(Object.keys(BRICK_REGISTRY).sort()).toEqual([...SURVIVING_PUBLIC_NODE_TYPES].sort());

    expectTypeOf<FacetNode["type"]>().toEqualTypeOf<(typeof SURVIVING_PUBLIC_NODE_TYPES)[number]>();
    expectTypeOf<Extract<FacetNode, { type: "stat" }>["type"]>().toEqualTypeOf<"stat">();
    expectTypeOf<ContainerNode>().toEqualTypeOf<BoxNode | FormNode>();

    const box: FacetNode = { id: "box", type: "box", children: [] };
    const form: FacetNode = { id: "form", type: "form", children: [] };
    const stat: FacetNode = { id: "stat", type: "stat", label: "Total", value: "1" };
    expect(isContainer(box)).toBe(true);
    expect(isContainer(form)).toBe(true);
    expect(isContainer(stat)).toBe(false);
  });
});

// --- 3b. Demoted display leaves removed (runtime guard) ---------------------

describe("demoted display leaves are not node types", () => {
  it("excludes badge/alert/divider from INTRINSIC_COMPONENT_TYPES and COMPONENT_NODE_TYPES", () => {
    for (const demoted of ["badge", "alert", "divider"]) {
      expect(INTRINSIC_COMPONENT_TYPES as readonly string[]).not.toContain(demoted);
      expect(COMPONENT_NODE_TYPES as readonly string[]).not.toContain(demoted);
    }
  });
});

// --- 3. Field-set preservation (type-level, GREEN now) ----------------------

describe("node field-set preservation (regression guard)", () => {
  it("keeps each primitive's public field set byte-identical to today", () => {
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
