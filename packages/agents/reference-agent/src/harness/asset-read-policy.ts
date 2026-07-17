export const EXACT_ASSET_READ_TOOL_NAMES = [
  "get_pattern",
  "get_preset",
  "get_brick_spec",
  "get_style_choices",
] as const;

const EXACT_ASSET_READ_TOOL_SET = new Set<string>(EXACT_ASSET_READ_TOOL_NAMES);

export function isExactAssetReadToolName(name: string): boolean {
  return EXACT_ASSET_READ_TOOL_SET.has(name);
}
