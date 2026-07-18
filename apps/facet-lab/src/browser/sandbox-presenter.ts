import type { FacetTheme, FacetTree, ViewSnapshot } from "@facet/core";

import {
  createSandboxSession,
  type SandboxMutationResult,
  type SandboxSession,
  type SandboxSnapshot,
  type SandboxSource,
} from "../sandbox/sandbox-session.js";
import {
  MAX_SANDBOX_DOCUMENT_BYTES,
  parseSandboxPatches,
  parseSandboxTree,
  type SandboxFormatError,
  type SandboxFormatErrorCode,
} from "../sandbox/sandbox-format.js";
import { MAX_RETAINED_RUNS, MIN_RETAINED_RUNS } from "../shared/run-contract.js";
import type { LabCapabilities } from "./run-config.js";

export const SANDBOX_CONTROL_LABELS = Object.freeze({
  sourceRun: "Source run ID",
  tree: "Facet tree JSON",
  patches: "RFC 6902 patch JSON",
  view: "View checkpoint JSON",
  expectedRevision: "Expected sandbox revision",
});

export type SandboxDiagnosticTarget = "session" | "tree" | "patches" | "view";
export type SandboxDiagnosticCode =
  | SandboxFormatErrorCode
  | "conflict"
  | "no-change"
  | "invalid-session"
  | "invalid-source"
  | "invalid-theme";

export interface SandboxDiagnostic {
  readonly code: SandboxDiagnosticCode;
  readonly target: SandboxDiagnosticTarget;
  readonly message: string;
}

export interface SandboxSnapshotProjection {
  readonly id: string;
  readonly revision: number;
  readonly source: SandboxSource;
  readonly originalTree: FacetTree;
  readonly previewTree: FacetTree;
  readonly view?: ViewSnapshot;
}

export type SandboxEditProjection =
  | {
      readonly status: "applied";
      readonly diagnostic: null;
      readonly snapshot: SandboxSnapshotProjection;
    }
  | {
      readonly status: "rejected";
      readonly diagnostic: SandboxDiagnostic;
      readonly snapshot: SandboxSnapshotProjection;
    };

export interface SandboxEditor {
  snapshot(): SandboxSnapshotProjection;
  applyPatches(expectedRevision: number, text: string): SandboxEditProjection;
  checkpointView(expectedRevision: number, text: string): SandboxEditProjection;
}

export interface CreateSandboxFromTreeTextInput {
  readonly id: string;
  readonly theme: FacetTheme;
  readonly text: string;
  readonly source?: SandboxSource;
}

export type CreateSandboxEditorResult =
  | { readonly ok: true; readonly editor: SandboxEditor }
  | { readonly ok: false; readonly diagnostic: SandboxDiagnostic };

export interface SafeSettingsMetadata {
  readonly dataDirectory?: unknown;
  readonly retention?: unknown;
  readonly bounds?: unknown;
}

export interface AvailabilityLabel {
  readonly status: "available" | "unavailable";
  readonly label: string;
}

export interface AvailabilityNumber {
  readonly status: "available" | "unavailable";
  readonly value: number | null;
}

export interface SettingsProviderProjection {
  readonly provider: "openai" | "anthropic";
  readonly available: boolean;
  readonly models: readonly string[];
  readonly defaultModel: string;
}

export interface SettingsBoundProjection extends AvailabilityNumber {
  readonly id: "maxHistory" | "screenshotConditions";
  readonly label: string;
}

export interface SettingsProjection {
  readonly deterministic: {
    readonly available: true;
    readonly models: readonly string[];
    readonly defaultModel: string;
  };
  readonly providers: readonly SettingsProviderProjection[];
  readonly dataDirectory: AvailabilityLabel;
  readonly retention: AvailabilityNumber;
  readonly bounds: readonly SettingsBoundProjection[];
}

const encoder = new TextEncoder();
const SAFE_DATA_DIRECTORY_LABELS = new Set([
  "Configured external data directory",
  "Platform application data",
  "custom",
  "default OS app data",
  "environment override",
]);

function projectSnapshot(snapshot: SandboxSnapshot): SandboxSnapshotProjection {
  return Object.freeze({
    id: snapshot.id,
    revision: snapshot.revision,
    source: snapshot.source,
    originalTree: snapshot.originalTree,
    previewTree: snapshot.tree,
    ...(snapshot.view === undefined ? {} : { view: snapshot.view }),
  });
}

function diagnostic(
  code: SandboxDiagnosticCode,
  target: SandboxDiagnosticTarget,
  message: string,
): SandboxDiagnostic {
  return Object.freeze({ code, target, message });
}

function mutationMessage(result: Extract<SandboxMutationResult, { status: "rejected" }>): string {
  const messages: Readonly<Record<typeof result.reason, string>> = {
    conflict: "The expected revision is stale. Review the latest safe sandbox before retrying.",
    "no-change": "The edit made no change to the safe sandbox.",
    cyclic: "Sandbox documents cannot contain cycles.",
    "invalid-bound": "Sandbox document bounds are invalid.",
    "non-json": "Sandbox documents must contain plain JSON values only.",
    "too-deep": "Sandbox documents exceed the nesting-depth limit.",
    "too-large": "Sandbox documents exceed the byte limit.",
    "too-many-nodes": "Sandbox documents exceed the node limit.",
    "empty-input": "Sandbox JSON cannot be empty.",
    "malformed-json": "Sandbox JSON is malformed.",
    "prohibited-content": "Executable or raw markup/style content is prohibited.",
    "invalid-tree": "The edit does not produce a valid Facet tree.",
    "invalid-patch": "Sandbox patches must be a bounded RFC 6902 array.",
    "invalid-view": "The sandbox view checkpoint is invalid.",
  };
  return messages[result.reason];
}

