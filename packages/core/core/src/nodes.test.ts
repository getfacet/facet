import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { BoxNode, FacetNode, FieldNode, MediaNode, TextNode } from "./nodes.js";

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

// --- 2. Discriminant + exhaustiveness (type-level, GREEN now) ---------------

describe("node discriminated-union preservation (exhaustiveness guard)", () => {
  it("keeps each primitive's literal `type` discriminant as a direct member", () => {
    expectTypeOf<BoxNode["type"]>().toEqualTypeOf<"box">();
    expectTypeOf<TextNode["type"]>().toEqualTypeOf<"text">();
    expectTypeOf<MediaNode["type"]>().toEqualTypeOf<"media">();
    expectTypeOf<FieldNode["type"]>().toEqualTypeOf<"field">();
  });

  it("resolves Extract<FacetNode,{type:K}> back to each concrete primitive interface", () => {
    expectTypeOf<Extract<FacetNode, { type: "box" }>>().toEqualTypeOf<BoxNode>();
    expectTypeOf<Extract<FacetNode, { type: "text" }>>().toEqualTypeOf<TextNode>();
    expectTypeOf<Extract<FacetNode, { type: "media" }>>().toEqualTypeOf<MediaNode>();
    expectTypeOf<Extract<FacetNode, { type: "field" }>>().toEqualTypeOf<FieldNode>();
  });

  it("keeps the FacetNode union's `type` members exactly the expected literal set", () => {
    // The four primitives are exactly box/text/media/field.
    expectTypeOf<(BoxNode | TextNode | MediaNode | FieldNode)["type"]>().toEqualTypeOf<
      "box" | "text" | "media" | "field"
    >();

    // The full FacetNode discriminant set (primitives + intrinsic/legacy
    // components) — a broken discriminated union would drift this set.
    expectTypeOf<FacetNode["type"]>().toEqualTypeOf<
      | "box"
      | "text"
      | "media"
      | "field"
      | "richtext"
      | "button"
      | "section"
      | "card"
      | "tabs"
      | "nav"
      | "table"
      | "chart"
      | "metric"
      | "keyValue"
      | "badge"
      | "progress"
      | "alert"
      | "list"
      | "divider"
      | "form"
      | "search"
      | "filterBar"
      | "emptyState"
      | "loading"
      | "stat"
    >();
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

    expectTypeOf<keyof FieldNode>().toEqualTypeOf<
      "id" | "type" | "name" | "variant" | "input" | "options" | "label" | "placeholder" | "style"
    >();
  });
});
