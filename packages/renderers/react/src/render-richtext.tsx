import type { CSSProperties, ReactNode } from "react";
import {
  BLOCK_TYPES,
  MAX_NODE_BODY_CHARS,
  isSafeHref,
  type NodeId,
  type RichTextNode,
} from "@facet/core";
import {
  resolveRichTextStylePresentation,
  type RichTextStylePresentation,
} from "./brick-style-input.js";
import { classifyPress, type ClassifiedPress } from "./renderer-press.js";
import { cappedString, isObjectRecord, safeOwnValue } from "./renderer-safe.js";
import { headingTag, listIndentCss, type ResolvedTheme } from "./theme.js";

/**
 * What `renderer-render.tsx` threads into the bespoke richtext path — the same
 * ingredients the `case "text"` path holds: the resolved theme, the motion class,
 * the inert flag (previous-screen clone / exit record), this node's id, and the
 * SINGLE press writer (`dispatch = (classified) => onPress(classified, id)`).
 * There is NO second local writer here (RISK-INV-2).
 */
export interface RichTextRenderContext {
  readonly theme: ResolvedTheme;
  readonly className?: string | undefined;
  readonly inert: boolean;
  readonly nodeId: NodeId;
  readonly dispatch: (press: ClassifiedPress) => void;
}

interface ResolvedRichTextRenderContext extends RichTextRenderContext {
  readonly presentation: RichTextStylePresentation;
}

/** Read a run's ordered mark-kind names (strings only) off a raw-path run object. */
function markKindsOf(marks: unknown): string[] {
  if (!Array.isArray(marks)) return [];
  const kinds: string[] = [];
  for (const mark of marks) {
    if (isObjectRecord(mark) && typeof mark.kind === "string") kinds.push(mark.kind);
  }
  return kinds;
}

/** The first `link` mark's target (or undefined) — the run's link destination. */
function linkTargetOf(marks: unknown): unknown {
  if (!Array.isArray(marks)) return undefined;
  for (const mark of marks) {
    if (isObjectRecord(mark) && mark.kind === "link") return mark.target;
  }
  return undefined;
}

/**
 * Render one run to inline content. A run with missing/non-string text is skipped
 * (returns null). Marks apply the theme-owned look; a `link` mark makes the run an
 * INTERNAL press (dispatched through the single writer) or a re-gated EXTERNAL
 * anchor. On the inert path every link degrades to plain styled text (no click, no
 * navigation). Never throws on any shape.
 */
function semanticRunStyle(
  kinds: readonly string[],
  context: ResolvedRichTextRenderContext,
): CSSProperties {
  const css: CSSProperties = {};
  const decorations: string[] = [];
  for (const kind of kinds) {
    if (kind === "bold") css.fontWeight = context.theme.fontWeight.bold;
    else if (kind === "italic") css.fontStyle = "italic";
    else if (kind === "underline") decorations.push("underline");
    else if (kind === "strike") decorations.push("line-through");
  }
  if (kinds.includes("code")) Object.assign(css, context.presentation.code);
  if (kinds.includes("link")) Object.assign(css, context.presentation.link.style);
  if (decorations.length > 0) css.textDecorationLine = [...new Set(decorations)].join(" ");
  return css;
}

function renderRun(run: unknown, key: string, context: ResolvedRichTextRenderContext): ReactNode {
  if (!isObjectRecord(run)) return null;
  const text = cappedString(run.text, MAX_NODE_BODY_CHARS);
  if (text === undefined) return null;

  const kinds = markKindsOf(run.marks);
  const look = semanticRunStyle(kinds, context);
  const hasLink = kinds.includes("link");
  const linkClassName = context.presentation.link.className;

  if (hasLink && !context.inert) {
    const target = linkTargetOf(run.marks);
    // External URL: a `{ href }` object, RE-GATED here client-side (RISK-INV-1) —
    // the renderer never trusts the sanitized value blindly. A plain browser
    // anchor: default navigation, `rel="noopener noreferrer"`, no `window.open`,
    // no fetch.
    if (isObjectRecord(target) && typeof target.href === "string") {
      if (isSafeHref(target.href)) {
        return (
          <a
            key={key}
            href={target.href}
            rel="noopener noreferrer"
            className={linkClassName}
            style={look}
          >
            {text}
          </a>
        );
      }
      // Unsafe href → drop to plain styled text (text kept, link inert).
      return (
        <span key={key} style={look}>
          {text}
        </span>
      );
    }
    // Internal target: classify through the SAME classifier box uses, then dispatch
    // via the single `onPress` writer. An unclassifiable target degrades to plain
    // text. No href → this is not browser navigation.
    const classified = classifyPress(target);
    if (classified !== null) {
      const onActivate = (): void => context.dispatch(classified);
      return (
        <a
          key={key}
          role="link"
          tabIndex={0}
          className={linkClassName}
          style={{ ...look, cursor: "pointer" }}
          onClick={onActivate}
          onKeyDown={(event): void => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate();
            }
          }}
        >
          {text}
        </a>
      );
    }
    return (
      <span key={key} style={look}>
        {text}
      </span>
    );
  }

  // Non-link (or inert) run: a styled span when any mark applied a look, else the
  // bare string (keeps the DOM minimal and byte-lean).
  if (Object.keys(look).length === 0) return text;
  return (
    <span key={key} style={look}>
      {text}
    </span>
  );
}

