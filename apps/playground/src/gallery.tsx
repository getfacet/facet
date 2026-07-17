import type { CSSProperties } from "react";
import type { Color, FacetTree } from "@facet/core";
import { StageRenderer } from "@facet/react";
import { TreeBuilder } from "./tree-builder.js";

/**
 * A gallery of very different pages — all built from the SAME four bricks
 * (box/text/media/input) and token styles. No LLM: these are hand-authored to
 * show the *expressive range* of the low-level spec. A real agent (composing via
 * the local `bricks.ts` helper, or seeding from `@facet/assets` defaults) would
 * emit trees exactly like these.
 *
 * `TreeBuilder` accumulates nodes into the flat map and returns their ids, so
 * pages read like nested composition instead of a hand-written adjacency list.
 */
function hero(): FacetTree {
  const s = new TreeBuilder("n");
  const button = (label: string, name: string, primary: boolean): string =>
    s.box(
      primary
        ? { background: "accent", borderRadius: "md", padding: "md" }
        : {
            background: "surface",
            borderRadius: "md",
            padding: "md",
            borderWidth: "thin",
          },
      [
        s.text(label, {
          color: primary ? "accentForeground" : "foreground",
          fontWeight: "semibold",
        }),
      ],
      { kind: "agent", name },
    );
  return s.tree({ direction: "column", gap: "lg", padding: "2xl", alignItems: "center" }, [
    s.text("Build living pages", {
      fontSize: "3xl",
      fontWeight: "bold",
      textAlign: "center",
    }),
    s.text("One link. A different page for every visitor.", {
      fontSize: "md",
      color: "mutedForeground",
      textAlign: "center",
    }),
    s.box({ direction: "row", gap: "md", justifyContent: "center" }, [
      button("Get started", "get_started", true),
      button("Docs", "docs", false),
    ]),
  ]);
}

function productGrid(): FacetTree {
  const s = new TreeBuilder("n");
  const card = (seed: string, name: string, price: string): string =>
    s.box(
      {
        direction: "column",
        gap: "sm",
        borderWidth: "thin",
        borderRadius: "lg",
        padding: "md",
        grow: true,
      },
      [
        s.media(`https://picsum.photos/seed/${seed}/400/300`, name, {
          width: "full",
          aspectRatio: "wide",
          borderRadius: "md",
        }),
        s.text(name, { fontWeight: "semibold" }),
        s.text(price, { color: "mutedForeground", fontSize: "sm" }),
        s.box(
          { background: "accent", borderRadius: "sm", padding: "sm", alignItems: "center" },
          [
            s.text("Add to cart", {
              color: "accentForeground",
              fontSize: "sm",
              fontWeight: "semibold",
            }),
          ],
          { kind: "agent", name: "add", payload: { sku: seed } },
        ),
      ],
    );
  return s.tree({ direction: "column", gap: "lg", padding: "xl" }, [
    s.text("Featured", { fontSize: "2xl", fontWeight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      card("aurora", "Aurora Lamp", "$48"),
      card("willow", "Willow Chair", "$120"),
      card("terra", "Terra Mug", "$18"),
    ]),
  ]);
}

function signupForm(): FacetTree {
  const s = new TreeBuilder("n");
  return s.tree({ direction: "column", gap: "md", padding: "xl", alignItems: "stretch" }, [
    s.text("Join the beta", { fontSize: "2xl", fontWeight: "bold" }),
    s.text("We'll email you an invite.", { color: "mutedForeground", fontSize: "sm" }),
    s.field("email", "Email", "you@example.com"),
    s.field("name", "Name", "Ada Lovelace"),
    s.box(
      { background: "accent", borderRadius: "md", padding: "md", alignItems: "center" },
      [s.text("Request invite", { color: "accentForeground", fontWeight: "semibold" })],
      { kind: "agent", name: "submit" },
    ),
  ]);
}

function stats(): FacetTree {
  const s = new TreeBuilder("n");
  const stat = (
    num: string,
    label: string,
    background: Color,
    foreground: Color,
    labelColor: Color,
  ): string =>
    s.box(
      { direction: "column", gap: "xs", padding: "lg", background, borderRadius: "lg", grow: true },
      [
        s.text(num, { fontSize: "3xl", fontWeight: "bold", color: foreground }),
        s.text(label, { fontSize: "sm", color: labelColor }),
      ],
    );
  return s.tree({ direction: "column", gap: "lg", padding: "xl" }, [
    s.text("This month", { fontSize: "2xl", fontWeight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      stat("12.4k", "Visitors", "surface", "foreground", "mutedForeground"),
      stat("87%", "Return rate", "mutedSurface", "foreground", "mutedForeground"),
      stat("1,203", "Signups", "accent", "accentForeground", "accentForeground"),
    ]),
  ]);
}

