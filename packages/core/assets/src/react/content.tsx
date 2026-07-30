/**
 * The trusted React implementations of the three content components: `Text`,
 * `Metric` and `Badge`.
 *
 * These are the other half of the trust boundary. The catalog says a tag exists
 * and what its props mean; this module says what that tag *is* in the browser,
 * and the host registers it before bootstrap. Nothing an agent writes reaches
 * this file except as a resolved prop value — which is why the components can be
 * ordinary React and still carry no authoring escape hatch.
 *
 * Three rules shape every implementation here.
 *
 * **Props are read defensively even though they arrive validated.** The renderer
 * checks each value against the declared schema before mounting, so a wrong type
 * should be impossible; reading through a typed guard anyway costs one line and
 * turns "impossible" into "renders the declared default". A trusted component
 * that unwound on a surprising value would trip a subtree boundary and blank a
 * region of the page for a reason the visitor cannot act on.
 *
 * **Styling is token names and nothing else.** Each root carries the active
 * theme's custom properties — `themeVars` is that projection, ready to put on a
 * style attribute — and every declaration references a token by name through
 * `token()` rather than reading its value out. Referencing keeps the cascade
 * live: the same component mounted inside the Modal frame's portal, which has
 * no Screen ancestor to inherit from, still resolves every name it uses. There
 * is no raw CSS, no class name reaching for a stylesheet this package does not
 * own, and — deliberately — no `position` and no `z-index`: the `FlowStyle`
 * type the shared helpers accept makes that structural rather than a promise,
 * because a component that positioned itself would be the escape hatch the
 * layout invariant exists to refuse.
 *
 * **Presentation decisions live here, not in the catalog.** `Metric.value` is
 * declared a number precisely so the host publishes `42000000` and this file
 * decides how it reads. That keeps formatting out of every host's publish path.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point. `react.tsx` composes these into the one default registry.
 */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import { flowStyle, mountStyle, token } from "./style.js";

/** What one of these components is handed. React supplies both element types. */
type Mount = ComponentMountProps<ReactNode>;

/**
 * Reads a declared string prop, falling back when the value is anything else.
 * `Object`-shaped and numeric values cannot arrive here through validation; the
 * guard is what makes that guarantee unnecessary to trust.
 */
