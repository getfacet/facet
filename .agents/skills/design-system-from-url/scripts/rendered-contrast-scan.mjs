#!/usr/bin/env node
/* global CSS, NodeFilter, console, document, getComputedStyle, location, process, window */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

const options = {
  assertFile: undefined,
  includeOffscreen: false,
  largeThreshold: 3,
  maxFailures: 50,
  scrollY: undefined,
  threshold: 4.5,
  url: undefined,
  waitMs: 250,
};

let mode = "help";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    mode = "help";
    continue;
  }
  if (arg === "--playwright-code") {
    mode = "playwright-code";
    continue;
  }
  if (arg === "--assert") {
    mode = "assert";
    options.assertFile = requiredValue(args, index, arg);
    index += 1;
    continue;
  }
  if (arg === "--include-offscreen") {
    options.includeOffscreen = true;
    continue;
  }
  if (arg === "--url") {
    options.url = requiredValue(args, index, arg);
    index += 1;
    continue;
  }
  if (arg === "--threshold") {
    options.threshold = positiveNumber(requiredValue(args, index, arg), arg);
    index += 1;
    continue;
  }
  if (arg === "--large-threshold") {
    options.largeThreshold = positiveNumber(requiredValue(args, index, arg), arg);
    index += 1;
    continue;
  }
  if (arg === "--max-failures") {
    options.maxFailures = positiveInteger(requiredValue(args, index, arg), arg);
    index += 1;
    continue;
  }
  if (arg === "--scroll-y") {
    options.scrollY = nonNegativeNumber(requiredValue(args, index, arg), arg);
    index += 1;
    continue;
  }
  if (arg === "--wait-ms") {
    options.waitMs = nonNegativeNumber(requiredValue(args, index, arg), arg);
    index += 1;
    continue;
  }
  fail(`Unknown option: ${arg}`);
}

if (mode === "help") {
  console.log(`Usage:
  node rendered-contrast-scan.mjs --playwright-code [options]
  node rendered-contrast-scan.mjs --assert <scan.json>

Options:
  --url <url>              Navigate before scanning. Omit to scan the current page.
  --scroll-y <px>          Scroll before scanning.
  --wait-ms <ms>           Wait after navigation or scroll. Default: 250.
  --threshold <ratio>      Normal text contrast threshold. Default: 4.5.
  --large-threshold <n>    Large text contrast threshold. Default: 3.
  --max-failures <n>       Maximum failure records to include. Default: 50.
  --include-offscreen      Scan text outside the current viewport.

Run with the Playwright CLI skill:
  PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
  "$PWCLI" --raw run-code "$(node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --playwright-code --url http://localhost:5292)" > output/playwright/design-import/site/contrast.json
  node .agents/skills/design-system-from-url/scripts/rendered-contrast-scan.mjs --assert output/playwright/design-import/site/contrast.json`);
  process.exit(0);
}

if (mode === "assert") {
  assertScanResult(options.assertFile);
  process.exit(0);
}

console.log(generatePlaywrightCode(options));

function generatePlaywrightCode(scanOptions) {
  const serialized = JSON.stringify(scanOptions);
  const browserScanner = renderedContrastScan.toString();
  return `async page => {
  const scanOptions = ${serialized};
  if (scanOptions.url !== undefined) {
    await page.goto(scanOptions.url, { waitUntil: "networkidle" });
  }
  if (scanOptions.scrollY !== undefined) {
    await page.evaluate(y => window.scrollTo(0, y), scanOptions.scrollY);
  }
  if (scanOptions.waitMs > 0) {
    await page.waitForTimeout(scanOptions.waitMs);
  }
  const result = await page.evaluate(${browserScanner}, scanOptions);
  return result;
}`;
}

function assertScanResult(file) {
  if (file === undefined) fail("Missing scan JSON path for --assert");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      `Could not read scan JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isScanResult(parsed)) fail(`Invalid scan JSON at ${file}`);
  if (parsed.failureCount > 0) {
    console.error(
      `FAIL rendered contrast scan: ${parsed.failureCount} text nodes below threshold in ${file}`,
    );
    for (const failure of parsed.failures.slice(0, 10)) {
      console.error(
        `- ${failure.contrast}:1 < ${failure.threshold}: "${failure.sample}" at ${failure.selector} color=${failure.color} bg=${failure.background}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `PASS rendered contrast scan: ${parsed.checkedTextNodes} text nodes checked in ${file}`,
  );
}

