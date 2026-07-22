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
  tableStickyHeaderCellStyle,
  tableTextContentTargetStyle,
} from "./brick-style-layout.js";
import { rootContainmentStyle, tableScrollContainmentStyle } from "./layout-contract.js";
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

/**
 * Renderer-owned mapping from the closed `COLUMN_WIDTHS` names to a concrete CSS
 * width guide on the `<th>`. Values are framework constants — the author never
 * supplies a number/px. `auto`/absent AND any unknown/stale value (the validator
 * drops it; this read must still narrow safely) → today's behavior (no width).
 */
function columnWidthValue(raw: unknown): string | undefined {
  switch (raw) {
    case "narrow":
      return "8rem";
    case "medium":
      return "14rem";
    case "wide":
      return "24rem";
    default:
      return undefined;
  }
}

export function renderTable<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const columns = cappedArray(safeOwnValue(node, "columns"), MAX_TABLE_COLUMNS).flatMap(
    (column) => {
      const key = stringValue(safeOwnValue(column, "key"));
      const label = cappedString(safeOwnValue(column, "label"), MAX_NODE_LABEL_CHARS);
      const sortable = safeOwnValue(column, "sortable") === true;
      return key !== undefined && label !== undefined
        ? [
            {
              key,
              label,
              align: textAlignStyle(safeOwnValue(column, "align")),
              width: columnWidthValue(safeOwnValue(column, "width")),
              sortable,
            },
          ]
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
  // Authored empty-state label (bounded by the validator) with a stale-data cap
  // and the built-in fallback (DC-004).
  // A blank authored label is not a label: an empty string is a valid bounded
  // string, so `??` never fired and the cell rendered as an unexplained blank
  // row. Cap first (the stale-data bound), then treat blank as absent.
  const authoredEmptyLabel = cappedString(safeOwnValue(node, "emptyLabel"), MAX_NODE_LABEL_CHARS);
  const emptyLabel =
    authoredEmptyLabel !== undefined && authoredEmptyLabel.trim().length > 0
      ? authoredEmptyLabel
      : "No rows";
  const resolvedStyle = resolveBrickStyle(theme, "table", safeOwnValue(node, "style"));
  // `resolveBrickStyle` copies only contract-valid values, so these closed style
  // props arrive already sanitized (RISK-INV-3) — no raw node access.
  const dividers = resolvedStyle.dividers;
  const stickyHeader = resolvedStyle.stickyHeader === true;
  // When the header pins, every `<thead>` cell gets a renderer-owned sticky style
  // (container-relative, opaque background); otherwise it stays a plain flow cell.
  const stickyHeaderCellStyle = stickyHeader
    ? tableStickyHeaderCellStyle(resolvedStyle, resolvedStyle.header ?? {}, theme)
    : undefined;
  const style = tableRootTargetStyle(resolvedStyle, theme);
  const captionStyle = tableCaptionTargetStyle(resolvedStyle.caption ?? {}, theme);
  const cellStyle = tableCellTargetStyle(resolvedStyle.cell ?? {}, theme, dividers);
  const cellContentStyle = tableTextContentTargetStyle(resolvedStyle.cell ?? {}, theme);
  const emptyCellStyle = tableEmptyCellTargetStyle(resolvedStyle.cell ?? {}, theme, dividers);
  return (
    <div
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {/* The renderer-owned containment wrapper: a wide table scrolls inside its
          OWN bounds (never pushing parent/page width), and a sticky header pins
          against this wrapper's bounded vertical scroll region (RISK-INV-1). */}
      <div style={tableScrollContainmentStyle(stickyHeader)}>
        {/* No minWidth:max-content here: cells default to whiteSpace:nowrap, so
            a dense table still grows past the wrapper into its own horizontal
            scroll, while an authored textWrap:"wrap" cell can actually wrap and
            its lineClamp span can clamp (the 636caa9 span split stays). */}
        <table
          style={rootContainmentStyle({
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "auto",
          })}
        >
          {caption === undefined ? null : (
            <caption style={captionStyle}>
              <span
                data-facet-table-caption-content="true"
                style={tableTextContentTargetStyle(resolvedStyle.caption ?? {}, theme)}
              >
                {caption}
              </span>
            </caption>
          )}
          <thead>
            <tr>
              {columns.map((column) => {
                const activeDirection =
                  context.sort?.column === column.key ? context.sort.direction : undefined;
                const headerTarget = tableHeaderTargetStyle(
                  resolvedStyle.header ?? {},
                  theme,
                  activeDirection !== undefined,
                  dividers,
                );
                const headerContentStyle = tableTextContentTargetStyle(
                  resolvedStyle.header ?? {},
                  theme,
                );
                const headerStyle: CSSProperties = {
                  // Sticky first: it contributes position/top/z plus an OPAQUE
                  // background fallback, but a resolved header paint (including
                  // the sorted-column tint) must still win over that fallback.
                  ...(stickyHeaderCellStyle ?? {}),
                  ...headerTarget.style,
                  ...(column.align === undefined ? {} : { textAlign: column.align }),
                  ...(column.width === undefined ? {} : { width: column.width }),
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
                  {emptyLabel}
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
    </div>
  );
}
