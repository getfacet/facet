export const THEME_UNSIGNED_DECIMAL_SOURCE = String.raw`(?:0|[1-9]\d*)(?:\.\d{1,4})?`;
export const THEME_SIGNED_DECIMAL_SOURCE = String.raw`-?${THEME_UNSIGNED_DECIMAL_SOURCE}`;

const UNSIGNED_DECIMAL_RE = new RegExp(`^${THEME_UNSIGNED_DECIMAL_SOURCE}$`);
const SIGNED_DECIMAL_RE = new RegExp(`^${THEME_SIGNED_DECIMAL_SOURCE}$`);

export function parseThemeDecimal(raw: string, signed = false): number | undefined {
  if (!(signed ? SIGNED_DECIMAL_RE : UNSIGNED_DECIMAL_RE).test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
