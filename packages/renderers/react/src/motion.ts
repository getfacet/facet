export const MANY_CHANGE_THRESHOLD = 8;
export const MOTION_ENTER_MS = 160;
export const MOTION_EXIT_MS = 200;
export const STAGE_CROSSFADE_MS = 220;

export const MOTION_CLASS_NAMES = {
  brickEnter: "facet-motion-brick-enter",
  brickExit: "facet-motion-brick-exit",
  stageFrame: "facet-motion-stage-frame",
  stageCrossfade: "facet-motion-stage-crossfade",
  stageCurrent: "facet-motion-stage-current",
  stagePrevious: "facet-motion-stage-previous",
} as const;

/**
 * Static renderer-owned stylesheet for default lifecycle motion. Keep this free
 * of tree, style, theme, or node interpolation; StageRenderer only decides when
 * to inject it and which stable class names to apply.
 */
export const MOTION_CSS = `@keyframes ${MOTION_CLASS_NAMES.brickEnter} {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ${MOTION_CLASS_NAMES.brickExit} {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(4px); }
}
@keyframes ${MOTION_CLASS_NAMES.stageCurrent} {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ${MOTION_CLASS_NAMES.stagePrevious} {
  from { opacity: 1; }
  to { opacity: 0; }
}
.${MOTION_CLASS_NAMES.brickEnter} {
  animation: ${MOTION_CLASS_NAMES.brickEnter} ${MOTION_ENTER_MS}ms ease-out both;
  will-change: opacity, transform;
}
.${MOTION_CLASS_NAMES.brickExit} {
  animation: ${MOTION_CLASS_NAMES.brickExit} ${MOTION_EXIT_MS}ms ease-in both;
  pointer-events: none;
  will-change: opacity, transform;
}
.${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} {
  display: grid;
  isolation: isolate;
}
.${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} > .${MOTION_CLASS_NAMES.stageCurrent},
.${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} > .${MOTION_CLASS_NAMES.stagePrevious} {
  grid-area: 1 / 1;
  min-width: 0;
}
.${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} > .${MOTION_CLASS_NAMES.stageCurrent} {
  animation: ${MOTION_CLASS_NAMES.stageCurrent} ${STAGE_CROSSFADE_MS}ms ease-out both;
}
.${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} > .${MOTION_CLASS_NAMES.stagePrevious} {
  animation: ${MOTION_CLASS_NAMES.stagePrevious} ${STAGE_CROSSFADE_MS}ms ease-out both;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .${MOTION_CLASS_NAMES.brickEnter},
  .${MOTION_CLASS_NAMES.brickExit},
  .${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade},
  .${MOTION_CLASS_NAMES.stageCurrent},
  .${MOTION_CLASS_NAMES.stagePrevious} {
    animation: none;
    transition: none;
    transform: none;
  }
  .${MOTION_CLASS_NAMES.stageFrame}.${MOTION_CLASS_NAMES.stageCrossfade} > .${MOTION_CLASS_NAMES.stagePrevious} {
    opacity: 0;
  }
}
`;

type MotionClassValue = string | false | null | undefined;

export function composeMotionClassName(...classNames: MotionClassValue[]): string | undefined {
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const className of classNames) {
    if (!className) continue;
    for (const part of className.trim().split(/\s+/)) {
      if (part.length === 0 || seen.has(part)) continue;
      seen.add(part);
      parts.push(part);
    }
  }

  return parts.length === 0 ? undefined : parts.join(" ");
}

export function stageFrameClassName(crossfade: boolean): string {
  return (
    composeMotionClassName(
      MOTION_CLASS_NAMES.stageFrame,
      crossfade && MOTION_CLASS_NAMES.stageCrossfade,
    ) ?? MOTION_CLASS_NAMES.stageFrame
  );
}

export function stageCurrentClassName(): string {
  return MOTION_CLASS_NAMES.stageCurrent;
}

export function stagePreviousClassName(): string {
  return MOTION_CLASS_NAMES.stagePrevious;
}