function projectMutation(
  session: SandboxSession,
  target: "patches" | "view",
  result: SandboxMutationResult,
): SandboxEditProjection {
  const snapshot = projectSnapshot(session.snapshot());
  return result.status === "applied"
    ? Object.freeze({ status: "applied", diagnostic: null, snapshot })
    : Object.freeze({
        status: "rejected",
        diagnostic: diagnostic(result.reason, target, mutationMessage(result)),
        snapshot,
      });
}

function parseView(
  text: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: SandboxFormatError } {
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: { code: "empty-input", message: "Sandbox JSON cannot be empty." },
    };
  }
  if (encoder.encode(text).byteLength > MAX_SANDBOX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: { code: "too-large", message: "Sandbox documents exceed the byte limit." },
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: { code: "malformed-json", message: "Sandbox JSON is malformed." },
    };
  }
}

function parseFailure(
  session: SandboxSession,
  target: "patches" | "view",
  error: SandboxFormatError,
): SandboxEditProjection {
  return Object.freeze({
    status: "rejected",
    diagnostic: diagnostic(error.code, target, error.message),
    snapshot: projectSnapshot(session.snapshot()),
  });
}

export function createSandboxEditor(session: SandboxSession): SandboxEditor {
  return Object.freeze({
    snapshot: () => projectSnapshot(session.snapshot()),
    applyPatches(expectedRevision: number, text: string): SandboxEditProjection {
      const parsed = parseSandboxPatches(text);
      return parsed.ok
        ? projectMutation(session, "patches", session.applyPatches(expectedRevision, parsed.value))
        : parseFailure(session, "patches", parsed.error);
    },
    checkpointView(expectedRevision: number, text: string): SandboxEditProjection {
      const parsed = parseView(text);
      return parsed.ok
        ? projectMutation(session, "view", session.checkpointView(expectedRevision, parsed.value))
        : parseFailure(session, "view", parsed.error);
    },
  });
}

export function createSandboxEditorFromTreeText(
  input: CreateSandboxFromTreeTextInput,
): CreateSandboxEditorResult {
  const parsed = parseSandboxTree(input.text, input.theme);
  if (!parsed.ok) {
    return { ok: false, diagnostic: diagnostic(parsed.error.code, "tree", parsed.error.message) };
  }
  const created = createSandboxSession({
    id: input.id,
    theme: input.theme,
    tree: parsed.value,
    ...(input.source === undefined ? {} : { source: input.source }),
  });
  return created.ok
    ? { ok: true, editor: createSandboxEditor(created.session) }
    : {
        ok: false,
        diagnostic: diagnostic(created.error.code, "session", created.error.message),
      };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function availabilityNumber(value: number | null): AvailabilityNumber {
  return value === null
    ? Object.freeze({ status: "unavailable", value: null })
    : Object.freeze({ status: "available", value });
}

/** Copies only the safe capability allowlist; unknown metadata and secret-bearing keys vanish. */
export function projectSettings(
  capabilities: LabCapabilities,
  metadata: unknown = {},
): SettingsProjection {
  const metadataRecord = record(metadata) ?? {};
  const bounds = record(metadataRecord["bounds"]);
  const dataDirectory = metadataRecord["dataDirectory"];
  const safeDirectory =
    typeof dataDirectory === "string" && SAFE_DATA_DIRECTORY_LABELS.has(dataDirectory)
      ? dataDirectory
      : null;
  const retention = safeInteger(metadataRecord["retention"], MIN_RETAINED_RUNS, MAX_RETAINED_RUNS);
  const maxHistory = safeInteger(bounds?.["maxHistory"], 1, 100);
  const screenshotConditions = safeInteger(bounds?.["screenshotConditions"], 1, 100);

  return Object.freeze({
    deterministic: Object.freeze({
      available: true as const,
      models: Object.freeze([...capabilities.deterministic.models]),
      defaultModel: capabilities.deterministic.defaultModel,
    }),
    providers: Object.freeze(
      (["openai", "anthropic"] as const).map((provider) => {
        const capability = capabilities.providers[provider];
        return Object.freeze({
          provider,
          available: capability.available,
          models: Object.freeze([...capability.models]),
          defaultModel: capability.defaultModel,
        });
      }),
    ),
    dataDirectory:
      safeDirectory === null
        ? Object.freeze({ status: "unavailable", label: "Unavailable" })
        : Object.freeze({ status: "available", label: safeDirectory }),
    retention: availabilityNumber(retention),
    bounds: Object.freeze([
      Object.freeze({
        id: "maxHistory" as const,
        label: "Maximum history results",
        ...availabilityNumber(maxHistory),
      }),
      Object.freeze({
        id: "screenshotConditions" as const,
        label: "Screenshot conditions",
        ...availabilityNumber(screenshotConditions),
      }),
    ]),
  });
}