function readString(mount: Mount, name: string, fallback: string): string {
  const value = mount.props[name];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads a declared prop whose domain is a closed enum, falling back to the
 * catalog's own default when the value is outside it. The allowed list is
 * passed in rather than inferred so each component states its own domain beside
 * the styles it maps to.
 */
function readEnum<Value extends string>(
  mount: Mount,
  name: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const value = mount.props[name];
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * The typographic role each `Text` variant plays, as the token references it
 * paints with.
 *
 * The map is the whole of the variant vocabulary: a value outside it never
 * reaches a style, because `readEnum` folds it back to `body` first. Each entry
 * is built by `token()`, so a scale step the theme contract does not declare is
 * a type error in this table rather than a variable that resolves to nothing.
 */
const TEXT_VARIANTS = {
  title: {
    fontSize: token("fontSize", "xl"),
    fontWeight: token("fontWeight", "bold"),
    lineHeight: token("lineHeight", "tight"),
  },
  heading: {
    fontSize: token("fontSize", "lg"),
    fontWeight: token("fontWeight", "medium"),
    lineHeight: token("lineHeight", "tight"),
  },
  body: {
    fontSize: token("fontSize", "md"),
    fontWeight: token("fontWeight", "regular"),
    lineHeight: token("lineHeight", "normal"),
  },
  caption: {
    fontSize: token("fontSize", "xs"),
    fontWeight: token("fontWeight", "regular"),
    lineHeight: token("lineHeight", "normal"),
  },
} as const;

const TEXT_VARIANT_NAMES = Object.keys(TEXT_VARIANTS) as readonly (keyof typeof TEXT_VARIANTS)[];

/**
 * A line or a paragraph of prose.
 *
 * The variant chooses the element as well as the type scale, so a title is an
 * `h1` and a heading is an `h2`: the document outline a screen reader announces
 * follows the role the author named, rather than being flattened into styled
 * paragraphs. `caption` stays a paragraph — it is small print, not a level in
 * the outline.
 */
export const Text: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const value = readString(mount, "value", "");
  const variant = readEnum(mount, "variant", TEXT_VARIANT_NAMES, "body");
  const muted = readEnum(mount, "tone", ["default", "muted"] as const, "default") === "muted";
  const scale = TEXT_VARIANTS[variant];

  const style = mountStyle(mount.themeVars, {
    margin: 0,
    fontFamily: token("fontFamily", "sans"),
    fontSize: scale.fontSize,
    fontWeight: scale.fontWeight,
    lineHeight: scale.lineHeight,
    color: muted ? token("color", "textMuted") : token("color", "text"),
  });

  if (variant === "title") return <h1 style={style}>{value}</h1>;
  if (variant === "heading") return <h2 style={style}>{value}</h2>;
  return <p style={style}>{value}</p>;
};

/**
 * How a `Metric` number reads.
 *
 * The locale is pinned rather than taken from the visitor's environment so the
 * default catalog renders the same figure everywhere, including in tests and in
 * server-rendered output where "the environment" is the machine's. A host whose
 * audience needs another locale registers its own `Metric` — that is what the
 * registry is for — and this default stays one predictable thing.
 */
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

/**
 * One headline number and the label that says what it measures.
 *
 * A value that is not a finite number renders as nothing at all rather than as
 * `NaN` or `Infinity`: the label still says what is being measured, and the
 * figure is simply absent, which is the honest reading of a number that failed
 * to arrive.
 */
export const Metric: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const raw = mount.props["value"];
  const value = typeof raw === "number" && Number.isFinite(raw) ? NUMBER_FORMAT.format(raw) : "";
  const unit = readString(mount, "unit", "");

  const rootStyle: FlowStyle = {
    display: "flex",
    flexDirection: "column",
    gap: token("space", "xs"),
    fontFamily: token("fontFamily", "sans"),
  };
  const labelStyle: FlowStyle = {
    fontSize: token("fontSize", "sm"),
    fontWeight: token("fontWeight", "regular"),
    color: token("color", "textMuted"),
  };
  const valueStyle: FlowStyle = {
    display: "flex",
    alignItems: "baseline",
    gap: token("space", "xs"),
    fontSize: token("fontSize", "xl"),
    fontWeight: token("fontWeight", "bold"),
    lineHeight: token("lineHeight", "tight"),
    color: token("color", "text"),
  };
  const unitStyle: FlowStyle = {
    fontSize: token("fontSize", "sm"),
    fontWeight: token("fontWeight", "medium"),
    color: token("color", "textMuted"),
  };

  return (
    <div style={mountStyle(mount.themeVars, rootStyle)}>
      <span style={flowStyle(labelStyle)}>{label}</span>
      <span style={flowStyle(valueStyle)}>
        <span>{value}</span>
        {unit === "" ? null : <span style={flowStyle(unitStyle)}>{unit}</span>}
      </span>
    </div>
  );
};

/**
 * What each `Badge` tone paints with. Neutral reads as quiet secondary text;
 * the other three borrow the semantic colour that already means that outcome
 * everywhere else in the theme, so a status word never needs a colour of its own.
 */
const BADGE_TONES = {
  neutral: token("color", "textMuted"),
  positive: token("color", "success"),
  warning: token("color", "warning"),
  danger: token("color", "danger"),
} as const;

const BADGE_TONE_NAMES = Object.keys(BADGE_TONES) as readonly (keyof typeof BADGE_TONES)[];

/** A short status word, marked so it reads as a status rather than as copy. */
export const Badge: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const tone = readEnum(mount, "tone", BADGE_TONE_NAMES, "neutral");
  const accent = BADGE_TONES[tone];

  const style: FlowStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: token("space", "xs"),
    padding: `${token("space", "xs")} ${token("space", "sm")}`,
    borderRadius: token("radius", "full"),
    border: `${token("borderWidth", "thin")} solid ${accent}`,
    background: token("color", "surface"),
    color: accent,
    fontFamily: token("fontFamily", "sans"),
    fontSize: token("fontSize", "xs"),
    fontWeight: token("fontWeight", "medium"),
    lineHeight: token("lineHeight", "tight"),
  };

  return <span style={mountStyle(mount.themeVars, style)}>{label}</span>;
};
