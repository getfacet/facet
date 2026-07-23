import type { FacetPattern } from "@facet/core";

/**
 * Structure Patterns that rebuild common app shapes from ONLY the closed box
 * vocabulary — no new node kind, no raw CSS. Between them they exercise every
 * new box layout property: `basis`, `itemWidth`, `maxHeight`, `collapse`, and
 * `columns:"auto"`. Adapt their illustrative copy before authoring.
 */

export const APP_SHELL_PATTERN = {
  name: "app-shell",
  description:
    "A full-height app shell: sticky header, a fixed-width rail, and an internally scrolling main viewport. Adapt its illustrative navigation and content before authoring.",
  useWhen: "Framing a workspace-style tool whose chrome stays put while the main panel scrolls.",
  avoidWhen: "Avoid for a short marketing page or when the whole page should scroll as one flow.",
  root: "app-shell.root",
  nodes: {
    "app-shell.root": {
      id: "app-shell.root",
      type: "box",
      style: { direction: "column", width: "full", maxHeight: "screen" },
      children: ["app-shell.header", "app-shell.body"],
    },
    "app-shell.header": {
      id: "app-shell.header",
      type: "box",
      style: {
        preset: "panel",
        direction: "row",
        alignItems: "center",
        justifyContent: "between",
        width: "full",
        sticky: true,
      },
      children: ["app-shell.brand", "app-shell.header-action"],
    },
    "app-shell.brand": {
      id: "app-shell.brand",
      type: "text",
      value: "Workspace",
      style: { preset: "subheading" },
    },
    "app-shell.header-action": {
      id: "app-shell.header-action",
      type: "box",
      style: { preset: "secondaryAction" },
      children: ["app-shell.header-action-label"],
      onPress: { kind: "agent", name: "open_settings" },
    },
    "app-shell.header-action-label": {
      id: "app-shell.header-action-label",
      type: "text",
      value: "Settings",
      style: { preset: "actionLabel" },
    },
    "app-shell.body": {
      id: "app-shell.body",
      type: "box",
      style: { direction: "row", gap: "md", grow: true, width: "full", collapse: "stack" },
      children: ["app-shell.rail", "app-shell.main"],
    },
    "app-shell.rail": {
      id: "app-shell.rail",
      type: "box",
      style: { preset: "rail", basis: "sm", scroll: "vertical", maxHeight: "screen" },
      children: ["app-shell.rail-overview", "app-shell.rail-reports", "app-shell.rail-settings"],
    },
    "app-shell.rail-overview": {
      id: "app-shell.rail-overview",
      type: "text",
      value: "Overview",
      style: { preset: "body" },
    },
    "app-shell.rail-reports": {
      id: "app-shell.rail-reports",
      type: "text",
      value: "Reports",
      style: { preset: "body" },
    },
    "app-shell.rail-settings": {
      id: "app-shell.rail-settings",
      type: "text",
      value: "Settings",
      style: { preset: "body" },
    },
    "app-shell.main": {
      id: "app-shell.main",
      type: "box",
      style: { grow: true, gap: "md", padding: "lg", scroll: "vertical", maxHeight: "screen" },
      children: ["app-shell.main-title", "app-shell.main-body"],
    },
    "app-shell.main-title": {
      id: "app-shell.main-title",
      type: "text",
      value: "Overview",
      style: { preset: "heading" },
    },
    "app-shell.main-body": {
      id: "app-shell.main-body",
      type: "text",
      value: "Add the primary working content for this screen.",
      style: { preset: "body" },
    },
  },
} satisfies FacetPattern;

