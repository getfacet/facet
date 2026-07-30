import type { AgentEvent, ServerFrame } from "@facet/core";

export type FacetServerObservation =
  | {
      readonly kind: "ui-in";
      readonly sessionKey: string;
      readonly event: AgentEvent;
    }
  | {
      readonly kind: "accepted-frame";
      readonly sessionKey: string;
      readonly frame: ServerFrame;
      readonly seq: number;
    }
  | {
      readonly kind: "busy";
      readonly sessionKey: string;
      readonly eventId: string;
    }
  | {
      readonly kind: "diagnostic";
      readonly sessionKey: string;
      readonly code: string;
      readonly detail: string;
    };

export type FacetServerObserver = (event: FacetServerObservation) => void;

function deepFreeze(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  Object.freeze(value);
}

export function emitFacetServerObservation(
  observer: FacetServerObserver | undefined,
  observation: FacetServerObservation,
): void {
  if (observer === undefined) return;
  try {
    const detached = structuredClone(observation);
    deepFreeze(detached);
    observer(detached);
  } catch {
    // Diagnostics are non-controlling.
  }
}
