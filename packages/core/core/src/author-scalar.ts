/**
 * Authored scalar coercion shared by validation and render-time binding.
 * Numeric props intentionally accept one decimal spelling per value: no
 * exponent, no leading `+`, no leading-zero run, and no hexadecimal form.
 */
const AUTHORED_NUMBER_LITERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export function isAuthoredNumberLiteral(text: string): boolean {
  return AUTHORED_NUMBER_LITERAL.test(text);
}

export function parseAuthoredNumber(text: string): number | null {
  if (!isAuthoredNumberLiteral(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  const rendered = decimalNumberString(value);
  return rendered === canonicalNumberLiteral(text) ? value : null;
}

function canonicalNumberLiteral(text: string): string {
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf(".");
  const integer = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? "" : unsigned.slice(dot + 1).replace(/0+$/u, "");
  const body = fraction.length === 0 ? integer : `${integer}.${fraction}`;
  if (body === "0") return negative ? "-0" : "0";
  return negative ? `-${body}` : body;
}

function decimalNumberString(value: number): string {
  if (Object.is(value, -0)) return "-0";
  const text = String(value);
  if (!/[eE]/u.test(text)) return text;
  const match = /^(-?)([0-9])(?:\.([0-9]+))?e([+-]?[0-9]+)$/u.exec(text);
  if (match === null) return text;
  const sign = match[1] ?? "";
  const head = match[2] ?? "";
  const tail = match[3] ?? "";
  const exponent = Number(match[4]);
  const digits = `${head}${tail}`;
  const decimalIndex = 1 + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
