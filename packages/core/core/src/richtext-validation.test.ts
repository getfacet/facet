import { describe, expect, it } from "vitest";

import {
  isSafeHref,
  validateRichText,
  MAX_RICHTEXT_BLOCKS,
  MAX_RUNS_PER_BLOCK,
  MAX_MARKS_PER_RUN,
  MAX_LIST_DEPTH,
} from "./primitive-node-validation.js";
import { MAX_NODE_BODY_CHARS } from "./component-validation-shared.js";
import { BRICK_REGISTRY } from "./brick-registry.js";
import type { Mark, RichTextBlock, RichTextNode } from "./nodes.js";

// Sanitize a raw richtext value into { node, issues }. `validateRichText` never
// throws and never returns undefined — a structurally-empty input degrades to a
// richtext with `blocks: []` (renders nothing).
function sanitize(raw: Record<string, unknown>): {
  node: RichTextNode;
  issues: string[];
} {
  const issues: string[] = [];
  const node = validateRichText("rt", raw, issues) as RichTextNode | undefined;
  if (node === undefined) throw new Error("validateRichText returned undefined");
  return { node, issues };
}

const run = (text: string, marks?: readonly Mark[]): Record<string, unknown> =>
  marks === undefined ? { text } : { text, marks };
const para = (...runs: Record<string, unknown>[]): Record<string, unknown> => ({
  type: "paragraph",
  runs,
});

describe("isSafeHref (DC-004 — stricter than isSafeMediaSrc)", () => {
  it("accepts http(s), protocol-relative //, and local /path", () => {
    expect(isSafeHref("https://example.com/a")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("//cdn.example.com/x.png")).toBe(true);
    expect(isSafeHref("/docs/intro")).toBe(true);
    // case/whitespace insensitive
    expect(isSafeHref("HTTPS://Example.com")).toBe(true);
    expect(isSafeHref("  https://example.com  ")).toBe(true);
  });

  it("REJECTS every data: URL — including data:image/svg+xml (unlike media src)", () => {
    expect(isSafeHref("data:image/svg+xml,<svg onload=alert(1)>")).toBe(false);
    expect(isSafeHref("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHref("DATA:image/svg+xml,x")).toBe(false);
  });

  it("REJECTS javascript: and every other non-allowlisted scheme", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("ftp://example.com")).toBe(false);
    expect(isSafeHref("mailto:a@b.com")).toBe(false);
    expect(isSafeHref("tel:+1")).toBe(false);
    expect(isSafeHref("vbscript:msgbox")).toBe(false);
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("relative/path")).toBe(false);
  });
});

describe("validateRichText fail-safe (DC-002)", () => {
  it("drops an unknown mark but keeps the run text", () => {
    const { node } = sanitize({
      blocks: [para(run("hello", [{ kind: "bold" }, { kind: "blink" } as unknown as Mark]))],
    });
    const marks = node.blocks[0]?.runs[0]?.marks;
    expect(node.blocks[0]?.runs[0]?.text).toBe("hello");
    expect(marks).toEqual([{ kind: "bold" }]);
  });

  it("degrades an unknown block type to paragraph (keeps the text)", () => {
    const { node } = sanitize({
      blocks: [{ type: "banner", runs: [run("kept")] }],
    });
    expect(node.blocks[0]?.type).toBe("paragraph");
    expect(node.blocks[0]?.runs[0]?.text).toBe("kept");
  });

  it("skips a run with missing / non-string text", () => {
    const { node } = sanitize({
      blocks: [
        {
          type: "paragraph",
          runs: [{ marks: [{ kind: "bold" }] }, { text: 42 }, run("only")],
        },
      ],
    });
    expect(node.blocks[0]?.runs).toHaveLength(1);
    expect(node.blocks[0]?.runs[0]?.text).toBe("only");
  });

  it("drops a block whose every run is invalid", () => {
    const { node } = sanitize({
      blocks: [{ type: "paragraph", runs: [{ marks: [] }, { text: 1 }] }, para(run("survivor"))],
    });
    expect(node.blocks).toHaveLength(1);
    expect(node.blocks[0]?.runs[0]?.text).toBe("survivor");
  });

  it("degrades to an empty richtext when no run is valid (never throws / never undefined)", () => {
    expect(sanitize({ blocks: [] }).node.blocks).toEqual([]);
    expect(sanitize({ blocks: "not-an-array" }).node.blocks).toEqual([]);
    expect(sanitize({}).node.blocks).toEqual([]);
    expect(
      sanitize({ blocks: [null, 5, "x", { type: "paragraph", runs: [] }] }).node.blocks,
    ).toEqual([]);
    expect(sanitize({}).node.type).toBe("richtext");
  });
});

