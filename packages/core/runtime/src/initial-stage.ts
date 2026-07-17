import { treeHasContent, type FacetSession, type FacetTree } from "@facet/core";
import { sessionKey, type StageStore } from "./stage-store.js";

/** Bound armed-but-unconsumed seed keys for broken or abandoned first turns. */
const MAX_SEEDED = 10_000;

/** A tree worth seeding a fresh session with: it already renders content. */
export function isSeedableTree(tree: FacetTree): boolean {
  try {
    return treeHasContent(tree);
  } catch {
    return false;
  }
}

/**
 * Decorates a stage store so a fresh session opens with a validated initial
 * stage. Existing sessions and non-seedable inputs pass through unchanged.
 */
export function withInitialStage(store: StageStore, initialStage?: FacetTree): StageStore {
  if (initialStage === undefined || !isSeedableTree(initialStage)) return store;
  const seed = initialStage;
  const seedFingerprint = stableTreeFingerprint(seed);
  const seeded = new Set<string>();
  const recoverable = new Set<string>();
  const remember = (set: Set<string>, key: string): void => {
    if (set.has(key)) return;
    if (set.size >= MAX_SEEDED) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    set.add(key);
  };
  const armSeed = (key: string): void => {
    recoverable.delete(key);
    if (seeded.size >= MAX_SEEDED && !seeded.has(key)) {
      const oldest = seeded.values().next().value;
      if (oldest !== undefined) {
        seeded.delete(oldest);
        remember(recoverable, oldest);
      }
    }
    remember(seeded, key);
  };
  return {
    get: (agentId, visitorId) => store.get(agentId, visitorId),
    save: (session) => store.save(session),
    async open(agentId, visitor) {
      const key = sessionKey(agentId, visitor.visitorId);
      const existing = await store.get(agentId, visitor.visitorId);
      if (existing !== undefined) {
        if (
          !seeded.has(key) &&
          recoverable.has(key) &&
          stageMatchesFingerprint(existing.stage, seedFingerprint)
        ) {
          armSeed(key);
        }
        return existing;
      }
      const session: FacetSession = { agentId, visitor, stage: seed };
      await store.save(session);
      armSeed(key);
      return session;
    },
    takeSeeded(agentId, visitorId) {
      const key = sessionKey(agentId, visitorId);
      const wasSeeded = seeded.delete(key);
      if (wasSeeded) recoverable.delete(key);
      return wasSeeded;
    },
  };
}

function stableTreeFingerprint(tree: FacetTree): string | undefined {
  try {
    return JSON.stringify(tree);
  } catch {
    return undefined;
  }
}

function stageMatchesFingerprint(tree: FacetTree, fingerprint: string | undefined): boolean {
  if (fingerprint === undefined) return false;
  try {
    return JSON.stringify(tree) === fingerprint;
  } catch {
    return false;
  }
}
