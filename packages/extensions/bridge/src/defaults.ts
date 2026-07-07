/**
 * Single source of truth for the bridge's connection defaults. Consumed by
 * `bridge.ts` and the `facet-bridge` bin (`cli.ts`) directly from source. Kept
 * in its own module — NOT re-exported through the package barrel (`index.ts`) —
 * so it stays internal while the two consumers can never drift out of sync.
 */
export const BRIDGE_DEFAULTS = {
  serverUrl: "http://localhost:5291",
  agentId: "live",
  bridgePort: 5292,
} as const;