function isScanResult(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.checkedTextNodes === "number" &&
    typeof value.failureCount === "number" &&
    Array.isArray(value.failures)
  );
}

function requiredValue(values, index, name) {
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`Missing value for ${name}`);
  return value;
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`Invalid ${name}: ${value}`);
  return parsed;
}

function nonNegativeNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`Invalid ${name}: ${value}`);
  return parsed;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`Invalid ${name}: ${value}`);
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function renderedContrastScan(rawOptions) {
  const options = {
    includeOffscreen: rawOptions.includeOffscreen === true,
    largeThreshold:
      typeof rawOptions.largeThreshold === "number" && rawOptions.largeThreshold > 0
        ? rawOptions.largeThreshold
        : 3,
    maxFailures:
      Number.isInteger(rawOptions.maxFailures) && rawOptions.maxFailures > 0
        ? rawOptions.maxFailures
        : 50,
    threshold:
      typeof rawOptions.threshold === "number" && rawOptions.threshold > 0
        ? rawOptions.threshold
        : 4.5,
  };
  const skipped = {
    empty: 0,
    hidden: 0,
    offscreen: 0,
    unsupportedColor: 0,
  };
  const failures = [];
  const worst = [];
  let checkedTextNodes = 0;
  let failureCount = 0;
  const ignoredTags = new Set([
    "CANVAS",
    "HEAD",
    "IFRAME",
    "NOSCRIPT",
    "SCRIPT",
    "STYLE",
    "SVG",
    "TEMPLATE",
  ]);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalizeText(node.textContent || "");
      if (text.length === 0) {
        skipped.empty += 1;
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (parent === null || ignoredTags.has(parent.tagName) || hasIgnoredAncestor(parent)) {
        skipped.hidden += 1;
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || isHidden(parent)) {
      skipped.hidden += 1;
      continue;
    }
    const rect = firstVisibleTextRect(node, options.includeOffscreen);
    if (rect === undefined) {
      skipped.offscreen += 1;
      continue;
    }
    const style = getComputedStyle(parent);
    const foreground = parseCssColor(style.color);
    const background = effectiveBackground(parent);
    if (foreground === undefined || background === undefined) {
      skipped.unsupportedColor += 1;
      continue;
    }

    const effectiveForeground = foreground.a < 1 ? composite(foreground, background) : foreground;
    const ratio = contrastRatio(effectiveForeground, background);
    const fontSizePx = Number.parseFloat(style.fontSize) || 0;
    const fontWeight = parseFontWeight(style.fontWeight);
    const largeText = isLargeText(fontSizePx, fontWeight);
    const threshold = largeText ? options.largeThreshold : options.threshold;
    const record = {
      background: colorToHex(background),
      color: colorToHex(effectiveForeground),
      contrast: Number(ratio.toFixed(2)),
      fontSizePx: Number(fontSizePx.toFixed(2)),
      fontWeight,
      largeText,
      rect,
      sample: normalizeText(node.textContent || "").slice(0, 120),
      selector: selectorFor(parent),
      tag: parent.tagName.toLowerCase(),
      threshold,
    };
    checkedTextNodes += 1;
    pushWorst(worst, record);
    if (ratio < threshold) {
      failureCount += 1;
      if (failures.length < options.maxFailures) failures.push(record);
    }
  }

  return {
    checkedTextNodes,
    failureCount,
    failures,
    ok: failureCount === 0,
    skipped,
    url: location.href,
    viewport: {
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
    },
    worst,
  };

  function hasIgnoredAncestor(element) {
    for (let current = element; current !== null; current = current.parentElement) {
      if (ignoredTags.has(current.tagName)) return true;
      if (current.getAttribute("aria-hidden") === "true") return true;
      if (current.hidden === true) return true;
    }
    return false;
  }

  function isHidden(element) {
    for (let current = element; current !== null; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none") return true;
      if (style.visibility === "hidden" || style.visibility === "collapse") return true;
      if (Number.parseFloat(style.opacity) === 0) return true;
      if (current.getAttribute("aria-hidden") === "true") return true;
      if (current.hidden === true) return true;
    }
    return false;
  }

  function firstVisibleTextRect(textNode, includeOffscreen) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects());
    range.detach();
    for (const candidate of rects) {
      if (candidate.width < 1 || candidate.height < 1) continue;
      if (!includeOffscreen && !intersectsViewport(candidate)) continue;
      return {
        bottom: Math.round(candidate.bottom),
        height: Math.round(candidate.height),
        left: Math.round(candidate.left),
        right: Math.round(candidate.right),
        top: Math.round(candidate.top),
        width: Math.round(candidate.width),
      };
    }
    return undefined;
  }

  function intersectsViewport(rect) {
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function effectiveBackground(element) {
    const chain = [];
    for (let current = element; current !== null; current = current.parentElement) {
      chain.unshift(current);
    }
    let color = { a: 1, b: 255, g: 255, r: 255 };
    for (const item of chain) {
      const parsed = parseCssColor(getComputedStyle(item).backgroundColor);
      if (parsed !== undefined && parsed.a > 0) {
        color = composite(parsed, color);
      }
    }
    return color;
  }

  function parseCssColor(value) {
    const text = value.trim().toLowerCase();
    if (text === "transparent") return { a: 0, b: 0, g: 0, r: 0 };
    const rgb = /^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+))?\s*\)$/u.exec(
      text,
    );
    if (rgb !== null) {
      return {
        a: rgb[4] === undefined ? 1 : clamp01(Number(rgb[4])),
        b: clampChannel(Number(rgb[3])),
        g: clampChannel(Number(rgb[2])),
        r: clampChannel(Number(rgb[1])),
      };
    }
    const modernRgb =
      /^rgba?\(\s*([.\d]+)\s+([.\d]+)\s+([.\d]+)(?:\s*\/\s*([.\d]+%?))?\s*\)$/u.exec(text);
    if (modernRgb !== null) {
      return {
        a: modernRgb[4] === undefined ? 1 : parseAlpha(modernRgb[4]),
        b: clampChannel(Number(modernRgb[3])),
        g: clampChannel(Number(modernRgb[2])),
        r: clampChannel(Number(modernRgb[1])),
      };
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(text);
    if (hex !== null) {
      const body =
        hex[1].length === 3
          ? hex[1]
              .split("")
              .map((char) => `${char}${char}`)
              .join("")
          : hex[1];
      return {
        a: 1,
        b: Number.parseInt(body.slice(4, 6), 16),
        g: Number.parseInt(body.slice(2, 4), 16),
        r: Number.parseInt(body.slice(0, 2), 16),
      };
    }
    return undefined;
  }

  function parseAlpha(value) {
    if (value.endsWith("%")) return clamp01(Number(value.slice(0, -1)) / 100);
    return clamp01(Number(value));
  }

  function composite(top, bottom) {
    const alpha = top.a + bottom.a * (1 - top.a);
    if (alpha <= 0) return { a: 0, b: 0, g: 0, r: 0 };
    return {
      a: alpha,
      b: Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha),
      g: Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha),
      r: Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha),
    };
  }

  function contrastRatio(foreground, background) {
    const fg = relativeLuminance(foreground);
    const bg = relativeLuminance(background);
    const lighter = Math.max(fg, bg);
    const darker = Math.min(fg, bg);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function relativeLuminance(color) {
    const r = channelLuminance(color.r);
    const g = channelLuminance(color.g);
    const b = channelLuminance(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function channelLuminance(value) {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }

  function isLargeText(fontSizePx, fontWeight) {
    return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  }

  function parseFontWeight(value) {
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric)) return numeric;
    if (value === "bold" || value === "bolder") return 700;
    return 400;
  }

  function pushWorst(items, record) {
    items.push(record);
    items.sort((left, right) => left.contrast - right.contrast);
    if (items.length > 10) items.pop();
  }

  function selectorFor(element) {
    const parts = [];
    for (
      let current = element;
      current !== null && current !== document.body;
      current = current.parentElement
    ) {
      if (current.id) {
        parts.unshift(`#${escapeSelector(current.id)}`);
        break;
      }
      const component = current.getAttribute("data-facet-component");
      if (component !== null && component !== "") {
        parts.unshift(`${current.tagName.toLowerCase()}[data-facet-component="${component}"]`);
        continue;
      }
      parts.unshift(nthSelector(current));
      if (parts.length >= 6) break;
    }
    return parts.join(" > ");
  }

  function nthSelector(element) {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (parent === null) return tag;
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === element.tagName,
    );
    if (siblings.length <= 1) return tag;
    return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
  }

  function escapeSelector(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&");
  }

  function colorToHex(color) {
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  }

  function toHex(value) {
    return clampChannel(value).toString(16).padStart(2, "0");
  }

  function clampChannel(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value));
  }

  function normalizeText(value) {
    return value.replace(/\s+/gu, " ").trim();
  }
}