describe("validateRichText closed vocabulary (DC-003 / DC-006)", () => {
  it("accepts every closed mark kind and drops unknown / future kinds", () => {
    const { node } = sanitize({
      blocks: [
        para(
          run("a", [
            { kind: "bold" },
            { kind: "italic" },
            { kind: "underline" },
            { kind: "strike" },
            { kind: "code" },
            { kind: "superscript" } as unknown as Mark,
          ]),
        ),
      ],
    });
    expect(node.blocks[0]?.runs[0]?.marks).toEqual([
      { kind: "bold" },
      { kind: "italic" },
      { kind: "underline" },
      { kind: "strike" },
      { kind: "code" },
    ]);
  });

  it("accepts only the closed block types (paragraph/heading/listItem/quote)", () => {
    for (const type of ["paragraph", "heading", "listItem", "quote"]) {
      const { node } = sanitize({ blocks: [{ type, runs: [run("x")] }] });
      expect(node.blocks[0]?.type).toBe(type);
    }
  });

  it("routes an INTERNAL link target through normalizeFacetAction (no parallel validator)", () => {
    const { node } = sanitize({
      blocks: [para(run("home", [{ kind: "link", target: { kind: "navigate", to: "home" } }]))],
    });
    expect(node.blocks[0]?.runs[0]?.marks).toEqual([
      { kind: "link", target: { kind: "navigate", to: "home" } },
    ]);
  });

  it("normalizes a legacy internal agent link target the same way box onPress does", () => {
    const { node } = sanitize({
      blocks: [para(run("go", [{ kind: "link", target: { name: "cta" } }]))],
    });
    expect(node.blocks[0]?.runs[0]?.marks).toEqual([
      { kind: "link", target: { kind: "agent", name: "cta" } },
    ]);
  });

  it("drops an internal link mark whose action is malformed (keeps the run text)", () => {
    const { node } = sanitize({
      // navigate action missing "to" → normalizeFacetAction returns undefined
      blocks: [
        para(run("bad", [{ kind: "link", target: { kind: "navigate" } } as unknown as Mark])),
      ],
    });
    expect(node.blocks[0]?.runs[0]?.text).toBe("bad");
    expect(node.blocks[0]?.runs[0]?.marks).toBeUndefined();
  });
});

describe("validateRichText external link safety (DC-004)", () => {
  it("keeps a safe external href", () => {
    const { node } = sanitize({
      blocks: [para(run("site", [{ kind: "link", target: { href: "https://example.com" } }]))],
    });
    expect(node.blocks[0]?.runs[0]?.marks).toEqual([
      { kind: "link", target: { href: "https://example.com" } },
    ]);
  });

  it("DROPS an unsafe external href (javascript: / data: / svg) but keeps the run text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "data:image/svg+xml,<svg>"]) {
      const { node } = sanitize({
        blocks: [para(run("txt", [{ kind: "link", target: { href } }]))],
      });
      expect(node.blocks[0]?.runs[0]?.text).toBe("txt");
      expect(node.blocks[0]?.runs[0]?.marks).toBeUndefined();
    }
  });
});

describe("validateRichText level/depth clamp (DC-007)", () => {
  it("clamps heading level to 1..3", () => {
    const level = (input: unknown): number | undefined =>
      sanitize({ blocks: [{ type: "heading", level: input, runs: [run("h")] }] }).node.blocks[0]
        ?.level;
    expect(level(5)).toBe(3);
    expect(level(0)).toBe(1);
    expect(level(2)).toBe(2);
    expect(level("3")).toBe(3);
    expect(level(undefined)).toBe(1);
  });

  it("clamps list depth to 0..MAX_LIST_DEPTH", () => {
    const depth = (input: unknown): number | undefined =>
      sanitize({ blocks: [{ type: "listItem", depth: input, runs: [run("li")] }] }).node.blocks[0]
        ?.depth;
    expect(depth(99)).toBe(MAX_LIST_DEPTH);
    expect(depth(-3)).toBe(0);
    expect(depth(2)).toBe(2);
    expect(depth(undefined)).toBe(0);
  });
});

describe("validateRichText bounds (never throws)", () => {
  it("caps blocks, runs, marks and text length", () => {
    const many = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);
    const { node } = sanitize({
      blocks: many(MAX_RICHTEXT_BLOCKS + 40, () => ({
        type: "paragraph",
        runs: many(MAX_RUNS_PER_BLOCK + 40, () => ({
          text: "a".repeat(MAX_NODE_BODY_CHARS + 25),
          marks: many(MAX_MARKS_PER_RUN + 20, () => ({ kind: "bold" })),
        })),
      })),
    });
    expect(node.blocks.length).toBe(MAX_RICHTEXT_BLOCKS);
    const firstBlock = node.blocks[0] as RichTextBlock;
    expect(firstBlock.runs.length).toBe(MAX_RUNS_PER_BLOCK);
    expect(firstBlock.runs[0]?.marks?.length).toBe(MAX_MARKS_PER_RUN);
    expect(firstBlock.runs[0]?.text.length).toBe(MAX_NODE_BODY_CHARS);
  });
});

describe("richtext is a leaf brick / not from-bound (DC-005)", () => {
  it("has a primitive registry entry with a validator and NO resolve/resolveFromContent", () => {
    const entry = BRICK_REGISTRY.richtext;
    expect(entry.kind).toBe("primitive");
    expect(entry.established).toBe(false);
    expect(typeof entry.validate).toBe("function");
    expect(entry.resolve).toBeUndefined();
    expect(entry.resolveFromContent).toBeUndefined();
    expect(entry.role).toBeUndefined();
  });

  it("ignores from-binding / children fields (holds its own blocks)", () => {
    const { node } = sanitize({
      from: "sales",
      column: "note",
      children: ["a", "b"],
      blocks: [para(run("own"))],
    });
    expect(node.blocks[0]?.runs[0]?.text).toBe("own");
    expect((node as unknown as Record<string, unknown>).from).toBeUndefined();
    expect((node as unknown as Record<string, unknown>).children).toBeUndefined();
  });
});
