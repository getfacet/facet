import type {
  ClientEvent,
  CollectedEvent,
  FacetTree,
  ServerMessage,
  VisitorContext,
} from "@facet/core";

export type FacetServerObservation =
  | {
      readonly kind: "ui-in";
      readonly source: "forwarded" | "record";
      /** Stable correlation for one forwarded turn; local records have no agent turn. */
      readonly turnId: string | null;
      readonly visitor: VisitorContext;
      readonly event: ClientEvent | CollectedEvent;
    }
  | {
      readonly kind: "accepted-frame";
      readonly source: "live" | "late";
      /** Matches the forwarded UI-IN observation that produced this frame. */
      readonly turnId: string;
      readonly visitor: VisitorContext;
      readonly event: ClientEvent;
      readonly messages: readonly ServerMessage[];
      readonly stage: FacetTree | undefined;
      readonly agentMutated: boolean;
      readonly disposition: "applied" | "say-only-stale";
    };

export type FacetServerObserver = (event: FacetServerObservation) => void;

function absorbObserverResult(result: unknown): void {
  if ((typeof result !== "object" || result === null) && typeof result !== "function") {
    return;
  }
  try {
    const then = Reflect.get(result, "then");
    if (typeof then !== "function") return;
    const settle = (): void => {};
    void Reflect.apply(then, result, [settle, settle]);
  } catch {
    // A throwing `then` getter or thenable is as non-controlling as a callback
    // throw. Keep every hostile property access and invocation inside this guard.
  }
}

function deepFreeze(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  Object.freeze(value);
}

/** Publish detached, immutable evidence without granting the observer control. */
export function emitFacetServerObservation(
  observer: FacetServerObserver | undefined,
  observation: FacetServerObservation,
): void {
  if (observer === undefined) return;
  try {
    const detached = structuredClone(observation);
    deepFreeze(detached);
    const result: unknown = observer(detached);
    absorbObserverResult(result);
  } catch {
    // Observation is best-effort diagnostics. Clone/freeze/callback failures must
    // never escape into the authoritative persistence or delivery paths.
  }
}
