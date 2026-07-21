import type { CSSProperties, ReactNode } from "react";
import {
  MAX_NODE_LABEL_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  resolveNodeData,
  type FacetNode,
  type TableRow,
} from "@facet/core";
import {
  tableCaptionTargetStyle,
  tableCellTargetStyle,
  tableEmptyCellTargetStyle,
  tableHeaderTargetStyle,
  tableRootTargetStyle,
  tableRowTargetStyle,
  tableTextContentTargetStyle,
} from "./brick-style-layout.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import { resolveBrickStyle } from "./style-resolver.js";
import { applySort } from "./table-sort.js";
import {
  cappedArray,
  cappedString,
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
  const resolvedStyle = resolveBrickStyle(theme, "table", safeOwnValue(node, "style"));
  const style = tableRootTargetStyle(resolvedStyle, theme);
  const captionStyle = tableCaptionTargetStyle(resolvedStyle.caption ?? {}, theme);
  const cellStyle = tableCellTargetStyle(resolvedStyle.cell ?? {}, theme);
  const cellContentStyle = tableTextContentTargetStyle(resolvedStyle.cell ?? {}, theme);
  const emptyCellStyle = tableEmptyCellTargetStyle(resolvedStyle.cell ?? {}, theme);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      <table
        style={rootContainmentStyle({
          width: "100%",
          minWidth: "max-content",
          borderCollapse: "separate",
          borderSpacing: 0,
          tableLayout: "auto",
        })}
      >
        {caption === undefined ? null : <caption style={captionStyle}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const activeDirection =
                context.sort?.column === column.key ? context.sort.direction : undefined;
              const headerTarget = tableHeaderTargetStyle(
                resolvedStyle.header ?? {},
                theme,
                activeDirection !== undefined,
              );
              const headerContentStyle = tableTextContentTargetStyle(
                resolvedStyle.header ?? {},
                theme,
              );
              const headerStyle: CSSProperties = {
                ...headerTarget.style,
                ...(column.align === undefined ? {} : { textAlign: column.align }),
              };
              // A non-sortable header stays exactly today's plain cell (DC-006).
              if (!column.sortable) {
                return (
                  <th key={column.key} className={headerTarget.className} style={headerStyle}>
                    <span data-facet-table-header-content="true" style={headerContentStyle}>
                      {column.label}
                    </span>
                  </th>
                );
              }
              // Inline direction glyph — flow text only, never a positioned caret
              // (RISK-INV-5). Shown ONLY when THIS column is the active sort, so an
              // unsorted sortable table keeps byte-identical header text.
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
                  className={headerTarget.className}
                  style={{
                    ...headerStyle,
                    cursor: inert ? undefined : "pointer",
                    userSelect: "none",
                  }}
                >
                  <span data-facet-table-header-content="true" style={headerContentStyle}>
                    {column.label}
                    {glyph}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={emptyCellStyle}>
                No rows
              </td>
            </tr>
          ) : null}
          {sortedRows.map((row, rowIndex) => {
            const rowTarget = tableRowTargetStyle(
              resolvedStyle.row ?? {},
              theme,
              rowIndex % 2 === 1,
            );
            return (
              <tr key={String(rowIndex)} className={rowTarget.className} style={rowTarget.style}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={{
                      ...cellStyle,
                      ...(column.align === undefined ? {} : { textAlign: column.align }),
                    }}
                  >
                    <span data-facet-table-cell-content="true" style={cellContentStyle}>
                      {tableCellText(safeOwnValue(row, column.key))}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