/** Render one block's runs; a block with zero valid runs yields null (dropped). */
function renderRunsOf(
  runs: unknown,
  blockKey: string,
  context: ResolvedRichTextRenderContext,
): ReactNode[] {
  if (!Array.isArray(runs)) return [];
  const out: ReactNode[] = [];
  for (const [index, run] of runs.entries()) {
    const rendered = renderRun(run, `${blockKey}:r${String(index)}`, context);
    if (rendered !== null) out.push(rendered);
  }
  return out;
}

const BLOCK_BASE: CSSProperties = { margin: 0 };

/**
 * Render one block to a flow element: paragraph→`<p>`, heading→`<h1..3>` (clamped
 * level), listItem→a bullet row with renderer-owned FLOW indent by depth, quote→
 * `<blockquote>`. An unknown `type` degrades to a paragraph (text kept). Returns
 * null when the block has no valid runs. Never throws.
 */
function renderBlock(
  block: unknown,
  key: string,
  context: ResolvedRichTextRenderContext,
): ReactNode {
  if (!isObjectRecord(block)) return null;
  const rawType = block.type;
  const type =
    typeof rawType === "string" && (BLOCK_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : "paragraph";
  const children = renderRunsOf(block.runs, key, context);
  if (children.length === 0) return null;

  if (type === "heading") {
    const level = typeof block.level === "number" ? block.level : 1;
    const Tag = headingTag(level);
    const headingStyle =
      Tag === "h1"
        ? context.presentation.heading1
        : Tag === "h2"
          ? context.presentation.heading2
          : context.presentation.heading3;
    return (
      <Tag key={key} style={{ ...BLOCK_BASE, ...headingStyle }}>
        {children}
      </Tag>
    );
  }
  if (type === "quote") {
    return (
      <blockquote key={key} style={{ ...BLOCK_BASE, ...context.presentation.quote }}>
        {children}
      </blockquote>
    );
  }
  if (type === "listItem") {
    const depth = typeof block.depth === "number" ? block.depth : 0;
    return (
      <div
        key={key}
        data-facet-list-item=""
        style={{
          ...BLOCK_BASE,
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          columnGap: context.theme.space.sm,
          alignItems: "start",
          ...listIndentCss(depth, context.theme),
        }}
      >
        <span
          aria-hidden={true}
          style={{
            ...context.presentation.listMarker,
            lineHeight: context.presentation.root.lineHeight,
          }}
        >
          {"•"}
        </span>
        <span data-facet-list-body="" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {children}
        </span>
      </div>
    );
  }
  return (
    <p key={key} style={BLOCK_BASE}>
      {children}
    </p>
  );
}

/**
 * The bespoke richtext render path (RISK-API-3): flow the blocks vertically, flow
 * the runs inline within each, apply theme-owned mark looks, dispatch internal
 * links through the single press writer, and re-gate external hrefs. FAIL-SAFE:
 * a non-array `blocks`, a malformed block/run, or an unknown mark/block degrades
 * (text kept where possible) and NEVER throws (DC-002).
 */
export function renderRichText(node: RichTextNode, context: RichTextRenderContext): ReactNode {
  const rawBlocks = (node as { readonly blocks?: unknown }).blocks;
  const blocks = Array.isArray(rawBlocks) ? rawBlocks : [];
  const presentation = resolveRichTextStylePresentation(context.theme, safeOwnValue(node, "style"));
  const resolvedContext: ResolvedRichTextRenderContext = { ...context, presentation };
  const children: ReactNode[] = [];
  for (const [index, block] of blocks.entries()) {
    const rendered = renderBlock(block, `b${String(index)}`, resolvedContext);
    if (rendered !== null) children.push(rendered);
  }
  // Block-level typography reuses the `TextStyle` token pack (the resolved
  // container style); blocks stack in flow with a small token gap.
  const style: CSSProperties = {
    ...presentation.root,
    ...(context.inert ? { pointerEvents: "none" } : {}),
  };
  return (
    <div className={context.className} aria-hidden={context.inert ? true : undefined} style={style}>
      {children}
    </div>
  );
}
