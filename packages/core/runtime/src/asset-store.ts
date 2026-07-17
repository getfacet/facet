/**
 * The operator's per-agent asset library as raw backend documents, before the
 * single validation gate in `loadAssets`.
 */
export interface AssetDocuments {
  /** One complete Theme document. Absence selects Facet's bundled Theme. */
  readonly theme?: unknown;
  /** One exact Pattern list. Absence selects bundled Patterns; `[]` selects none. */
  readonly patterns?: unknown;
  readonly initialTree?: unknown;
  /** Backend-level problems (unreadable file, bad JSON) — surfaced, never thrown. */
  readonly issues?: readonly string[];
}

/** Serves an agent's raw asset documents. */
export interface AssetsStore {
  load(agentId: string): Promise<AssetDocuments>;
}

/** Browser-safe, in-memory asset store used by the zero-config reference path. */
export class MemoryAssets implements AssetsStore {
  constructor(private readonly docs: AssetDocuments) {}

  async load(_agentId: string): Promise<AssetDocuments> {
    return this.docs;
  }
}
