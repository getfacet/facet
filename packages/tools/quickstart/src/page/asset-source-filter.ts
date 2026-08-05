export type AssetSourceFilter = "all" | "imported" | "default";

export const ASSET_SOURCE_FILTERS: readonly AssetSourceFilter[] = Object.freeze([
  "all",
  "imported",
  "default",
]);

export function assetSourceFilterLabel(filter: AssetSourceFilter): string {
  if (filter === "all") return "All";
  if (filter === "imported") return "Imported";
  return "Default";
}
