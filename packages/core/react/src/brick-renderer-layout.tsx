import type { CSSProperties, ReactNode } from "react";
import {
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TABS_ITEMS,
  type FacetNode,
} from "@facet/core";
import { boxStyle } from "./theme.js";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import {
  MAX_INTRINSIC_ITEMS,
  cappedArray,
  cappedString,
  componentBoxStyle,
  componentRecipe,
  componentTextStyle,
  intrinsicBoxStyle,
  isObjectRecord,
  partBoxStyle,
  safeOwnValue,
  stringValue,
  tableCellText,
  textAlignStyle,
  withInert,
} from "./brick-renderer-shared.js";

export function renderSection<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "section", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "md",
    pad: "md",
    width: "full",
  });
  const eyebrow = cappedString(safeOwnValue(node, "eyebrow"), MAX_NODE_LABEL_CHARS);
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  return (
    <section
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {eyebrow === undefined ? null : (
        <p
          style={componentTextStyle(
            theme,
            recipe,
            { color: "fg-muted", size: "sm", weight: "semibold" },
            "label",
          )}
        >
          {eyebrow}
        </p>
      )}
      {title === undefined ? null : (
        <h2
          style={componentTextStyle(
            theme,
            recipe,
            { color: "fg", size: "xl", weight: "bold" },
            "title",
          )}
        >
          {title}
        </h2>
      )}
      {body === undefined ? null : (
        <p style={componentTextStyle(theme, recipe, { color: "fg" }, "body")}>{body}</p>
      )}
      {context.children}
    </section>
  );
}

export function renderCard<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const recipe = componentRecipe(theme, "card", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "md",
    bg: "surface",
    border: true,
    radius: "md",
  });
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  const press = context.classifyPress(safeOwnValue(node, "onPress"));
  const hold = context.classifyPress(safeOwnValue(node, "onHold"));
  return context.renderPressable({
    press: inert ? null : press,
    hold: inert ? null : hold,
    dispatch: context.dispatch,
    className,
    style,
    inert,
    children: (
      <>
        {title === undefined && body === undefined ? null : (
          <div style={partBoxStyle(theme, recipe, "header", { gap: "xs" })}>
            {title === undefined ? null : (
              <h3
                style={componentTextStyle(
                  theme,
                  recipe,
                  { color: "fg", size: "lg", weight: "bold" },
                  "title",
                )}
              >
                {title}
              </h3>
            )}
            {body === undefined ? null : (
              <p style={componentTextStyle(theme, recipe, { color: "fg" }, "body")}>{body}</p>
            )}
          </div>
        )}
        {context.children}
      </>
    ),
  });
}

export function renderButton<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  if (label === undefined) return null;
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const tone = safeOwnValue(node, "tone");
  const disabled = safeOwnValue(node, "disabled") === true;
  const recipe = componentRecipe(theme, "button", variant, tone);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    align: "center",
    justify: "center",
    gap: "sm",
    pad: "sm",
    bg: "accent",
    radius: "md",
  });
  const press = disabled ? null : context.classifyPress(safeOwnValue(node, "onPress"));
  const hold = disabled ? null : context.classifyPress(safeOwnValue(node, "onHold"));
  return context.renderPressable({
    press: inert ? null : press,
    hold: inert ? null : hold,
    dispatch: context.dispatch,
    className,
    style,
    inert,
    disabled,
    buttonRole: true,
    children: (
      <span
        style={componentTextStyle(
          theme,
          recipe,
          { color: "accent-fg", weight: "semibold" },
          "label",
        )}
      >
        {label}
      </span>
    ),
  });
}