function pricing(): FacetTree {
  const s = new TreeBuilder("n");
  const tier = (
    name: string,
    price: string,
    feats: readonly string[],
    highlight: boolean,
  ): string => {
    const foreground: Color = highlight ? "accentForeground" : "foreground";
    const muted: Color = highlight ? "accentForeground" : "mutedForeground";
    return s.box(
      highlight
        ? {
            direction: "column",
            gap: "sm",
            padding: "lg",
            borderRadius: "lg",
            background: "accent",
            grow: true,
          }
        : {
            direction: "column",
            gap: "sm",
            padding: "lg",
            borderRadius: "lg",
            borderWidth: "thin",
            grow: true,
          },
      [
        s.text(name, { fontWeight: "semibold", color: foreground }),
        s.text(price, { fontSize: "2xl", fontWeight: "bold", color: foreground }),
        ...feats.map((f) => s.text(`✓ ${f}`, { fontSize: "sm", color: muted })),
        s.box(
          highlight
            ? {
                background: "background",
                borderRadius: "sm",
                padding: "sm",
                alignItems: "center",
              }
            : {
                background: "accent",
                borderRadius: "sm",
                padding: "sm",
                alignItems: "center",
              },
          [
            s.text("Choose", {
              fontSize: "sm",
              fontWeight: "semibold",
              color: highlight ? "accent" : "accentForeground",
            }),
          ],
          { kind: "agent", name: "choose", payload: { tier: name } },
        ),
      ],
    );
  };
  return s.tree({ direction: "column", gap: "lg", padding: "xl" }, [
    s.text("Pricing", { fontSize: "2xl", fontWeight: "bold" }),
    s.box({ direction: "row", gap: "md", wrap: true }, [
      tier("Hobby", "$0", ["1 link", "Community"], false),
      tier("Pro", "$20", ["Unlimited", "Analytics", "Priority"], true),
      tier("Team", "$60", ["Everything", "SSO", "Support"], false),
    ]),
  ]);
}

function imageGallery(): FacetTree {
  const s = new TreeBuilder("n");
  const cell = (seed: string, caption: string): string =>
    s.box({ direction: "column", gap: "xs", grow: true }, [
      s.media(`https://picsum.photos/seed/${seed}/300/300`, caption, {
        width: "full",
        aspectRatio: "square",
        borderRadius: "md",
      }),
      s.text(caption, {
        fontSize: "sm",
        color: "mutedForeground",
        textAlign: "center",
      }),
    ]);
  return s.tree({ direction: "column", gap: "lg", padding: "xl" }, [
    s.text("Gallery", { fontSize: "2xl", fontWeight: "bold" }),
    s.box({ direction: "row", gap: "sm", wrap: true }, [
      cell("dawn", "Dawn"),
      cell("ridge", "Ridge"),
      cell("harbor", "Harbor"),
      cell("dunes", "Dunes"),
    ]),
  ]);
}

function screensAndToggle(): FacetTree {
  const s = new TreeBuilder("n");
  const navButton = (label: string, to: string): string =>
    s.box(
      {
        background: "surface",
        borderRadius: "md",
        padding: "sm",
        borderWidth: "thin",
        alignItems: "center",
      },
      [s.text(label, { fontSize: "sm", fontWeight: "semibold" })],
      { kind: "navigate", to },
    );
  // Pre-drawn menu panel, hidden on first paint — the ☰ box toggles it,
  // browser-locally (no agent turn), exactly like navigate below.
  const menu = s.hiddenBox(
    {
      direction: "column",
      gap: "xs",
      padding: "md",
      background: "mutedSurface",
      borderRadius: "md",
    },
    [
      s.text("Home", { fontSize: "sm" }),
      s.text("Pricing", { fontSize: "sm" }),
      s.text("Contact", { fontSize: "sm" }),
    ],
  );
  const main = s.box({ direction: "column", gap: "md", padding: "xl" }, [
    s.text("Home", { fontSize: "2xl", fontWeight: "bold" }),
    s.text("Navigate and toggle run instantly in the browser — no agent turn.", {
      fontSize: "sm",
      color: "mutedForeground",
    }),
    s.box(
      { background: "accent", borderRadius: "md", padding: "sm", alignItems: "center" },
      [
        s.text("☰ Menu", {
          color: "accentForeground",
          fontSize: "sm",
          fontWeight: "semibold",
        }),
      ],
      { kind: "toggle", target: menu },
    ),
    menu,
    navButton("About →", "about"),
  ]);
  const about = s.box({ direction: "column", gap: "md", padding: "xl" }, [
    s.text("About", { fontSize: "2xl", fontWeight: "bold" }),
    s.text("This screen was pre-drawn; the browser switched to it.", {
      fontSize: "sm",
      color: "mutedForeground",
    }),
    navButton("← Home", "main"),
  ]);
  return s.screensTree({ main, about }, "main");
}

