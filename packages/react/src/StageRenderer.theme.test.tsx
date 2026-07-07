// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { FacetTheme, FacetTree } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

// Themed values are deliberately unusual so they can never be confused with the
// DEFAULT_THEME pins (space.md "16px", radius.md "10px", color.fg "#1a1d23",
// color.bg "#ffffff"). Dimensions (px) are read back verbatim by jsdom's CSSOM;
// colors normalize to `rgb(...)`, so color assertions match either form.
const MIDNIGHT: FacetTheme = {
  name: "midnight",
  color: { bg: "#010101", fg: "#fe0000" },
  space: { md: "99px" },
  fontFamily: { mono: '"Fira Code", monospace' },
  radius: { md: "42px" },
};

const DAWN: FacetTheme = {
  name: "dawn",
  color: { bg: "#ababab" },
  space: { md: "50px" },
};

/** A one-box, one-text tree whose styles reference the tokens the themes override. */
function themedTree(theme: string): FacetTree {
  return {
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        style: { bg: "bg", pad: "md", radius: "md" },
        children: ["t"],
      },
      t: { id: "t", type: "text", value: "hello", style: { color: "fg", family: "mono" } },
    },
    theme,
  };
}

/** The same tree with no `theme` field at all (today's default path). */
function plainTree(): FacetTree {
  const t = themedTree("unused");
  delete (t as { theme?: unknown }).theme;
  return t;
}

/** The root box div — with no `onAction` the renderer returns the stage directly. */
function rootBox(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

// StageRenderer resolves the tree's `theme` NAME against the operator-authored
// `themes` prop into concrete CSS. These jsdom tests assert the resolved values
// actually reach the DOM (the string-render suite can't see resolution).
describe("StageRenderer theming (jsdom)", () => {
  it("renders the named theme values from the themes prop", () => {
    const { container } = render(
      <StageRenderer themes={[MIDNIGHT]} tree={themedTree("midnight")} />,
    );
    const box = rootBox(container);
    // Space + radius tokens resolve to the MIDNIGHT overrides, not the defaults.
    expect(box.style.padding).toBe("99px");
    expect(box.style.borderRadius).toBe("42px");
    // The themed text color reaches the DOM (jsdom normalizes hex to rgb).
    const text = container.querySelector("p") as HTMLElement;
    expect(text.style.color === "#fe0000" || text.style.color === "rgb(254, 0, 0)").toBe(true);
    expect(text.style.fontFamily).toBe('"Fira Code", monospace');
  });

  it("renders the default sans font family when text omits the family token", () => {
    const base = themedTree("midnight");
    const textNode = base.nodes["t"] as Extract<FacetTree["nodes"][string], { type: "text" }>;
    const tree: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        t: { ...textNode, style: { color: "fg" } },
      },
    };

    const { container } = render(<StageRenderer themes={[MIDNIGHT]} tree={tree} />);
    const text = container.querySelector("p") as HTMLElement;

    expect(text.style.fontFamily).toBe("Nunito, sans-serif");
  });

  it("re-renders with the new theme values when the theme name flips", () => {
    const { container, rerender } = render(
      <StageRenderer themes={[MIDNIGHT, DAWN]} tree={themedTree("midnight")} />,
    );
    expect(rootBox(container).style.padding).toBe("99px");
    rerender(<StageRenderer themes={[MIDNIGHT, DAWN]} tree={themedTree("dawn")} />);
    expect(rootBox(container).style.padding).toBe("50px");
  });

  it("falls back to the default theme for an unknown name without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(
        <StageRenderer themes={[MIDNIGHT]} tree={themedTree("no-such")} />,
      ).container;
    }).not.toThrow();
    const box = rootBox(container);
    expect(box.style.padding).toBe("16px"); // DEFAULT_THEME space.md
    expect(box.style.borderRadius).toBe("10px"); // DEFAULT_THEME radius.md
  });

  it("renders the default look when no themes prop is given", () => {
    const { container } = render(<StageRenderer tree={plainTree()} />);
    const box = rootBox(container);
    expect(box.style.padding).toBe("16px");
    expect(box.style.borderRadius).toBe("10px");
  });

  it("never throws and never injects for hostile or non-string theme names", () => {
    const hostile: unknown[] = [
      "__proto__",
      "constructor",
      "prototype",
      "",
      "a".repeat(10_000),
      42,
      null,
      {},
    ];
    for (const name of hostile) {
      const tree = { ...themedTree("x"), theme: name } as unknown as FacetTree;
      let container!: HTMLElement;
      expect(() => {
        container = render(<StageRenderer themes={[MIDNIGHT]} tree={tree} />).container;
      }).not.toThrow();
      // No match / non-string ⇒ the default look, never the MIDNIGHT override.
      expect(rootBox(container).style.padding).toBe("16px");
      cleanup();
    }
  });

  it("ignores forbidden and unknown keys in a theme document without polluting or throwing", () => {
    // JSON.parse yields a REAL own "__proto__" key (a literal would set the
    // prototype instead) — the exact shape a shell → JSON.parse round trip
    // restores. resolveTheme must copy only own, member, primitive values.
    const hostileDoc = JSON.parse(
      '{"name":"evil","space":{"__proto__":"5px","constructor":"6px","nonsense":"7px","md":"77px"}}',
    ) as FacetTheme;
    const tree = { ...themedTree("evil"), theme: "evil" } as unknown as FacetTree;
    let container!: HTMLElement;
    expect(() => {
      container = render(<StageRenderer themes={[hostileDoc]} tree={tree} />).container;
    }).not.toThrow();
    // The valid `md` override applies; forbidden/unknown keys are dropped.
    expect(rootBox(container).style.padding).toBe("77px");
    // Nothing leaked onto Object.prototype via a "__proto__" assignment.
    expect((Object.prototype as Record<string, unknown>)["md"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["md"]).toBeUndefined();
  });
});