export const SPLIT_PANE_PATTERN = {
  name: "split-pane",
  description:
    "A two-pane split: a fixed-width list beside a growing detail pane. Adapt its illustrative records and detail before authoring.",
  useWhen: "Pairing a scannable list with the detail of the selected item, like a messages view.",
  avoidWhen:
    "Avoid when a single column reads more clearly or there is no list-plus-detail pairing.",
  root: "split-pane.root",
  nodes: {
    "split-pane.root": {
      id: "split-pane.root",
      type: "box",
      style: { direction: "row", gap: "md", width: "full", collapse: "stack" },
      children: ["split-pane.list", "split-pane.detail"],
    },
    "split-pane.list": {
      id: "split-pane.list",
      type: "box",
      style: { preset: "panel", basis: "md", gap: "sm", scroll: "vertical", maxHeight: "screen" },
      children: ["split-pane.list-title", "split-pane.list-items"],
    },
    "split-pane.list-title": {
      id: "split-pane.list-title",
      type: "text",
      value: "Conversations",
      style: { preset: "subheading" },
    },
    "split-pane.list-items": {
      id: "split-pane.list-items",
      type: "list",
      items: [
        { title: "Ada Lovelace", body: "Replace with a real conversation preview." },
        { title: "Grace Hopper", body: "Replace with a real conversation preview." },
        { title: "Alan Turing", body: "Replace with a real conversation preview." },
      ],
      style: { preset: "standard" },
    },
    "split-pane.detail": {
      id: "split-pane.detail",
      type: "box",
      style: { grow: true, gap: "md", padding: "md" },
      children: ["split-pane.detail-title", "split-pane.detail-body"],
    },
    "split-pane.detail-title": {
      id: "split-pane.detail-title",
      type: "text",
      value: "Select a conversation",
      style: { preset: "heading" },
    },
    "split-pane.detail-body": {
      id: "split-pane.detail-body",
      type: "text",
      value: "The chosen item's detail renders here. Adapt to the real record.",
      style: { preset: "body" },
    },
  },
} satisfies FacetPattern;

export const PRODUCT_GRID_PATTERN = {
  name: "product-grid",
  description:
    "A responsive product grid that reflows its columns to fit the viewport. Adapt its illustrative items, prices, and action before authoring.",
  useWhen: "Listing a set of comparable products, cards, or tiles that should wrap responsively.",
  avoidWhen: "Avoid for a single record or a fixed small number of peer columns.",
  root: "product-grid.root",
  nodes: {
    "product-grid.root": {
      id: "product-grid.root",
      type: "box",
      style: { columns: "auto", itemWidth: "md", gap: "md", padding: "lg", width: "full" },
      children: [
        "product-grid.item-1",
        "product-grid.item-2",
        "product-grid.item-3",
        "product-grid.item-4",
      ],
    },
    "product-grid.item-1": {
      id: "product-grid.item-1",
      type: "box",
      style: { preset: "panel", gap: "xs" },
      children: ["product-grid.item-1-title", "product-grid.item-1-price"],
    },
    "product-grid.item-1-title": {
      id: "product-grid.item-1-title",
      type: "text",
      value: "Wireless headphones",
      style: { preset: "subheading" },
    },
    "product-grid.item-1-price": {
      id: "product-grid.item-1-price",
      type: "text",
      value: "$129",
      style: { preset: "metric" },
    },
    "product-grid.item-2": {
      id: "product-grid.item-2",
      type: "box",
      style: { preset: "panel", gap: "xs" },
      children: ["product-grid.item-2-title", "product-grid.item-2-price"],
    },
    "product-grid.item-2-title": {
      id: "product-grid.item-2-title",
      type: "text",
      value: "Mechanical keyboard",
      style: { preset: "subheading" },
    },
    "product-grid.item-2-price": {
      id: "product-grid.item-2-price",
      type: "text",
      value: "$89",
      style: { preset: "metric" },
    },
    "product-grid.item-3": {
      id: "product-grid.item-3",
      type: "box",
      style: { preset: "panel", gap: "xs" },
      children: ["product-grid.item-3-title", "product-grid.item-3-price"],
    },
    "product-grid.item-3-title": {
      id: "product-grid.item-3-title",
      type: "text",
      value: "USB-C hub",
      style: { preset: "subheading" },
    },
    "product-grid.item-3-price": {
      id: "product-grid.item-3-price",
      type: "text",
      value: "$45",
      style: { preset: "metric" },
    },
    "product-grid.item-4": {
      id: "product-grid.item-4",
      type: "box",
      style: { preset: "panel", gap: "xs" },
      children: ["product-grid.item-4-title", "product-grid.item-4-price"],
    },
    "product-grid.item-4-title": {
      id: "product-grid.item-4-title",
      type: "text",
      value: "Desk lamp",
      style: { preset: "subheading" },
    },
    "product-grid.item-4-price": {
      id: "product-grid.item-4-price",
      type: "text",
      value: "$39",
      style: { preset: "metric" },
    },
  },
} satisfies FacetPattern;

