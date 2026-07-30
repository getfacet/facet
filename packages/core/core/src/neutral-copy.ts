/**
 * The framework's neutral copy — the exact English strings Facet shows when it
 * has nothing else to show, plus the one validation message the conversation
 * channel returns for an over-long visitor message.
 *
 * **Ownership.** The framework owns *when* each neutral state appears, the
 * guarantee that no internal detail leaks, and these default strings. A host may
 * replace any of them once, at bootstrap. The agent has no influence at any
 * point, and that is upheld **structurally** rather than by a reserved name:
 * nothing here is looked up by a key an author, the Data Model, or a component
 * prop could supply. Every string is read by a literal field name from either
 * `NEUTRAL_COPY_DEFAULTS` or the host override, and the override form is closed,
 * so an unrecognised key is a rejection rather than a new copy slot.
 *
 * **Three render states, four strings.** `render` holds the complete set of
 * neutral states the renderer may show — preparing, a crashed component, and a
 * corrupt subtree. There is no fourth. `validation.messageTooLong` sits
 * deliberately outside that group: it is copy the conversation channel returns
 * for input the visitor can fix, not a degraded render. Two groups make that
 * distinction structural instead of a comment.
 *
 * Every string, default or host-supplied, is bounded by `B-24`.
 *
 * `resolveNeutralCopy` is **total**: it never throws, for any input of any type.
 * Bootstrap copy is host configuration, so a malformed override is a rejection
 * the host can see, never an exception and never a silent fallback.
 */

import { BOUNDS } from "./bounds.js";

/** The complete framework-controlled copy set: three render states plus one validation message. */
export interface NeutralCopy {
  /** The only neutral states the renderer may show. There is no fourth. */
  readonly render: {
    /** Shown while the agent is still building the page. */
    readonly preparing: string;
    /** Shown in place of a registered component whose React code threw. */
    readonly componentUnavailable: string;
    /** Shown at the root of a subtree that could not be trusted to render. */
    readonly corruptSubtree: string;
  };
  /** Copy returned for input the visitor can fix. Not a render neutral state. */
  readonly validation: {
    /** Returned when a visitor message exceeds `B-25`. */
    readonly messageTooLong: string;
  };
}

/**
 * The framework defaults. A host that configures nothing gets exactly these, so
 * Facet renders a complete, neutral experience with no copy configuration at all.
 */
export const NEUTRAL_COPY_DEFAULTS: NeutralCopy = Object.freeze({
  render: Object.freeze({
    preparing: "Preparing…",
    componentUnavailable: "Content unavailable",
    corruptSubtree: "This section could not be displayed",
  }),
  validation: Object.freeze({
    messageTooLong: "Your message is too long. Please shorten it and try again.",
  }),
});

/**
 * What `resolveNeutralCopy` answers: the frozen copy set, or the first failure.
 * The rejection is part of the public contract — a host has to be able to name
 * what it caught — so it is spelled out here rather than hidden behind a private
 * alias.
 */
export type NeutralCopyResolution =
  | { readonly ok: true; readonly copy: NeutralCopy }
  | {
      readonly ok: false;
      readonly code: string;
      readonly at: string;
      readonly detail: string;
    };

/**
 * The rejection branch, derived from the public result. Deriving it keeps the
 * private name out of every emitted signature.
 */
type NeutralCopyRejection = Extract<NeutralCopyResolution, { readonly ok: false }>;

/** The closed top-level override form. */
const RENDER_GROUP = "render";
const VALIDATION_GROUP = "validation";

/**
 * The closed key set of each group, in the order the first failure is reported.
 * `satisfies` pins every name here to a real field of `NeutralCopy`; the reverse
 * direction — a field with no entry here — is pinned at runtime by the
 * exhaustive-override test, which would then resolve to a default it did not
 * ask for.
 */
const RENDER_KEYS = [
  "preparing",
  "componentUnavailable",
  "corruptSubtree",
] as const satisfies readonly (keyof NeutralCopy["render"])[];

const VALIDATION_KEYS = [
  "messageTooLong",
] as const satisfies readonly (keyof NeutralCopy["validation"])[];

/** An empty own-property bag: the shape a group takes when the host omits it. */
const NO_OVERRIDES: Record<string, unknown> = Object.freeze(Object.create(null));

function reject(code: string, at: string, detail: string): NeutralCopyRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What one group read answers: the host's own overrides, or the first failure. */
type GroupRead =
  { readonly ok: true; readonly group: Record<string, unknown> } | NeutralCopyRejection;

/**
 * Reads one override group. An absent group is not a failure — it means the host
 * overrode nothing in it — but a present non-object, or a key outside the closed
 * set, is. Unknown keys are scanned in sorted order so the reported failure never
 * depends on the host object's own key order.
 */
function readGroup(
  source: Record<string, unknown>,
  groupName: string,
  allowed: readonly string[],
): GroupRead {
  if (!Object.hasOwn(source, groupName)) {
    return { ok: true, group: NO_OVERRIDES };
  }
  const raw = source[groupName];
  if (raw === undefined) {
    return { ok: true, group: NO_OVERRIDES };
  }
  if (!isRecord(raw)) {
    return reject("copy_group_not_an_object", groupName, "A neutral copy group is a plain object.");
  }
  const unknownKey = Object.keys(raw)
    .sort()
    .find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    return reject(
      "unknown_copy_key",
      `${groupName}.${unknownKey}`,
      "The neutral copy form is closed; it has no slot by this name.",
    );
  }
  return { ok: true, group: raw };
}

