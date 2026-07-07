/**
 * Appear enter-animation CSS — package-internal, deliberately NOT exported
 * through the `@facet/react` barrel (no new public surface, RISK-API-2). The
 * agent's `appear` token maps to a class NAME only; all concrete animation CSS
 * (durations, easings, offsets) lives in the single static constant below,
 * framework-owned per invariant #4 — no theme-document or tree data is ever
 * interpolated into it, so the token adds zero injection surface (RISK-INV-4).
 * `StageRenderer` owns the binding: it applies the class per node and renders
 * `<style>{APPEAR_CSS}</style>` once per stage iff the tree uses appear.
 */

/**
 * The one static appear stylesheet: fade (160ms ease-out, opacity 0→1) and
 * slide (200ms ease-out, translateY(6px)→0 combined with opacity). The slide
 * offset is deliberately sub-gap (6px < the smallest real spacing step) and
 * opacity-led, so a mid-animation paint reads as motion, never as an overlay
 * (RISK-INV-6b, invariant #5). The trailing `prefers-reduced-motion` block is
 * scoped to exactly the two appear classes: an OS-level "reduce motion"
 * preference disables the animation while the content still renders (DC-008).
 */
export const APPEAR_CSS = `@keyframes facet-appear-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes facet-appear-slide {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.facet-appear-fade {
  animation: facet-appear-fade 160ms ease-out;
}
.facet-appear-slide {
  animation: facet-appear-slide 200ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .facet-appear-fade,
  .facet-appear-slide {
    animation: none;
  }
}
`;

/**
 * Classifies an unknown style object into an appear class name — TOTAL on the
 * raw live path (which bypasses `validateTree` by design): only the exact
 * strings "fade"/"slide" yield a class; "none", junk tokens, non-objects, and
 * nullish styles all resolve to `undefined` (no class, no style element),
 * never a throw (DC-005).
 */
export function appearClass(style: unknown): string | undefined {
  if (typeof style !== "object" || style === null) return undefined;
  const appear = (style as { appear?: unknown }).appear;
  if (appear === "fade") return "facet-appear-fade";
  if (appear === "slide") return "facet-appear-slide";
  return undefined;
}
