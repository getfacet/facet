import type { CSSProperties } from "react";
import type {
  BoxStyle,
  Color,
  FacetAction,
  FacetNode,
  FacetTree,
  ImageStyle,
  TextStyle,
} from "@facet/core";
import { StageRenderer } from "@facet/react";

/**
 * A gallery of very different pages — all built from the SAME four bricks
 * (box/text/image/field) and token styles. No LLM: these are hand-authored to
 * show the *expressive range* of the low-level spec. A real agent (or the future
 * @facet/kit presets) would emit trees exactly like these.
 *
 * `Sheet` is a tiny authoring helper (a preview of what @facet/kit will do): it
 * accumulates nodes into the flat map and returns their ids, so pages read like
 * nested composition instead of a hand-written adjacency list.
 */
class Sheet {
  private readonly nodes: Record<string, FacetNode> = {};
  private count = 0;

  private next(): string {
    this.count += 1;
    return `n${this.count}`;
  }

  box(style: BoxStyle, children: readonly string[], onPress?: FacetAction): string {
    const id = this.next();
    this.nodes[id] =
      onPress === undefined
        ? { id, type: "box", style, children: [...children] }
        : { id, type: "box", style, children: [...children], onPress };
    return id;
  }

  text(value: string, style?: TextStyle): string {
    const id = this.next();
    this.nodes[id] =
      style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }

  image(src: string, alt: string, style?: ImageStyle): string {
    const id = this.next();
    this.nodes[id] =
      style === undefined
        ? { id, type: "image", src, alt }
        : { id, type: "image", src, alt, style };
    return id;
  }

  field(name: string, label: string, placeholder: string): string {
    const id = this.next();
    this.nodes[id] = { id, type: "field", name, label, placeholder, style: { width: "full" } };
    return id;
  }

  tree(rootStyle: BoxStyle, children: readonly string[]): FacetTree {
    this.nodes["root"] = { id: "root", type: "box", style: rootStyle, children: [...children] };
    return { root: "root", nodes: this.nodes };
  }
}

function hero(): FacetTree {
  const s = new Sheet();
  const button = (label: string, name: string, primary: boolean): string =>
    s.box(
      primary
        ? { bg: "accent", radius: "md", pad: "md" }
        : { bg: "surface", radius: "md", pad: "md", border: true },
      [s.text(label, { color: primary ? "accent-fg" : "fg", weight: "semibold" })],
      { name },
    );
  return s.tree({ direction: "col", gap: "lg", pad: "2xl", align: "center" }, [
    s.text("Build living pages", { size: "3xl", weight: "bold", align: "center" }),
    s.text("One link. A different page for every visitor.", {
      size: "md",
      color: "fg-muted",
      align: "center",
    }),
    s.box({ direction: "row", gap: "md", justify: "center" }, [
      button("Get started", "get_started", true),
      button("Docs", "docs", false),
    ]),
  ]);
}

function productGrid(): FacetTree {
  const s = new Sheet();
  const card = (seed: string, name: string, price: string): string =>
    s.box({ direction: "col", gap: "sm", border: true, radius: "lg", pad: "md", grow: true }, [
      s.image(`https://picsum.photos/seed/${seed}/400/300`, name, {
        width: "full",
        ratio: "wide",
        radius: "md",
      }),
      s.text(name, { weight: "semibold" }),
      s.text(price, { color: "fg-muted", size: "sm" }),
      s.box(
        { bg: "accent", radius: "sm", pad: "sm", align: "center" },
        [s.text("Add to cart", { color: "accent-fg", size: "sm", weight: "semibold" })],
        { name: "add", payload: { sku: seed } },
      ),
    ]);
  return s.tree({ direction: "col", gap: "lg", pad: "xl" }, [
    s.text("Featured", { size: "2xl", weight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      card("aurora", "Aurora Lamp", "$48"),
      card("willow", "Willow Chair", "$120"),
      card("terra", "Terra Mug", "$18"),
    ]),
  ]);
}

function signupForm(): FacetTree {
  const s = new Sheet();
  return s.tree({ direction: "col", gap: "md", pad: "xl", align: "stretch" }, [
    s.text("Join the beta", { size: "2xl", weight: "bold" }),
    s.text("We'll email you an invite.", { color: "fg-muted", size: "sm" }),
    s.field("email", "Email", "you@example.com"),
    s.field("name", "Name", "Ada Lovelace"),
    s.box(
      { bg: "accent", radius: "md", pad: "md", align: "center" },
      [s.text("Request invite", { color: "accent-fg", weight: "semibold" })],
      { name: "submit" },
    ),
  ]);
}

