import type { ReactNode } from "react";
import {
  MAX_LIST_ITEMS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  resolveNodeData,
  type FacetNode,
} from "@facet/core";
import {
  keyValueTargetStyles,
  listTargetStyles,
  loadingTargetStyles,
  LOADING_PULSE_CSS,
  progressTargetStyles,
} from "./brick-style-data.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import { resolveBrickStyle } from "./style-resolver.js";
import {
  MAX_INTRINSIC_ITEMS,
  cappedArray,
  cappedString,
  clampProgress,
  safeOwnValue,
  stringValue,
  withInert,
} from "./brick-renderer-shared.js";

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
    return [{ key, label, value }];
  });
  if (items.length === 0) return null;
  const { theme, className, inert } = context;
  const styles = keyValueTargetStyles(
    resolveBrickStyle(theme, "keyValue", safeOwnValue(node, "style")),
    theme,
  );
  return (
    <dl
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert({ ...styles.root, margin: 0 }, inert)}
    >
      {items.map((item) => (
        <div key={item.key} style={styles.item}>
          <dt style={styles.label}>{item.label}</dt>
          <dd style={{ ...styles.value, margin: 0 }}>{item.value}</dd>
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
  const styles = progressTargetStyles(
    resolveBrickStyle(theme, "progress", safeOwnValue(node, "style")),
    theme,
  );
  return (
    <label
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(styles.root, inert)}
    >
      {label === undefined ? null : <span style={styles.label}>{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        style={rootContainmentStyle({
          ...styles.track,
          display: "block",
          width: "100%",
          overflow: "hidden",
        })}
      >
        <div
          style={rootContainmentStyle({
            ...styles.fill,
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
  const styles = listTargetStyles(
    resolveBrickStyle(theme, "list", safeOwnValue(node, "style")),
    theme,
  );
  return (
    <ul
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert({ ...styles.root, margin: 0, listStylePosition: "inside" }, inert)}
    >
      {items.map((item, index) => (
        <li key={`${String(index)}:${item.title}`} style={{ ...styles.item, ...styles.marker }}>
          <span style={styles.title}>{item.title}</span>
          {item.body === undefined ? null : (
            <p style={{ ...styles.body, marginBlockStart: styles.itemGap }}>{item.body}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function renderLoading<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert } = context;
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS) ?? "Loading";
  const styles = loadingTargetStyles(
    resolveBrickStyle(theme, "loading", safeOwnValue(node, "style")),
    theme,
  );
  return (
    <div
      role="status"
      className={className}
      aria-hidden={inert ? true : undefined}
      aria-live={inert ? undefined : "polite"}
      style={withInert(styles.root, inert)}
    >
      {styles.indicatorClassName === undefined ? null : <style>{LOADING_PULSE_CSS}</style>}
      <span
        aria-hidden={true}
        className={styles.indicatorClassName}
        style={rootContainmentStyle(styles.indicator)}
      />
      <span style={styles.label}>{label}</span>
    </div>
  );
}
