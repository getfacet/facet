import type { CSSProperties } from "react";
import type {
  BoxStyle,
  Color,
  FacetAction,
  FacetNode,
  FacetTree,
  FieldInput,
  MediaStyle,
  TextStyle,
} from "@facet/core";
import { StageRenderer } from "@facet/react";

/**
 * A gallery of very different pages — all built from the SAME four bricks
 * (box/text/media/field) and token styles. No LLM: these are hand-authored to
 * show the *expressive range* of the low-level spec. A real agent (composing via
 * the local `bricks.ts` helper, or seeding from `@facet/assets` defaults) would
 * emit trees exactly like these.
 *
 * `Sheet` is a tiny authoring helper (the same idea as `bricks.ts`): it
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

  /**
   * `onHold` is the LAST positional parameter this signature will take — the
   * next per-box word means switching to an options object.
   */
  box(
    style: BoxStyle,
    children: readonly string[],
    onPress?: FacetAction,
    onHold?: FacetAction,
  ): string {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "box",
      style,
      children: [...children],
      ...(onPress !== undefined ? { onPress } : {}),
      ...(onHold !== undefined ? { onHold } : {}),
    };
    return id;
  }

  /** A box that starts hidden (content-declared default) — a toggle target. */
  hiddenBox(style: BoxStyle, children: readonly string[]): string {
    const id = this.next();
    this.nodes[id] = { id, type: "box", style, children: [...children], hidden: true };
    return id;
  }

  text(value: string, style?: TextStyle): string {
    const id = this.next();
    this.nodes[id] =
      style === undefined ? { id, type: "text", value } : { id, type: "text", value, style };
    return id;
  }

  media(
    src: string,
    alt: string,
    style?: MediaStyle,
    kind: "image" | "video" = "image",
    extra?: { readonly poster?: string; readonly controls?: boolean },
  ): string {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "media",
      kind,
      src,
      alt,
      ...(style !== undefined ? { style } : {}),
      ...(extra?.poster !== undefined ? { poster: extra.poster } : {}),
      ...(extra?.controls !== undefined ? { controls: extra.controls } : {}),
    };
    return id;
  }

  field(
    name: string,
    label: string,
    placeholder: string,
    input?: FieldInput,
    options?: readonly string[],
  ): string {
    const id = this.next();
    this.nodes[id] = {
      id,
      type: "field",
      name,
      label,
      placeholder,
      style: { width: "full" },
      ...(input !== undefined ? { input } : {}),
      ...(options !== undefined ? { options } : {}),
    };
    return id;
  }

  tree(rootStyle: BoxStyle, children: readonly string[]): FacetTree {
    this.nodes["root"] = { id: "root", type: "box", style: rootStyle, children: [...children] };
    return { root: "root", nodes: this.nodes };
  }

  /**
   * A multi-screen tree: `screens` maps name → screen root box id (named roots
   * into the same flat map). `root` keeps every screen as a child so a
   * screens-unaware renderer still shows all content (plain fallback).
   */
  screensTree(screens: Readonly<Record<string, string>>, entry: string): FacetTree {
    this.nodes["root"] = {
      id: "root",
      type: "box",
      style: { direction: "col" },
      children: Object.values(screens),
    };
    return { root: "root", nodes: this.nodes, screens, entry };
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
      { kind: "agent", name },
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
      s.media(`https://picsum.photos/seed/${seed}/400/300`, name, {
        width: "full",
        ratio: "wide",
        radius: "md",
      }),
      s.text(name, { weight: "semibold" }),
      s.text(price, { color: "fg-muted", size: "sm" }),
      s.box(
        { bg: "accent", radius: "sm", pad: "sm", align: "center" },
        [s.text("Add to cart", { color: "accent-fg", size: "sm", weight: "semibold" })],
        { kind: "agent", name: "add", payload: { sku: seed } },
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
      { kind: "agent", name: "submit" },
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
          { kind: "agent", name: "choose", payload: { tier: name } },
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
      s.media(`https://picsum.photos/seed/${seed}/300/300`, caption, {
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

function screensAndToggle(): FacetTree {
  const s = new Sheet();
  const navButton = (label: string, to: string): string =>
    s.box(
      { bg: "surface", radius: "md", pad: "sm", border: true, align: "center" },
      [s.text(label, { size: "sm", weight: "semibold" })],
      { kind: "navigate", to },
    );
  // Pre-drawn menu panel, hidden on first paint — the ☰ box toggles it,
  // browser-locally (no agent turn), exactly like navigate below.
  const menu = s.hiddenBox(
    { direction: "col", gap: "xs", pad: "md", bg: "surface-2", radius: "md" },
    [
      s.text("Home", { size: "sm" }),
      s.text("Pricing", { size: "sm" }),
      s.text("Contact", { size: "sm" }),
    ],
  );
  const main = s.box({ direction: "col", gap: "md", pad: "xl" }, [
    s.text("Home", { size: "2xl", weight: "bold" }),
    s.text("Navigate and toggle run instantly in the browser — no agent turn.", {
      size: "sm",
      color: "fg-muted",
    }),
    s.box(
      { bg: "accent", radius: "md", pad: "sm", align: "center" },
      [s.text("☰ Menu", { color: "accent-fg", size: "sm", weight: "semibold" })],
      { kind: "toggle", target: menu },
    ),
    menu,
    navButton("About →", "about"),
  ]);
  const about = s.box({ direction: "col", gap: "md", pad: "xl" }, [
    s.text("About", { size: "2xl", weight: "bold" }),
    s.text("This screen was pre-drawn; the browser switched to it.", {
      size: "sm",
      color: "fg-muted",
    }),
    navButton("← Home", "main"),
  ]);
  return s.screensTree({ main, about }, "main");
}

/**
 * "Appear, hold & scroll" — the deterministic manual surface for the DC-009
 * real-browser check: a fade-in hero, a bounded scroll:true product list of 20
 * slide-in cards, and a press/hold pair on every card (press = agent action,
 * hold = browser-local toggle of a pre-drawn, initially-hidden peek panel).
 * Exported so the gallery test can assert on the exact tree.
 */
export function appearHoldScroll(): FacetTree {
  const s = new Sheet();
  // Pre-drawn peek panel, hidden on first paint — every card's hold target.
  const peek = s.hiddenBox(
    { direction: "col", gap: "xs", pad: "md", bg: "surface-2", radius: "md", appear: "fade" },
    [
      s.text("Quick peek", { size: "sm", weight: "semibold" }),
      s.text("Hold any card to toggle this panel; press one to view it.", {
        size: "sm",
        color: "fg-muted",
      }),
    ],
  );
  const card = (i: number): string =>
    s.box(
      { direction: "row", gap: "md", pad: "md", border: true, radius: "md", appear: "slide" },
      [
        s.media(`https://picsum.photos/seed/prod${i}/120/120`, `Product ${i}`, {
          ratio: "square",
          radius: "sm",
        }),
        s.box({ direction: "col", gap: "xs", grow: true }, [
          s.text(`Product ${i}`, { weight: "semibold" }),
          s.text(`$${10 + i}`, { size: "sm", color: "fg-muted" }),
        ]),
      ],
      { kind: "agent", name: "view_product", payload: { sku: `prod${i}` } },
      { kind: "toggle", target: peek },
    );
  const hero = s.box(
    { direction: "col", gap: "xs", pad: "lg", bg: "accent", radius: "lg", appear: "fade" },
    [
      s.text("New arrivals", { size: "2xl", weight: "bold", color: "accent-fg" }),
      s.text("Press a card for details — hold it for a quick peek.", {
        size: "sm",
        color: "accent-fg",
      }),
    ],
  );
  const list = s.box(
    { direction: "col", gap: "sm", scroll: true },
    Array.from({ length: 20 }, (_, i) => card(i + 1)),
  );
  return s.tree({ direction: "col", gap: "md", pad: "xl" }, [hero, peek, list]);
}

export function brickVocabV1Demo(): FacetTree {
  const s = new Sheet();
  const video = s.media(
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "Flower video",
    { width: "full", ratio: "wide", radius: "md" },
    "video",
    {
      poster: "https://interactive-examples.mdn.mozilla.net/media/examples/flower.jpg",
      controls: true,
    },
  );
  const plan = s.field("plan", "Plan", "", "select", ["Free", "Pro", "Team"]);
  const size = s.field("size", "Size", "", "radio", ["Small", "Large"]);
  const agree = s.field("agree", "Agree to terms", "", "checkbox");
  const alerts = s.field("alerts", "Alerts", "", "switch");
  const form = s.box({ direction: "col", gap: "sm", pad: "md", border: true, radius: "md" }, [
    plan,
    size,
    agree,
    alerts,
  ]);
  const submit = s.box(
    { bg: "accent", radius: "md", pad: "sm", align: "center" },
    [s.text("Submit selections", { color: "accent-fg", weight: "semibold", size: "sm" })],
    { kind: "agent", name: "submit_vocab", collect: form },
  );
  const gridCell = (label: string, value: string): string =>
    s.box({ direction: "col", gap: "xs", pad: "md", bg: "surface", radius: "md" }, [
      s.text(value, { size: "xl", weight: "bold" }),
      s.text(label, { size: "sm", color: "fg-muted" }),
    ]);
  const grid = s.box({ columns: 3, gap: "sm" }, [
    gridCell("Media kind", "video"),
    gridCell("Controls", "native"),
    gridCell("Layout", "grid"),
  ]);
  const railCard = (seed: string, label: string): string =>
    s.box({ direction: "col", gap: "xs", pad: "sm", border: true, radius: "md" }, [
      s.media(`https://picsum.photos/seed/${seed}/320/180`, label, {
        ratio: "wide",
        radius: "sm",
      }),
      s.text(label, { size: "sm", weight: "semibold" }),
    ]);
  const carousel = s.box({ direction: "row", gap: "sm", scroll: "x" }, [
    railCard("vocab-a", "Alpha"),
    railCard("vocab-b", "Beta"),
    railCard("vocab-c", "Gamma"),
    railCard("vocab-d", "Delta"),
    railCard("vocab-e", "Epsilon"),
  ]);
  return s.tree({ direction: "col", gap: "md", pad: "xl" }, [
    s.text("Brick vocab v1", { size: "2xl", weight: "bold" }),
    video,
    form,
    submit,
    grid,
    carousel,
  ]);
}

const PAGES: readonly { readonly title: string; readonly tree: FacetTree }[] = [
  { title: "Hero / landing", tree: hero() },
  { title: "Product grid", tree: productGrid() },
  { title: "Sign-up form", tree: signupForm() },
  { title: "Stats", tree: stats() },
  { title: "Pricing tiers", tree: pricing() },
  { title: "Image gallery", tree: imageGallery() },
  { title: "Screens & toggle", tree: screensAndToggle() },
  { title: "Appear, hold & scroll", tree: appearHoldScroll() },
  { title: "Brick vocab v1", tree: brickVocabV1Demo() },
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