function stats(): FacetTree {
  const s = new Sheet();
  const stat = (num: string, label: string, bg: Color, fg: Color, labelColor: Color): string =>
    s.box({ direction: "col", gap: "xs", pad: "lg", bg, radius: "lg", grow: true }, [
      s.text(num, { size: "3xl", weight: "bold", color: fg }),
      s.text(label, { size: "sm", color: labelColor }),
    ]);
  return s.tree({ direction: "col", gap: "lg", pad: "xl" }, [
    s.text("This month", { size: "2xl", weight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      stat("12.4k", "Visitors", "surface", "fg", "fg-muted"),
      stat("87%", "Return rate", "surface-2", "fg", "fg-muted"),
      stat("1,203", "Signups", "accent", "accent-fg", "accent-fg"),
    ]),
  ]);
}

function pricing(): FacetTree {
  const s = new Sheet();
  const tier = (
    name: string,
    price: string,
    feats: readonly string[],
    highlight: boolean,
  ): string => {
    const fg: Color = highlight ? "accent-fg" : "fg";
    const muted: Color = highlight ? "accent-fg" : "fg-muted";
    return s.box(
      highlight
        ? { direction: "col", gap: "sm", pad: "lg", radius: "lg", bg: "accent", grow: true }
        : { direction: "col", gap: "sm", pad: "lg", radius: "lg", border: true, grow: true },
      [
        s.text(name, { weight: "semibold", color: fg }),
        s.text(price, { size: "2xl", weight: "bold", color: fg }),
        ...feats.map((f) => s.text(`✓ ${f}`, { size: "sm", color: muted })),
        s.box(
          highlight
            ? { bg: "bg", radius: "sm", pad: "sm", align: "center" }
            : { bg: "accent", radius: "sm", pad: "sm", align: "center" },
          [
            s.text("Choose", {
              size: "sm",
              weight: "semibold",
              color: highlight ? "accent" : "accent-fg",
            }),
          ],
          { name: "choose", payload: { tier: name } },
        ),
      ],
    );
  };
  return s.tree({ direction: "col", gap: "lg", pad: "xl" }, [
    s.text("Pricing", { size: "2xl", weight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      tier("Hobby", "$0", ["1 link", "Community"], false),
      tier("Pro", "$20", ["Unlimited", "Analytics", "Priority"], true),
      tier("Team", "$60", ["Everything", "SSO", "Support"], false),
    ]),
  ]);
}

function imageGallery(): FacetTree {
  const s = new Sheet();
  const cell = (seed: string, caption: string): string =>
    s.box({ direction: "col", gap: "xs", grow: true }, [
      s.image(`https://picsum.photos/seed/${seed}/300/300`, caption, {
        width: "full",
        ratio: "square",
        radius: "md",
      }),
      s.text(caption, { size: "sm", color: "fg-muted", align: "center" }),
    ]);
  return s.tree({ direction: "col", gap: "lg", pad: "xl" }, [
    s.text("Gallery", { size: "2xl", weight: "bold" }),
    s.box({ direction: "row", gap: "sm", wrap: true }, [
      cell("dawn", "Dawn"),
      cell("ridge", "Ridge"),
      cell("harbor", "Harbor"),
      cell("dunes", "Dunes"),
    ]),
  ]);
}

const PAGES: readonly { readonly title: string; readonly tree: FacetTree }[] = [
  { title: "Hero / landing", tree: hero() },
  { title: "Product grid", tree: productGrid() },
  { title: "Sign-up form", tree: signupForm() },
  { title: "Stats", tree: stats() },
  { title: "Pricing tiers", tree: pricing() },
  { title: "Image gallery", tree: imageGallery() },
];

export function Gallery(): React.ReactNode {
  return (
    <div style={styles.grid}>
      {PAGES.map((page) => (
        <figure key={page.title} style={styles.figure}>
          <figcaption style={styles.caption}>{page.title}</figcaption>
          <div style={styles.frame}>
            <StageRenderer tree={page.tree} />
          </div>
        </figure>
      ))}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "24px",
    maxWidth: "1100px",
    margin: "0 auto",
  },
  figure: { margin: 0 },
  caption: { color: "#9aa0aa", fontSize: "13px", marginBottom: "8px" },
  frame: {
    background: "#fff",
    color: "#1a1d23",
    border: "1px solid #2a2e37",
    borderRadius: "14px",
    overflow: "hidden",
    minHeight: "260px",
  },
};
