import type { CatalogUsageOrder } from "./catalog-types.js";

/** Single internal source for the closed catalog authoring order. */
export const CANONICAL_CATALOG_USAGE_ORDER = [
  "composition",
  "component",
  "primitive",
] as const satisfies CatalogUsageOrder;