/** What one string read answers: the effective string, or the first failure. */
type StringRead = { readonly ok: true; readonly value: string } | NeutralCopyRejection;

/**
 * Resolves one string. `key` is always a literal from the closed set above —
 * never a value carried in from markup, the Data Model, or a component prop —
 * and `Object.hasOwn` keeps an inherited or prototype-planted value from ever
 * standing in for an override the host did not write.
 */
function readString(
  group: Record<string, unknown>,
  groupName: string,
  key: string,
  fallback: string,
): StringRead {
  if (!Object.hasOwn(group, key)) {
    return { ok: true, value: fallback };
  }
  const raw = group[key];
  if (raw === undefined) {
    return { ok: true, value: fallback };
  }
  const at = `${groupName}.${key}`;
  if (typeof raw !== "string") {
    return reject("copy_not_a_string", at, "Neutral copy is text.");
  }
  if (raw.trim().length === 0) {
    return reject("copy_empty", at, "A neutral state must still say something.");
  }
  if (raw.length > BOUNDS.frameworkCopyChars) {
    return reject("copy_too_long", at, "Copy length exceeds B-24.");
  }
  return { ok: true, value: raw };
}

/**
 * Resolves the copy set a session runs with: the framework defaults, optionally
 * overridden once by the host at bootstrap.
 *
 * Omitting the argument is the zero-configuration path and always succeeds. An
 * override may supply any subset; every string it does not supply keeps its
 * framework default. The whole override is rejected on its first fault rather
 * than partially applied — half a copy set is not a copy set — and the result is
 * frozen, so a later mutation of the host's object cannot change what a running
 * session shows.
 */
export function resolveNeutralCopy(hostOverride?: unknown): NeutralCopyResolution {
  try {
    return resolveOverride(hostOverride);
  } catch {
    return reject(
      "copy_read_failed",
      "",
      "Reading the copy override threw; it must be plain data.",
    );
  }
}

function resolveOverride(hostOverride: unknown): NeutralCopyResolution {
  if (hostOverride === undefined) {
    return { ok: true, copy: NEUTRAL_COPY_DEFAULTS };
  }
  if (!isRecord(hostOverride)) {
    return reject("copy_not_an_object", "", "A neutral copy override is a plain object.");
  }
  const unknownGroup = Object.keys(hostOverride)
    .sort()
    .find((key) => key !== RENDER_GROUP && key !== VALIDATION_GROUP);
  if (unknownGroup !== undefined) {
    return reject(
      "unknown_copy_key",
      unknownGroup,
      "The neutral copy form is closed; it has no group by this name.",
    );
  }
  const render = resolveRenderCopy(hostOverride);
  if (!render.ok) {
    return render;
  }
  const validation = resolveValidationCopy(hostOverride);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    copy: Object.freeze({ render: render.value, validation: validation.value }),
  };
}

/** What one group resolution answers: that group's frozen copy, or the first failure. */
type RenderRead =
  { readonly ok: true; readonly value: NeutralCopy["render"] } | NeutralCopyRejection;

type ValidationRead =
  { readonly ok: true; readonly value: NeutralCopy["validation"] } | NeutralCopyRejection;

/**
 * Resolves the three render neutral states. Each string is named literally on
 * both sides — the slot being filled and the default it falls back to — so there
 * is no key here that anything outside the host's bootstrap could choose.
 */
function resolveRenderCopy(hostOverride: Record<string, unknown>): RenderRead {
  const group = readGroup(hostOverride, RENDER_GROUP, RENDER_KEYS);
  if (!group.ok) {
    return group;
  }
  const preparing = readString(
    group.group,
    RENDER_GROUP,
    "preparing",
    NEUTRAL_COPY_DEFAULTS.render.preparing,
  );
  if (!preparing.ok) {
    return preparing;
  }
  const componentUnavailable = readString(
    group.group,
    RENDER_GROUP,
    "componentUnavailable",
    NEUTRAL_COPY_DEFAULTS.render.componentUnavailable,
  );
  if (!componentUnavailable.ok) {
    return componentUnavailable;
  }
  const corruptSubtree = readString(
    group.group,
    RENDER_GROUP,
    "corruptSubtree",
    NEUTRAL_COPY_DEFAULTS.render.corruptSubtree,
  );
  if (!corruptSubtree.ok) {
    return corruptSubtree;
  }
  return {
    ok: true,
    value: Object.freeze({
      preparing: preparing.value,
      componentUnavailable: componentUnavailable.value,
      corruptSubtree: corruptSubtree.value,
    }),
  };
}

/** Resolves the one validation string, on the same literal-name terms. */
function resolveValidationCopy(hostOverride: Record<string, unknown>): ValidationRead {
  const group = readGroup(hostOverride, VALIDATION_GROUP, VALIDATION_KEYS);
  if (!group.ok) {
    return group;
  }
  const messageTooLong = readString(
    group.group,
    VALIDATION_GROUP,
    "messageTooLong",
    NEUTRAL_COPY_DEFAULTS.validation.messageTooLong,
  );
  if (!messageTooLong.ok) {
    return messageTooLong;
  }
  return { ok: true, value: Object.freeze({ messageTooLong: messageTooLong.value }) };
}
