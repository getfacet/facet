#!/usr/bin/env node
/* global console, process */

const args = process.argv.slice(2);

let threshold = 4.5;
const pairs = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--threshold") {
    const raw = args[index + 1];
    if (raw === undefined) fail("Missing value for --threshold");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) fail(`Invalid threshold: ${raw}`);
    threshold = parsed;
    index += 1;
    continue;
  }
  if (arg === "--large") {
    threshold = 3;
    continue;
  }
  pairs.push(parsePair(arg));
}

if (pairs.length === 0) {
  fail('Usage: contrast-check.mjs [--threshold 4.5|--large] "label:#background:#text" ...');
}

let failed = false;
for (const pair of pairs) {
  const ratio = contrastRatio(pair.background, pair.foreground);
  const ok = ratio >= threshold;
  failed = failed || !ok;
  const verdict = ok ? "PASS" : "FAIL";
  console.log(
    `${verdict} ${pair.label} ${ratio.toFixed(2)}:1 bg=${pair.background} text=${pair.foreground} threshold=${threshold}`,
  );
}

if (failed) process.exit(1);

function parsePair(raw) {
  const parts = raw.split(":");
  if (parts.length !== 3) {
    fail(`Expected label:#background:#text, got: ${raw}`);
  }
  const [label, background, foreground] = parts;
  if (!label) fail(`Missing label in: ${raw}`);
  return {
    label,
    background: parseHex(background, raw),
    foreground: parseHex(foreground, raw),
  };
}

function parseHex(value, source) {
  if (value === undefined) fail(`Missing color in: ${source}`);
  const normalized = value.trim().toLowerCase();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(normalized);
  if (match === null) fail(`Expected #rgb or #rrggbb in: ${source}`);
  const body = match[1];
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  return `#${body}`;
}

function contrastRatio(background, foreground) {
  const bg = relativeLuminance(background);
  const fg = relativeLuminance(foreground);
  const lighter = Math.max(bg, fg);
  const darker = Math.min(bg, fg);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
