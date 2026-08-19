/**
 * `@facet/core` — the dependency-free contract every other Facet package is
 * written in.
 *
 * This file is the **whole** public surface of the package, and it is an
 * explicit named-export list because `export *` is banned (D-12). The ban is not
 * a style preference. A wildcard republishes whatever a module happens to export
 * *today*, so a private helper added later becomes public silently, with no
 * review and no failing test — which is exactly how helpers leaked into this
 * package's API before the cut. Naming each symbol makes the surface reviewable
 * in one diff and makes widening it a deliberate act.
 *
 * **Off-barrel is not un-exported.** Sibling modules inside this package import
 * each other through ordinary module `export`s: `authorError` is imported by
 * `markup-lexer.ts`, `markup-parser.ts` and `document-validation.ts`, so
 * removing its module export is impossible rather than a policy choice. What
 * decides the *package* surface is this file alone. The exact off-barrel set is
 * `markup-lexer.ts` as a whole module, plus `AUTHOR_ERROR_CODES`, `truncate`,
 * `authorError` and `firstError` from `markup-errors.ts` — and no public type
 * may *name* one of them, because the emitted `.d.ts` would then carry a name no
 * consumer can import (TS2459). `index.test.ts` proves that with an emitted-
 * declaration reachability audit rather than by reading the source.
 *
 * The order below is one block per module, modules alphabetical, values before
 * types within a module — so "where does this symbol come from" is answered by
 * looking, not by grepping.
 */

export { parseAction } from "./actions.js";
export type { Action, ActionResult } from "./actions.js";

export { isAuthoredNumberLiteral, parseAuthoredNumber } from "./author-scalar.js";

export { resolveFacetAsset, validateFacetAssetRegistry } from "./asset-registry.js";
export type {
  FacetAssetDescriptor,
  FacetAssetRegistry,
  FacetAssetRegistryValidationResult,
  FacetImageAsset,
} from "./asset-registry.js";

export { BOUNDS } from "./bounds.js";
export type { Bounds } from "./bounds.js";

export { buildCatalogIndex, validateCatalog, validateModalConformance } from "./catalog.js";
export type { CatalogValidationResult, FacetCatalog, ModalConformanceResult } from "./catalog.js";

export { validateComponentSpec } from "./component-spec.js";
export type {
  CollectSpec,
  ComponentSpec,
  ComponentSpecValidationResult,
  PropSchema,
  StructuredPropType,
  ThemeRecipeSpec,
} from "./component-spec.js";

export { deriveComponentContentClass } from "./component-content.js";
export type {
  ComponentContentClass,
  ComponentContentSpec,
  ComponentSlotSpec,
} from "./component-content.js";

export { deriveMessageId, truncateConversationText, validateVisitorText } from "./conversation.js";
export type { ConversationMessage } from "./conversation.js";

export { resolveBinding } from "./data-binding.js";
export type { BindingResolution } from "./data-binding.js";

export {
  dataValueEntryCount,
  dataValueFields,
  dataValuePresenceCount,
  dataValueShape,
  describeDataValue,
} from "./data-descriptor.js";
export type {
  DataValueCountPolicy,
  DataValueDescriptor,
  DescribeDataValueOptions,
  DataValueShape,
} from "./data-descriptor.js";

export { evaluateCandidateModel, measurePublishPayload, writePath } from "./data-model.js";
export type { DataModel, DataModelEvaluation, PayloadEvaluation } from "./data-model.js";

export { validateAuthorMarkup } from "./document-validation.js";
export type { AuthorValidationResult } from "./document-validation.js";

export { buildDocument } from "./document.js";
export type { ComponentDocument, ComponentNode } from "./document.js";

export { validateVisitorEvent } from "./event.js";
export type { VisitorEvent, VisitorEventValidationResult } from "./event.js";

export { isFacetIdentifier, parseDataPath } from "./identifiers.js";
export type { DataPath } from "./identifiers.js";

export { createBoundedMap } from "./lru-map.js";
export type { BoundedMap } from "./lru-map.js";

export type { AuthorError, AuthorErrorCode, SourceLocation } from "./markup-errors.js";

export { parseMarkup } from "./markup-parser.js";
export type { MarkupAst, MarkupNode, ParseMarkupResult } from "./markup-parser.js";

export { serializeDocument, serializeScreen } from "./markup-serialize.js";
export type { SerializeIssue, SerializeResult } from "./markup-serialize.js";

export type {
  CollectableMount,
  CollectedValue,
  CollectedValueKind,
  ComponentMountProps,
  MountedComponent,
} from "./mount-contract.js";

export { NEUTRAL_COPY_DEFAULTS, resolveNeutralCopy } from "./neutral-copy.js";
export type { NeutralCopy, NeutralCopyResolution } from "./neutral-copy.js";

export { applyPatch, MAX_PATCH_OPS } from "./patch.js";
export type { JsonPatchOperation } from "./patch.js";

export { collectTurnOutcome, iterateTurnOutcome, validateTurnOutcome } from "./protocol.js";
export type {
  AgentControlFrame,
  VisitorEventFrame,
  FacetAgent,
  FacetTransport,
  PatchFrame,
  ServerFrame,
  TurnOutcome,
  TurnOutcomeValidationResult,
} from "./protocol.js";

export { nextRevision } from "./revision.js";
export type { CasOutcome, StageRevision } from "./revision.js";

export type { FacetStage } from "./stage.js";

export type { StructuredFieldSpec, StructuredShapeSpec } from "./structured-shape.js";

export {
  FACET_THEME_CONTRACT,
  facetThemeToKebabCase,
  themeTokenRef,
  themeTokenVar,
} from "./theme-contract.js";
export type {
  FacetExtensionTokenRef,
  FacetFoundationGroupName,
  FacetFoundationTheme,
  FacetFoundationTokenRef,
  FacetRecipeTokenRef,
  FacetSemanticGroupName,
  FacetSemanticTheme,
  FacetSemanticTokenRef,
  FacetThemeContract,
  FacetThemeGroupSpec,
  FacetThemeTokenRef,
  FacetThemeTokenSpec,
  FacetThemeTokenTableValues,
  FacetThemeTokenValueKind,
  FacetThemeTokenValues,
} from "./theme-contract.js";
export { themeToCssVars, validateTheme, validateThemeExtensionDeclarations } from "./theme.js";
export type {
  FacetTheme,
  FacetThemeExtensionDeclaration,
  FacetThemeValidationOptions,
  ThemeExtensionDeclarationValidationResult,
  ThemeValidationResult,
} from "./theme.js";

export type {
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetToolSession,
} from "./tool-session.js";
