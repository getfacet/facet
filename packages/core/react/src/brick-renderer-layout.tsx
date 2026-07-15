import type { CSSProperties, ReactNode } from "react";
import {
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  resolveNodeData,
  type FacetNode,
  type TableRow,
} from "@facet/core";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import { brickBoxStyle, brickRecipe } from "./brick-renderer-recipe.js";
import { applySort } from "./table-sort.js";
import {
  cappedArray,
  cappedString,
  intrinsicBoxStyle,
  isObjectRecord,
  safeOwnValue,
  stringValue,
  tableCellText,
  textAlignStyle,
  withInert,
} from "./brick-renderer-shared.js";

export function renderTable<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const columns = cappedArray(safeOwnValue(node, "columns"), MAX_TABLE_COLUMNS).flatMap(
    (column) => {
      const key = stringValue(safeOwnValue(column, "key"));
      const label = cappedString(safeOwnValue(column, "label"), MAX_NODE_LABEL_CHARS);
      const sortable = safeOwnValue(column, "sortable") === true;
      return key !== undefined && label !== undefined
        ? [{ key, label, align: textAlignStyle(safeOwnValue(column, "align")), sortable }]
        : [];
    },
  );
  if (columns.length === 0) return null;
  // Resolve the effective rows through the ONE core helper: a `from` binding
  // projects the named warehouse dataset (precedence: from wins, dangling ⇒
  // empty table), while an unbound table returns its inline `rows` unchanged.
  // The result still flows through the existing cap/`isObjectRecord` filter — a
  // pure read of (node, ctx.data), no state.
  const resolvedRows: readonly TableRow[] =
    node.type === "table" ? resolveNodeData(node, context.data) : [];
  const rows = cappedArray(resolvedRows, MAX_TABLE_ROWS).filter(isObjectRecord);
  // Local sort is a PURE render-time reorder of the freshly-resolved+capped rows
  // — never cached, so a later server `data` patch re-resolves and re-sorts
  // automatically (two-writers coherence). `applySort` returns the SAME array in
  // natural order for an absent/non-sortable/malformed spec, so an unsorted table
  // is byte-identical to today. `context.sort` is undefined on the inert clone.
  // `applySort` keys off `key`/`sortable`, so pass those (the mapped `align` is a
  // resolved CSS value, not the `TableColumn.align` token).
  const sortedRows = applySort(
    // `rows` is a filtered record array; the cells match `TableRow` and `applySort`
    // is total over any value, so this narrowing assertion is safe.
    rows as readonly TableRow[],
    context.sort,
    columns.map((column) => ({ key: column.key, label: column.label, sortable: column.sortable })),
  );
  const caption = cappedString(safeOwnValue(node, "caption"), MAX_NODE_LABEL_CHARS);
  const variant = safeOwnValue(node, "variant");
  const recipe = brickRecipe(theme, "table", variant);
  const style = brickBoxStyle(theme, recipe, {
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
            {columns.map((column) => {
              const headerStyle: CSSProperties = {
                borderBottom: `1px solid ${theme.color.border}`,
                color: theme.color["fg-muted"],
                ...intrinsicBoxStyle(headerCellPart.box),
                ...(headerCellPart.text ?? {}),
                textAlign: column.align,
              };
              // A non-sortable header stays exactly today's plain cell (DC-006).
              if (!column.sortable) {
                return (
                  <th key={column.key} style={headerStyle}>
                    {column.label}
                  </th>
                );
              }
              // Inline direction glyph — flow text only, never a positioned caret
              // (RISK-INV-5). Shown ONLY when THIS column is the active sort, so an
              // unsorted sortable table keeps byte-identical header text.
              const activeDirection =
                context.sort?.column === column.key ? context.sort.direction : undefined;
              const glyph =
                activeDirection === "asc" ? " ▲" : activeDirection === "desc" ? " ▼" : "";
              return (
                <th
                  key={column.key}
                  aria-sort={
                    activeDirection === "asc"
                      ? "ascending"
                      : activeDirection === "desc"
                        ? "descending"
                        : "none"
                  }
                  onClick={inert ? undefined : () => context.onHeaderSort?.(column.key)}
                  style={{
                    ...headerStyle,
                    cursor: inert ? undefined : "pointer",
                    userSelect: "none",
                  }}
                >
                  {column.label}
                  {glyph}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIndex) => (
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