export function renderTabs<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const items = cappedArray(safeOwnValue(node, "items"), MAX_TABS_ITEMS).flatMap((item) => {
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const to = stringValue(safeOwnValue(item, "to"));
    return label !== undefined && to !== undefined ? [{ label, to }] : [];
  });
  if (items.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "tabs", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    wrap: true,
  });
  const tabPart = resolveRecipePart(recipe, "tab", theme);
  const activeTabPart = resolveRecipePart(recipe, "activeTab", theme);
  const tabText = componentTextStyle(theme, recipe, { color: "fg", weight: "semibold" }, "tab");
  const activeTabText: CSSProperties = { ...tabText, ...(activeTabPart.text ?? {}) };
  return (
    <div
      role="tablist"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {items.map((item) => {
        const active = context.activeScreen === item.to;
        return (
          <button
            key={`${item.to}:${item.label}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={inert ? -1 : undefined}
            disabled={inert ? true : undefined}
            onClick={inert ? undefined : () => context.navigate(item.to)}
            style={{
              ...boxStyle({ pad: "sm", radius: "md", border: true }, theme),
              background: "transparent",
              ...(tabPart.box ?? {}),
              ...(active ? (activeTabPart.box ?? {}) : {}),
              ...(active ? activeTabText : tabText),
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function renderNav<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const items = cappedArray(safeOwnValue(node, "items"), MAX_INTRINSIC_ITEMS).flatMap((item) => {
    const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
    const to = stringValue(safeOwnValue(item, "to"));
    return label !== undefined && to !== undefined ? [{ label, to }] : [];
  });
  if (items.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "nav", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    wrap: true,
  });
  const itemPart = resolveRecipePart(recipe, "item", theme);
  const activePart = resolveRecipePart(recipe, "activeTab", theme);
  const itemText = componentTextStyle(theme, recipe, { color: "fg", weight: "semibold" }, "item");
  const activeText: CSSProperties = { ...itemText, ...(activePart.text ?? {}) };
  return (
    <nav
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {items.map((item) => {
        const active = context.activeScreen === item.to;
        return (
          <button
            key={`${item.to}:${item.label}`}
            type="button"
            aria-current={active ? "page" : undefined}
            tabIndex={inert ? -1 : undefined}
            disabled={inert ? true : undefined}
            onClick={inert ? undefined : () => context.navigate(item.to)}
            style={{
              ...rootContainmentStyle({
                background: "transparent",
                border: 0,
                cursor: inert ? undefined : "pointer",
                font: "inherit",
                padding: theme.space.sm,
                borderRadius: theme.radius.md,
              }),
              ...intrinsicBoxStyle(itemPart.box),
              ...(itemPart.text ?? {}),
              ...(active ? intrinsicBoxStyle(activePart.box) : {}),
              ...(active ? activeText : itemText),
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

export function renderTable<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const columns = cappedArray(safeOwnValue(node, "columns"), MAX_TABLE_COLUMNS).flatMap(
    (column) => {
      const key = stringValue(safeOwnValue(column, "key"));
      const label = cappedString(safeOwnValue(column, "label"), MAX_NODE_LABEL_CHARS);
      return key !== undefined && label !== undefined
        ? [{ key, label, align: textAlignStyle(safeOwnValue(column, "align")) }]
        : [];
    },
  );
  if (columns.length === 0) return null;
  const rows = cappedArray(safeOwnValue(node, "rows"), MAX_TABLE_ROWS).filter(isObjectRecord);
  const caption = cappedString(safeOwnValue(node, "caption"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "table", variant);
  const style = componentBoxStyle(theme, recipe, {
    scroll: "x",
    width: "full",
  });
  const tablePart = resolveRecipePart(recipe, "table", theme);
  const captionPart = resolveRecipePart(recipe, "title", theme);
  const headerRowPart = resolveRecipePart(recipe, "headerRow", theme);
  const rowPart = resolveRecipePart(recipe, "row", theme);
  const headerCellPart = resolveRecipePart(recipe, "headerCell", theme);
  const cellPart = resolveRecipePart(recipe, "cell", theme);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      <table
        style={rootContainmentStyle({
          width: "100%",
          borderCollapse: "collapse",
          ...intrinsicBoxStyle(tablePart.box),
          ...(tablePart.text ?? {}),
        })}
      >
        {caption === undefined ? null : <caption style={captionPart.text}>{caption}</caption>}
        <thead>
          <tr style={intrinsicBoxStyle(headerRowPart.box)}>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  borderBottom: `1px solid ${theme.color.border}`,
                  color: theme.color["fg-muted"],
                  ...intrinsicBoxStyle(headerCellPart.box),
                  ...(headerCellPart.text ?? {}),
                  textAlign: column.align,
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(rowIndex)} style={intrinsicBoxStyle(rowPart.box)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    borderBottom: `1px solid ${theme.color.border}`,
                    ...intrinsicBoxStyle(cellPart.box),
                    ...(cellPart.text ?? {}),
                    textAlign: column.align,
                  }}
                >
                  {tableCellText(safeOwnValue(row, column.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
