import type { ReactNode } from "react";
import {
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  resolveNodeData,
  type FacetNode,
} from "@facet/core";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import {
  MAX_INTRINSIC_ITEMS,
  cappedArray,
  cappedString,
  clampProgress,
  componentBoxStyle,
  componentRecipe,
  componentTextStyle,
  intrinsicBoxStyle,
  partBoxStyle,
  partTextStyle,
  safeOwnValue,
  stringValue,
  withInert,
} from "./brick-renderer-shared.js";

function renderMetricLike<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
  component: "metric" | "stat",
): ReactNode {
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  // A `from`-bound metric/stat reads its value from one dataset cell via the ONE
  // core helper (precedence: from wins over inline; a dangling/absent binding
  // resolves to "" ⇒ an empty node, matching the content gate). A pure read.
  const value =
    (node.type === "metric" || node.type === "stat") && node.from !== undefined
      ? cappedString(resolveNodeData(node, context.data), MAX_NODE_LABEL_CHARS) || undefined
      : cappedString(safeOwnValue(node, "value"), MAX_NODE_LABEL_CHARS);
  if (label === undefined || value === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, component, variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "xs",
    pad: "sm",
    bg: "surface",
    radius: "md",
  });
  const delta = cappedString(safeOwnValue(node, "delta"), MAX_NODE_LABEL_CHARS);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      <p style={componentTextStyle(theme, recipe, { color: "fg-muted", size: "sm" }, "label")}>
        {label}
      </p>
      <p
        style={componentTextStyle(
          theme,
          recipe,
          { color: "fg", size: "xl", weight: "bold" },
          "value",
        )}
      >
        {value}
      </p>
      {delta === undefined ? null : (
        <p style={componentTextStyle(theme, recipe, { color: "fg-muted" }, "trend")}>{delta}</p>
      )}
    </div>
  );
}

export function renderMetric<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  return renderMetricLike(node, context, "metric");
}

export function renderStat<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  return renderMetricLike(node, context, "stat");
}

export function renderKeyValue<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  // `from`-bound keyValue projects `{label, value}` per dataset row through the
  // ONE core helper (precedence: from wins; dangling ⇒ []); unbound reads inline.
  const source =
    node.type === "keyValue" && node.from !== undefined
      ? resolveNodeData(node, context.data)
      : safeOwnValue(node, "items");
  const items = cappedArray(source, MAX_INTRINSIC_ITEMS).flatMap((item, index) => {
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const value = cappedString(safeOwnValue(item, "value"), MAX_NODE_LABEL_CHARS);
    if (label === undefined || value === undefined) return [];
    const key = stringValue(safeOwnValue(item, "key")) ?? `${String(index)}:${label}`;
    return [{ key, label, value, tone: safeOwnValue(item, "tone") }];
  });
  if (items.length === 0) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "keyValue", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "sm",
    bg: "surface",
    border: true,
    radius: "md",
  });
  const itemStyle = partBoxStyle(theme, recipe, "item", {
    direction: "row",
    justify: "between",
    gap: "md",
    wrap: true,
  });
  return (
    <dl
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert({ ...style, margin: 0 }, inert)}
    >
      {items.map((item) => (
        <div key={item.key} style={itemStyle}>
          <dt style={partTextStyle(theme, recipe, "label", { color: "fg-muted", size: "sm" })}>
            {item.label}
          </dt>
          <dd
            style={{
              ...partTextStyle(theme, recipe, "value", {
                color: item.tone === "success" ? "success" : "fg",
                weight: "semibold",
              }),
              margin: 0,
            }}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function renderProgress<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert } = context;
  const value = clampProgress(safeOwnValue(node, "value"));
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "progress", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "xs",
    width: "full",
  });
  const trackPart = resolveRecipePart(recipe, "track", theme);
  const fillPart = resolveRecipePart(recipe, "fill", theme);
  const trackStyle = intrinsicBoxStyle(trackPart.box);
  const fillStyle = intrinsicBoxStyle(fillPart.box);
  return (
    <label
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {label === undefined ? null : (
        <span style={componentTextStyle(theme, recipe, {}, "label")}>{label}</span>
      )}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        style={rootContainmentStyle({
          ...trackStyle,
          display: "block",
          width: "100%",
          height: theme.space.sm,
          overflow: "hidden",
        })}
      >
        <div
          style={rootContainmentStyle({
            ...fillStyle,
            display: "block",
            width: `${String(value)}%`,
            height: "100%",
          })}
        />
      </div>
    </label>
  );
}