/**
 * "Appear, hold & scroll" — the deterministic manual surface for the DC-009
 * real-browser check: a fade-in hero, a bounded vertically scrolling product list of 20
 * slide-in cards, and a press/hold pair on every card (press = agent action,
 * hold = browser-local toggle of a pre-drawn, initially-hidden peek panel).
 * Exported so the gallery test can assert on the exact tree.
 */
export function appearHoldScroll(): FacetTree {
  const s = new TreeBuilder("n");
  // Pre-drawn peek panel, hidden on first paint — every card's hold target.
  const peek = s.hiddenBox(
    {
      direction: "column",
      gap: "xs",
      padding: "md",
      background: "mutedSurface",
      borderRadius: "md",
      enterAnimation: "fade",
    },
    [
      s.text("Quick peek", { fontSize: "sm", fontWeight: "semibold" }),
      s.text("Hold any card to toggle this panel; press one to view it.", {
        fontSize: "sm",
        color: "mutedForeground",
      }),
    ],
  );
  const card = (i: number): string =>
    s.box(
      {
        direction: "row",
        gap: "md",
        padding: "md",
        borderWidth: "thin",
        borderRadius: "md",
        enterAnimation: "slide",
      },
      [
        s.media(`https://picsum.photos/seed/prod${i}/120/120`, `Product ${i}`, {
          aspectRatio: "square",
          borderRadius: "sm",
        }),
        s.box({ direction: "column", gap: "xs", grow: true }, [
          s.text(`Product ${i}`, { fontWeight: "semibold" }),
          s.text(`$${10 + i}`, { fontSize: "sm", color: "mutedForeground" }),
        ]),
      ],
      { kind: "agent", name: "view_product", payload: { sku: `prod${i}` } },
      { kind: "toggle", target: peek },
    );
  const hero = s.box(
    {
      direction: "column",
      gap: "xs",
      padding: "lg",
      background: "accent",
      borderRadius: "lg",
      enterAnimation: "fade",
    },
    [
      s.text("New arrivals", {
        fontSize: "2xl",
        fontWeight: "bold",
        color: "accentForeground",
      }),
      s.text("Press a card for details — hold it for a quick peek.", {
        fontSize: "sm",
        color: "accentForeground",
      }),
    ],
  );
  const list = s.box(
    { direction: "column", gap: "sm", scroll: "vertical" },
    Array.from({ length: 20 }, (_, i) => card(i + 1)),
  );
  return s.tree({ direction: "column", gap: "md", padding: "xl" }, [hero, peek, list]);
}

export function brickVocabV1Demo(): FacetTree {
  const s = new TreeBuilder("n");
  const video = s.media(
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    "Flower video",
    { width: "full", aspectRatio: "wide", borderRadius: "md" },
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
  const form = s.box(
    {
      direction: "column",
      gap: "sm",
      padding: "md",
      borderWidth: "thin",
      borderRadius: "md",
    },
    [plan, size, agree, alerts],
  );
  const submit = s.box(
    { background: "accent", borderRadius: "md", padding: "sm", alignItems: "center" },
    [
      s.text("Submit selections", {
        color: "accentForeground",
        fontWeight: "semibold",
        fontSize: "sm",
      }),
    ],
    { kind: "agent", name: "submit_vocab", collect: form },
  );
  const gridCell = (label: string, value: string): string =>
    s.box(
      { direction: "column", gap: "xs", padding: "md", background: "surface", borderRadius: "md" },
      [
        s.text(value, { fontSize: "xl", fontWeight: "bold" }),
        s.text(label, { fontSize: "sm", color: "mutedForeground" }),
      ],
    );
  const grid = s.box({ columns: 3, gap: "sm" }, [
    gridCell("Media kind", "video"),
    gridCell("Controls", "native"),
    gridCell("Layout", "grid"),
  ]);
  const railCard = (seed: string, label: string): string =>
    s.box(
      { direction: "column", gap: "xs", padding: "sm", borderWidth: "thin", borderRadius: "md" },
      [
        s.media(`https://picsum.photos/seed/${seed}/320/180`, label, {
          aspectRatio: "wide",
          borderRadius: "sm",
        }),
        s.text(label, { fontSize: "sm", fontWeight: "semibold" }),
      ],
    );
  const carousel = s.box({ direction: "row", gap: "sm", scroll: "horizontal" }, [
    railCard("vocab-a", "Alpha"),
    railCard("vocab-b", "Beta"),
    railCard("vocab-c", "Gamma"),
    railCard("vocab-d", "Delta"),
    railCard("vocab-e", "Epsilon"),
  ]);
  return s.tree({ direction: "column", gap: "md", padding: "xl" }, [
    s.text("Brick vocab v1", { fontSize: "2xl", fontWeight: "bold" }),
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
