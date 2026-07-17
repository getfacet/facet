// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId, RichTextNode } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { renderRichText, type RichTextRenderContext } from "./render-richtext.js";
import { resolveTheme } from "./theme.js";
import type { ClassifiedPress } from "./renderer-press.js";

afterEach(cleanup);

/** A render context for the bespoke helper (mirrors what renderer-render threads). */
function ctx(over: Partial<RichTextRenderContext> = {}): RichTextRenderContext {
  return {
    theme: resolveTheme(undefined),
    inert: false,
    nodeId: "rt" as NodeId,
    dispatch: vi.fn(),
    ...over,
  };
}

function richtext(blocks: unknown): RichTextNode {
  return { id: "rt", type: "richtext", blocks } as unknown as RichTextNode;
}

/** A one-node tree wrapping a richtext leaf under a root box (for the StageRenderer path). */
function tree(node: FacetNode): FacetTree {
  return {
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["rt"] } as FacetNode,
      rt: node,
    },
  };
}

describe("renderRichText (DC-001 happy render)", () => {
  it("styles bounded semantic targets without a per-block or per-run selector", () => {
    const theme = resolveTheme();
    const normalizedColor = (value: string): string => {
      const sample = document.createElement("span");
      sample.style.color = value;
      return sample.style.color;
    };
    const node = {
      id: "rt",
      type: "richtext",
      style: {
        fontSize: "lg",
        blockGap: "xl",
        heading1: { fontSize: "4xl", color: "info" },
        quote: {
          color: "warning",
          background: "warningSurface",
          padding: "lg",
          borderColor: "warning",
          borderWidth: "thick",
        },
        code: {
          fontFamily: "mono",
          color: "success",
          background: "successSurface",
          padding: "xs",
          borderRadius: "lg",
        },
        link: {
          color: "accent",
          hover: { color: "info", highlight: "accent" },
          pressed: { color: "warning" },
          focus: { color: "danger", highlight: "warning" },
        },
        listMarker: { color: "danger", fontSize: "xl", fontWeight: "bold" },
        // Raw-path junk is not a published target and cannot select content.
        block: { 0: { color: "danger" } },
        run: { 0: { color: "danger" } },
      },
      blocks: [
        { type: "heading", level: 1, runs: [{ text: "Heading" }] },
        { type: "quote", runs: [{ text: "Quote" }] },
        { type: "paragraph", runs: [{ text: "Code", marks: [{ kind: "code" }] }] },
        {
          type: "paragraph",
          runs: [
            { text: "Link", marks: [{ kind: "link", target: { href: "https://example.com" } }] },
          ],
        },
        { type: "listItem", runs: [{ text: "Item" }] },
      ],
    } as unknown as RichTextNode;
    const { container } = render(<>{renderRichText(node, ctx())}</>);

    const root = container.firstElementChild as HTMLElement;
    const heading = container.querySelector("h1") as HTMLElement;
    const quote = container.querySelector("blockquote") as HTMLElement;
    const code = Array.from(container.querySelectorAll("span")).find(
      (span) => span.textContent === "Code",
    ) as HTMLElement;
    const link = container.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
    const marker = container.querySelector('[data-facet-list-item] > span[aria-hidden="true"]') as
      HTMLSpanElement | undefined;

    expect(root.style.fontSize).toBe(theme.fontSize.lg);
    expect(root.style.gap).toBe(theme.space.xl);
    expect(heading.style.fontSize).toBe(theme.fontSize["4xl"]);
    expect(heading.style.color).toBe(normalizedColor(theme.color.info));
    expect(quote.style.background).toBe(normalizedColor(theme.color.warningSurface));
    expect(quote.style.padding).toBe(theme.space.lg);
    expect(quote.style.borderInlineStartWidth).toBe(theme.borderWidth.thick);
    expect(code.style.fontFamily).toBe(theme.fontFamily.mono);
    expect(code.style.background).toBe(normalizedColor(theme.color.successSurface));
    expect(code.style.borderRadius).toBe(theme.radius.lg);
    expect(link.classList).toContain("facet-hover-color");
    expect(link.classList).toContain("facet-pressed-color");
    expect(link.classList).toContain("facet-focus-highlight");
    expect(link.style.getPropertyValue("--facet-hover-color")).toBe(theme.color.info);
    expect(link.style.getPropertyValue("--facet-focus-color")).toBe(theme.color.danger);
    expect(marker?.style.color).toBe(normalizedColor(theme.color.danger));
    expect(marker?.style.fontSize).toBe(theme.fontSize.xl);
    expect(root.innerHTML).not.toContain("block:");
    expect(root.innerHTML).not.toContain("run:");
  });

  it("flows mixed marks + an internal link as ONE wrapping block with per-run emphasis", () => {
    const node = richtext([
      {
        type: "paragraph",
        runs: [
          { text: "Hello " },
          { text: "strong", marks: [{ kind: "bold" }] },
          { text: " and " },
          { text: "italic", marks: [{ kind: "italic" }] },
          { text: " and ", marks: [] },
          { text: "go link", marks: [{ kind: "link", target: { kind: "agent", name: "go" } }] },
        ],
      },
    ]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);

    // One flowing block: a single <p> carries every run's text contiguously.
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("Hello strong and italic and go link");

    // Per-run emphasis: bold → theme weight, italic → font-style.
    const bold = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "strong",
    );
    expect(bold?.style.fontWeight).toBe("700");
    const italic = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "italic",
    );
    expect(italic?.style.fontStyle).toBe("italic");
  });

  it("dispatches an internal link through the single ctx.dispatch writer (no new writer)", () => {
    const dispatch = vi.fn<(press: ClassifiedPress) => void>();
    const node = richtext([
      {
        type: "paragraph",
        runs: [{ text: "act", marks: [{ kind: "link", target: { kind: "agent", name: "go" } }] }],
      },
    ]);
    const { container } = render(<>{renderRichText(node, ctx({ dispatch }))}</>);
    const link = Array.from(container.querySelectorAll("a")).find((el) => el.textContent === "act");
    expect(link).toBeDefined();
    // Internal link carries NO href (dispatch-only; not browser navigation).
    expect(link?.getAttribute("href")).toBeNull();
    fireEvent.click(link as Element);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      kind: "agent",
      action: { kind: "agent", name: "go" },
    });
  });

  it("routes an internal link through StageRenderer's onPress → onAction (end-to-end, one writer)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree(
          richtext([
            {
              type: "paragraph",
              runs: [
                { text: "before " },
                { text: "fire", marks: [{ kind: "link", target: { kind: "agent", name: "go" } }] },
              ],
            },
          ]),
        )}
      />,
    );
    const link = Array.from(document.querySelectorAll("a")).find((el) => el.textContent === "fire");
    fireEvent.click(link as Element);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toEqual({ kind: "agent", name: "go" });
  });
});

