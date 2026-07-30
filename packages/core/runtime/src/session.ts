import type {
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTheme,
  NeutralCopy,
  StageRevision,
} from "@facet/core";

export interface Session {
  readonly catalog: FacetCatalog;
  readonly theme: FacetTheme;
  readonly copy: NeutralCopy;
  readonly document: ComponentDocument | null;
  readonly data: DataModel;
  readonly stageRevision: StageRevision;
  readonly phase: "preparing" | "live";
}
