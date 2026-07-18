import {
  EMPTY_TREE,
  applyPatch,
  foldPatchIntoStage,
  validateTheme,
  type FacetTheme,
  type FacetTree,
  type ViewSnapshot,
} from "@facet/core";
import {
  validateSandboxPatches,
  validateSandboxTree,
  validateSandboxView,
  type SandboxFormatError,
  type SandboxFormatErrorCode,
} from "./sandbox-format.js";

export type SandboxSource =
  | { readonly kind: "new" }
  | { readonly kind: "clone"; readonly runId: string; readonly revision: number };

export interface CreateSandboxSessionInput {
  readonly id: string;
  readonly theme: FacetTheme;
  readonly tree?: unknown;
  readonly view?: unknown;
  readonly source?: SandboxSource;
}

export interface SandboxSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly source: SandboxSource;
  readonly originalTree: FacetTree;
  readonly tree: FacetTree;
  readonly view?: ViewSnapshot;
}

export type SandboxRejectionReason = SandboxFormatErrorCode | "conflict" | "no-change";

export type SandboxMutationResult =
  | { readonly status: "applied"; readonly revision: number }
  | {
      readonly status: "rejected";
      readonly reason: SandboxRejectionReason;
      readonly revision: number;
    };

export type SandboxCreationErrorCode =
  SandboxFormatErrorCode | "invalid-session" | "invalid-source" | "invalid-theme";

export interface SandboxCreationError {
  readonly code: SandboxCreationErrorCode;
  readonly message: string;
}

export type CreateSandboxSessionResult =
  | { readonly ok: true; readonly session: SandboxSession }
  | { readonly ok: false; readonly error: SandboxCreationError };

function validSessionId(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function cloneSource(source: SandboxSource | undefined): SandboxSource | undefined {
  if (source === undefined) return Object.freeze({ kind: "new" });
  if (source.kind === "new") return Object.freeze({ kind: "new" });
  if (
    source.kind !== "clone" ||
    typeof source.runId !== "string" ||
    source.runId.length === 0 ||
    source.runId.length > 200 ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0
  ) {
    return undefined;
  }
  return Object.freeze({ kind: "clone", runId: source.runId, revision: source.revision });
}

function creationFailure(error: SandboxFormatError): CreateSandboxSessionResult {
  return { ok: false, error };
}

export interface SandboxSession {
  readonly id: string;
  snapshot(): SandboxSnapshot;
  applyPatches(expectedRevision: number, input: unknown): SandboxMutationResult;
  checkpointView(expectedRevision: number, input: unknown): SandboxMutationResult;
}

class SandboxSessionImpl implements SandboxSession {
  readonly id: string;
  private readonly source: SandboxSource;
  private readonly theme: FacetTheme;
  private readonly originalTree: FacetTree;
  private tree: FacetTree;
  private view: ViewSnapshot | undefined;
  private revision = 0;

  constructor(
    id: string,
    theme: FacetTheme,
    tree: FacetTree,
    view: ViewSnapshot | undefined,
    source: SandboxSource,
  ) {
    this.id = id;
    this.theme = theme;
    this.source = source;
    this.originalTree = tree;
    this.tree = tree;
    this.view = view;
  }

  snapshot(): SandboxSnapshot {
    return Object.freeze({
      id: this.id,
      revision: this.revision,
      source: this.source,
      originalTree: this.originalTree,
      tree: this.tree,
      ...(this.view === undefined ? {} : { view: this.view }),
    });
  }

  applyPatches(expectedRevision: number, input: unknown): SandboxMutationResult {
    if (expectedRevision !== this.revision) {
      return { status: "rejected", reason: "conflict", revision: this.revision };
    }
    const patches = validateSandboxPatches(input);
    if (!patches.ok) {
      return { status: "rejected", reason: patches.error.code, revision: this.revision };
    }

    let candidate: unknown;
    try {
      candidate = applyPatch(this.tree, patches.value);
    } catch {
      return { status: "rejected", reason: "invalid-tree", revision: this.revision };
    }
    const candidateValidation = validateSandboxTree(candidate, this.theme);
    if (!candidateValidation.ok) {
      return {
        status: "rejected",
        reason: candidateValidation.error.code,
        revision: this.revision,
      };
    }

    const folded = foldPatchIntoStage(this.tree, patches.value);
    if (folded.issues.length > 0) {
      return { status: "rejected", reason: "invalid-tree", revision: this.revision };
    }
    if (!folded.mutated) {
      return { status: "rejected", reason: "no-change", revision: this.revision };
    }
    const validated = validateSandboxTree(folded.tree, this.theme);
    if (!validated.ok) {
      return { status: "rejected", reason: validated.error.code, revision: this.revision };
    }

    this.tree = validated.value;
    this.revision += 1;
    return { status: "applied", revision: this.revision };
  }

  checkpointView(expectedRevision: number, input: unknown): SandboxMutationResult {
    if (expectedRevision !== this.revision) {
      return { status: "rejected", reason: "conflict", revision: this.revision };
    }
    const validated = validateSandboxView(input);
    if (!validated.ok) {
      return { status: "rejected", reason: validated.error.code, revision: this.revision };
    }
    this.view = validated.value;
    this.revision += 1;
    return { status: "applied", revision: this.revision };
  }
}

export function createSandboxSession(input: CreateSandboxSessionInput): CreateSandboxSessionResult {
  if (!validSessionId(input.id)) {
    return {
      ok: false,
      error: { code: "invalid-session", message: "Sandbox session id is invalid." },
    };
  }
  const theme = validateTheme(input.theme).theme;
  if (theme === undefined) {
    return { ok: false, error: { code: "invalid-theme", message: "Sandbox Theme is invalid." } };
  }
  const source = cloneSource(input.source);
  if (source === undefined) {
    return { ok: false, error: { code: "invalid-source", message: "Sandbox source is invalid." } };
  }
  const tree = validateSandboxTree(input.tree ?? EMPTY_TREE, theme);
  if (!tree.ok) return creationFailure(tree.error);

  const view =
    input.view === undefined
      ? { ok: true as const, value: undefined }
      : validateSandboxView(input.view);
  if (!view.ok) return creationFailure(view.error);

  return {
    ok: true,
    session: new SandboxSessionImpl(input.id, theme, tree.value, view.value, source),
  };
}