export const MEDIA_SHELF_PATTERN = {
  name: "media-shelf",
  description:
    "A horizontally scrolling shelf of fixed-width cards. Adapt its illustrative links or media before authoring.",
  useWhen: "Presenting a browsable row of links, media, or tiles that overflows sideways.",
  avoidWhen: "Avoid when every item must be visible at once or vertical stacking reads better.",
  root: "media-shelf.root",
  nodes: {
    "media-shelf.root": {
      id: "media-shelf.root",
      type: "box",
      style: {
        direction: "row",
        wrap: false,
        gap: "md",
        padding: "md",
        width: "full",
        scroll: "horizontal",
      },
      children: [
        "media-shelf.item-1",
        "media-shelf.item-2",
        "media-shelf.item-3",
        "media-shelf.item-4",
      ],
    },
    "media-shelf.item-1": {
      id: "media-shelf.item-1",
      type: "box",
      style: { preset: "panel", basis: "sm", gap: "xs" },
      children: ["media-shelf.item-1-title", "media-shelf.item-1-body"],
    },
    "media-shelf.item-1-title": {
      id: "media-shelf.item-1-title",
      type: "text",
      value: "Latest album",
      style: { preset: "subheading" },
    },
    "media-shelf.item-1-body": {
      id: "media-shelf.item-1-body",
      type: "text",
      value: "Adapt this link's label and destination.",
      style: { preset: "muted" },
    },
    "media-shelf.item-2": {
      id: "media-shelf.item-2",
      type: "box",
      style: { preset: "panel", basis: "sm", gap: "xs" },
      children: ["media-shelf.item-2-title", "media-shelf.item-2-body"],
    },
    "media-shelf.item-2-title": {
      id: "media-shelf.item-2-title",
      type: "text",
      value: "Tour dates",
      style: { preset: "subheading" },
    },
    "media-shelf.item-2-body": {
      id: "media-shelf.item-2-body",
      type: "text",
      value: "Adapt this link's label and destination.",
      style: { preset: "muted" },
    },
    "media-shelf.item-3": {
      id: "media-shelf.item-3",
      type: "box",
      style: { preset: "panel", basis: "sm", gap: "xs" },
      children: ["media-shelf.item-3-title", "media-shelf.item-3-body"],
    },
    "media-shelf.item-3-title": {
      id: "media-shelf.item-3-title",
      type: "text",
      value: "Merch store",
      style: { preset: "subheading" },
    },
    "media-shelf.item-3-body": {
      id: "media-shelf.item-3-body",
      type: "text",
      value: "Adapt this link's label and destination.",
      style: { preset: "muted" },
    },
    "media-shelf.item-4": {
      id: "media-shelf.item-4",
      type: "box",
      style: { preset: "panel", basis: "sm", gap: "xs" },
      children: ["media-shelf.item-4-title", "media-shelf.item-4-body"],
    },
    "media-shelf.item-4-title": {
      id: "media-shelf.item-4-title",
      type: "text",
      value: "Newsletter",
      style: { preset: "subheading" },
    },
    "media-shelf.item-4-body": {
      id: "media-shelf.item-4-body",
      type: "text",
      value: "Adapt this link's label and destination.",
      style: { preset: "muted" },
    },
  },
} satisfies FacetPattern;