export function renderList<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  // `from`-bound list projects one item per dataset row through the ONE core
  // helper (precedence: from wins; dangling ⇒ []); unbound reads inline items.
  const source =
    node.type === "list" && node.from !== undefined
      ? resolveNodeData(node, context.data)
      : safeOwnValue(node, "items");
  const items = cappedArray(source, MAX_LIST_ITEMS).flatMap((item) => {
    if (typeof item === "string") {
      return [{ title: item.slice(0, MAX_NODE_LABEL_CHARS), body: undefined }];
    }
    const title = cappedString(safeOwnValue(item, "title"), MAX_NODE_LABEL_CHARS);
    if (title === undefined) return [];
    return [{ title, body: cappedString(safeOwnValue(item, "body"), MAX_NODE_BODY_CHARS) }];
  });
  if (items.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "list", variant);
  const style = componentBoxStyle(theme, recipe, { gap: "sm" });
  const itemStyle = partBoxStyle(theme, recipe, "item");
  return (
    <ul
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {items.map((item, index) => (
        <li key={`${String(index)}:${item.title}`} style={itemStyle}>
          <span style={partTextStyle(theme, recipe, "itemTitle")}>{item.title}</span>
          {item.body === undefined ? null : (
            <p style={partTextStyle(theme, recipe, "itemText", { color: "fg-muted" })}>
              {item.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function renderEmptyState<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert } = context;
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  const actionLabel = cappedString(safeOwnValue(node, "actionLabel"), MAX_NODE_LABEL_CHARS);
  if (title === undefined && body === undefined && actionLabel === undefined) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "emptyState", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "md",
    align: "center",
    bg: "surface",
    border: true,
    radius: "md",
    width: "full",
  });
  const press = context.classifyPress(safeOwnValue(node, "onPress"));
  return (
    <section
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {title === undefined ? null : (
        <h3 style={componentTextStyle(theme, recipe, { align: "center", weight: "bold" }, "title")}>
          {title}
        </h3>
      )}
      {body === undefined ? null : (
        <p
          style={componentTextStyle(theme, recipe, { align: "center", color: "fg-muted" }, "body")}
        >
          {body}
        </p>
      )}
      {actionLabel === undefined ? null : (
        <button
          type="button"
          disabled={inert || press === null ? true : undefined}
          tabIndex={inert ? -1 : undefined}
          onClick={inert || press === null ? undefined : () => context.dispatch(press)}
          style={rootContainmentStyle({
            background: theme.color.accent,
            border: 0,
            borderRadius: theme.radius.md,
            color: theme.color["accent-fg"],
            cursor: inert || press === null ? undefined : "pointer",
            font: "inherit",
            fontWeight: theme.fontWeight.semibold,
            padding: `${theme.space.sm} ${theme.space.md}`,
          })}
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

export function renderLoading<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert } = context;
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS) ?? "Loading";
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "loading", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    align: "center",
    pad: "sm",
    width: "full",
  });
  return (
    <div
      role="status"
      className={className}
      aria-hidden={inert ? true : undefined}
      aria-live={inert ? undefined : "polite"}
      style={withInert(style, inert)}
    >
      <span
        aria-hidden={true}
        style={rootContainmentStyle({
          display: "inline-block",
          width: theme.space.md,
          height: theme.space.md,
          borderRadius: theme.radius.full,
          background: theme.color["surface-2"],
          flexShrink: 0,
        })}
      />
      <span style={componentTextStyle(theme, recipe, { color: "fg-muted" }, "label")}>{label}</span>
    </div>
  );
}
