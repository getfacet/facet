import { isFacetIdentifier } from "@facet/core";

const KEY_PREFIX = "facet:screen:";

export interface PersistedScreen {
  readonly screen: string;
  readonly [key: string]: unknown;
}

function storageKey(agentId: string): string {
  return `${KEY_PREFIX}${agentId}`;
}

function readScreen(value: unknown): { readonly screen: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const screen = (value as Readonly<Record<string, unknown>>)["screen"];
  if (typeof screen !== "string" || !isFacetIdentifier(screen)) {
    return undefined;
  }
  return Object.freeze({ screen });
}

/**
 * Persist only the last known screen for one agent link. Retired view snapshot
 * members are never stored.
 */
export function persistScreen(agentId: string, snap: PersistedScreen): void {
  const projected = readScreen(snap);
  if (projected === undefined) {
    return;
  }
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(storageKey(agentId), JSON.stringify(projected));
  } catch {
    // best-effort only
  }
}

/**
 * Restore the persisted screen projection. Stored values are untrusted, so this
 * projects the one supported member and rejects corrupt or invalid screen names.
 */
export function loadPersistedScreen(agentId: string): { readonly screen: string } | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(storageKey(agentId));
    if (raw === null || raw.length === 0) return undefined;
    return readScreen(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
