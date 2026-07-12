import type { ReactNode } from "react";
import type { FacetNode } from "@facet/core";
import { renderChart } from "./brick-renderer-chart.js";
import {
  renderAlert,
  renderBadge,
  renderDivider,
  renderEmptyState,
  renderKeyValue,
  renderList,
  renderLoading,
  renderMetric,
  renderProgress,
  renderStat,
} from "./brick-renderer-data.js";
import {
  renderButton,
  renderCard,
  renderNav,
  renderSection,
  renderTable,
  renderTabs,
} from "./brick-renderer-layout.js";
import { renderField, renderFilterBar, renderForm, renderSearch } from "./brick-renderer-inputs.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";

export type { BrickRenderContext, PressableRenderArgs } from "./brick-renderer-types.js";

export function renderBrickNode<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  switch (node.type) {
    case "section":
      return renderSection(node, context);
    case "card":
      return renderCard(node, context);
    case "button":
      return renderButton(node, context);
    case "tabs":
      return renderTabs(node, context);
    case "nav":
      return renderNav(node, context);
    case "table":
      return renderTable(node, context);
    case "chart":
      return renderChart(node, context);
    case "metric":
      return renderMetric(node, context);
    case "stat":
      return renderStat(node, context);
    case "keyValue":
      return renderKeyValue(node, context);
    case "badge":
      return renderBadge(node, context);
    case "progress":
      return renderProgress(node, context);
    case "alert":
      return renderAlert(node, context);
    case "list":
      return renderList(node, context);
    case "divider":
      return renderDivider(node, context);
    case "form":
      return renderForm(node, context);
    case "search":
      return renderSearch(node, context);
    case "filterBar":
      return renderFilterBar(node, context);
    case "emptyState":
      return renderEmptyState(node, context);
    case "loading":
      return renderLoading(node, context);
    case "field":
      return renderField(node, context);
    default:
      return null;
  }
}
