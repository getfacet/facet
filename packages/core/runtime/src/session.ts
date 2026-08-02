import type {
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTheme,
  FacetThemeExtensionDeclaration,
  NeutralCopy,
  StageRevision,
} from "@facet/core";

export interface Session {
  readonly catalog: FacetCatalog;
  readonly theme: FacetTheme;
  readonly themeExtensions: readonly FacetThemeExtensionDeclaration[];
  readonly copy: NeutralCopy;
  readonly document: ComponentDocument | null;
  readonly data: DataModel;
  readonly stageRevision: StageRevision;
  readonly phase: "preparing" | "live";
}