describe("renderRichText (DC-004 external link safety)", () => {
  it("renders a safe external link as a plain <a href rel='noopener noreferrer'>", () => {
    const node = richtext([
      {
        type: "paragraph",
        runs: [
          { text: "site", marks: [{ kind: "link", target: { href: "https://example.com" } }] },
        ],
      },
    ]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);
    const anchor = container.querySelector('a[href="https://example.com"]');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.textContent).toBe("site");
  });

  it("drops an unsafe href (javascript:/data:svg) client-side, keeping the run text", () => {
    const node = richtext([
      {
        type: "paragraph",
        runs: [
          { text: "js", marks: [{ kind: "link", target: { href: "javascript:alert(1)" } }] },
          { text: "svg", marks: [{ kind: "link", target: { href: "data:image/svg+xml,<svg/>" } }] },
        ],
      },
    ]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);
    // No anchor carries an unsafe scheme; the text is still shown (degraded to plain).
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("js");
    expect(container.textContent).toContain("svg");
    // No programmatic navigation surface.
    expect(container.innerHTML).not.toContain("javascript:");
  });
});

describe("renderRichText (RISK-INV-2 inert clone — links are inert)", () => {
  it("degrades every link to plain text on the inert path: no anchor, no href, no dispatch", () => {
    const dispatch = vi.fn<(press: ClassifiedPress) => void>();
    const node = richtext([
      {
        type: "paragraph",
        runs: [
          { text: "internal", marks: [{ kind: "link", target: { kind: "agent", name: "go" } }] },
          { text: "external", marks: [{ kind: "link", target: { href: "https://example.com" } }] },
        ],
      },
    ]);
    const { container } = render(<>{renderRichText(node, ctx({ inert: true, dispatch }))}</>);

    // The previous-screen clone must NOT attach a live click surface or a navigable
    // href — otherwise a stale clone could fire an agent action or navigate.
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[role="link"]')).toBeNull();
    // Text is still shown (degraded to plain).
    expect(container.textContent).toContain("internal");
    expect(container.textContent).toContain("external");
    // Even if some element were clicked, no dispatch writer runs on the inert clone.
    fireEvent.click(container.firstChild as Element);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("renderRichText (DC-007 list depth = flow indent, clamped)", () => {
  it("renders nested bullets as renderer-owned FLOW indent, clamping over-cap depth, no absolute/pixels", () => {
    const node = richtext([
      { type: "listItem", depth: 0, runs: [{ text: "d0" }] },
      { type: "listItem", depth: 2, runs: [{ text: "d2" }] },
      { type: "listItem", depth: 5, runs: [{ text: "d5" }] },
      { type: "listItem", depth: 99, runs: [{ text: "d99" }] },
    ]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);
    const items = Array.from(container.querySelectorAll("[data-facet-list-item]")) as HTMLElement[];
    expect(items).toHaveLength(4);
    const [d0, d2, d5, d99] = items;

    // Indent is a FLOW margin — never position:absolute (RISK-INV-3).
    for (const el of items) {
      expect(el.style.position).not.toBe("absolute");
      expect(el.style.marginInlineStart).not.toContain("absolute");
    }

    // depth 0 → no indent; deeper items carry a growing margin-inline-start.
    const px = (value: string | undefined): number => {
      const match = /([\d.]+)px/.exec(value ?? "");
      return match?.[1] === undefined ? 0 : Number(match[1]);
    };
    expect(d0?.style.marginInlineStart === "" || px(d0?.style.marginInlineStart) === 0).toBe(true);
    expect(px(d2?.style.marginInlineStart)).toBeGreaterThan(0);
    expect(px(d5?.style.marginInlineStart)).toBeGreaterThan(px(d2?.style.marginInlineStart));

    // Over-cap depth 99 CLAMPS to MAX_LIST_DEPTH (5): identical indent to d5.
    expect(d99?.style.marginInlineStart).toBe(d5?.style.marginInlineStart);
    expect(px(d99?.style.marginInlineStart)).toBe(px(d5?.style.marginInlineStart));

    // Each bullet renders a marker + its text.
    expect(container.textContent).toContain("•");
    expect(container.textContent).toContain("d0");
    expect(container.textContent).toContain("d2");
    expect(container.textContent).toContain("d99");
  });
});

describe("renderRichText (DC-002 fail-safe — never throws)", () => {
  it("degrades malformed / unknown shapes without throwing", () => {
    // Non-array blocks → empty richtext.
    expect(() => render(<>{renderRichText(richtext("nope"), ctx())}</>)).not.toThrow();

    // Mixed junk: unknown block type degrades (text kept), text-less run skipped,
    // unknown mark dropped (text kept), non-object block skipped.
    const node = richtext([
      "junk",
      { type: "weird", runs: [{ text: "kept" }] },
      { type: "paragraph", runs: [{}, { text: "ok", marks: [{ kind: "sparkle" }] }] },
      { type: "heading", level: 42, runs: [{ text: "head" }] },
      { type: "quote", runs: [{ text: "q" }] },
    ]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);
    expect(container.textContent).toContain("kept");
    expect(container.textContent).toContain("ok");
    expect(container.textContent).toContain("head");
    expect(container.textContent).toContain("q");
    // Unknown block type "weird" degraded to a paragraph (still a <p>, text kept).
    expect(Array.from(container.querySelectorAll("p")).some((p) => p.textContent === "kept")).toBe(
      true,
    );
  });

  it("clamps a junk heading level to a real h1..h3 tag", () => {
    const node = richtext([{ type: "heading", level: 99, runs: [{ text: "H" }] }]);
    const { container } = render(<>{renderRichText(node, ctx())}</>);
    // A clamped level always maps to a valid heading element (no <h99>).
    const heading = container.querySelector("h1, h2, h3");
    expect(heading?.textContent).toBe("H");
  });
});
