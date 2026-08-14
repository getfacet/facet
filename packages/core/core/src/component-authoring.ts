import { BOUNDS } from "./bounds.js";
import { isFacetIdentifier } from "./identifiers.js";

export const COMPONENT_AUTHORING_ROLES = Object.freeze([
  "layout",
  "display",
  "action",
  "task",
] as const);
export type ComponentAuthoringRole = (typeof COMPONENT_AUTHORING_ROLES)[number];

export const COMPONENT_VISUAL_EMPHASES = Object.freeze(["primary", "supporting", "quiet"] as const);
export type ComponentVisualEmphasis = (typeof COMPONENT_VISUAL_EMPHASES)[number];

export type LayoutComponentAuthoring = Readonly<{
  role: "layout";
  layoutPurpose: string;
  responsiveBehavior: string;
}>;

export type DisplayComponentAuthoring = Readonly<{
  role: "display";
  informationTypes: readonly string[];
  visualEmphasis: ComponentVisualEmphasis;
}>;

export type ActionComponentAuthoring = Readonly<{
  role: "action";
  interactionTypes: readonly string[];
}>;

export type TaskComponentAuthoring = Readonly<{
  role: "task";
  userIntents: readonly string[];
  outcomes: readonly string[];
}>;

export type ComponentAuthoring =
  | LayoutComponentAuthoring
  | DisplayComponentAuthoring
  | ActionComponentAuthoring
  | TaskComponentAuthoring;

export type ComponentAuthoringValidationResult =
  | { readonly ok: true; readonly authoring: ComponentAuthoring }
  | { readonly ok: false; readonly code: string; readonly at: string; readonly detail: string };

type Rejection = Extract<ComponentAuthoringValidationResult, { readonly ok: false }>;

function isRejection(value: readonly string[] | Rejection): value is Rejection {
  return !Array.isArray(value);
}

const KEYS = Object.freeze({
  layout: Object.freeze(["role", "layoutPurpose", "responsiveBehavior"]),
  display: Object.freeze(["role", "informationTypes", "visualEmphasis"]),
  action: Object.freeze(["role", "interactionTypes"]),
  task: Object.freeze(["role", "userIntents", "outcomes"]),
} as const satisfies Readonly<Record<ComponentAuthoringRole, readonly string[]>>);

function reject(code: string, at: string, detail: string): Rejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roleOf(value: unknown): ComponentAuthoringRole | null {
  return typeof value === "string" &&
    COMPONENT_AUTHORING_ROLES.includes(value as ComponentAuthoringRole)
    ? (value as ComponentAuthoringRole)
    : null;
}

function firstUnknownKey(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  return (
    Object.keys(value)
      .sort()
      .find((key) => !allowed.includes(key)) ?? null
  );
}

function guidance(
  value: unknown,
  field: string,
  invalidCode: string,
  tooLongCode: string,
): string | Rejection {
  if (typeof value !== "string" || value.length === 0) {
    return reject(invalidCode, `authoring.${field}`, `${field} must be non-empty guidance text.`);
  }
  if (value.length > BOUNDS.componentAuthoringGuidanceChars) {
    return reject(tooLongCode, `authoring.${field}`, `${field} exceeds B-28.`);
  }
  return value;
}

function identifiers(
  value: unknown,
  field: string,
  singular: string,
  invalidCode: string,
  tooManyCode: string,
  duplicateCode: string,
): readonly string[] | Rejection {
  if (!Array.isArray(value) || value.length === 0) {
    return reject(
      invalidCode,
      `authoring.${field}`,
      `${field} must be a non-empty identifier list.`,
    );
  }
  if (value.length > BOUNDS.componentAuthoringSignals) {
    return reject(tooManyCode, `authoring.${field}`, `${field} exceeds B-26.`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isFacetIdentifier(item)) {
      return reject(
        `invalid_${singular}`,
        `authoring.${field}[${String(index)}]`,
        `${field} members must be Facet identifiers.`,
      );
    }
    if (seen.has(item)) {
      return reject(
        duplicateCode,
        `authoring.${field}[${String(index)}]`,
        `${field} members must be unique.`,
      );
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function outcomes(value: unknown): readonly string[] | Rejection {
  if (!Array.isArray(value) || value.length === 0) {
    return reject(
      "invalid_outcomes",
      "authoring.outcomes",
      "outcomes must be a non-empty text list.",
    );
  }
  if (value.length > BOUNDS.componentAuthoringOutcomes) {
    return reject("too_many_outcomes", "authoring.outcomes", "outcomes exceeds B-27.");
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      return reject(
        "invalid_outcome",
        `authoring.outcomes[${String(index)}]`,
        "Each outcome must be non-empty text.",
      );
    }
    if (item.length > BOUNDS.componentAuthoringGuidanceChars) {
      return reject(
        "outcome_too_long",
        `authoring.outcomes[${String(index)}]`,
        "An outcome exceeds B-28.",
      );
    }
    if (seen.has(item)) {
      return reject(
        "duplicate_outcome",
        `authoring.outcomes[${String(index)}]`,
        "outcomes members must be unique.",
      );
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

export function validateComponentAuthoring(value: unknown): ComponentAuthoringValidationResult {
  try {
    return validate(value);
  } catch {
    return reject(
      "authoring_read_failed",
      "authoring",
      "Reading authoring metadata threw; it must be plain data.",
    );
  }
}

function validate(value: unknown): ComponentAuthoringValidationResult {
  if (!isRecord(value)) {
    return reject("authoring_not_an_object", "authoring", "authoring must be a plain object.");
  }
  const role = roleOf(value["role"]);
  if (role === null) {
    return reject(
      "invalid_authoring_role",
      "authoring.role",
      "role must be layout, display, action, or task.",
    );
  }
  const unknown = firstUnknownKey(value, KEYS[role]);
  if (unknown !== null) {
    return reject(
      "unknown_authoring_key",
      `authoring.${unknown}`,
      "The role-specific authoring form is closed.",
    );
  }
  if (role === "layout") {
    const purpose = value["layoutPurpose"];
    if (!isFacetIdentifier(purpose)) {
      return reject(
        "invalid_layout_purpose",
        "authoring.layoutPurpose",
        "layoutPurpose must be a Facet identifier.",
      );
    }
    const responsive = guidance(
      value["responsiveBehavior"],
      "responsiveBehavior",
      "invalid_responsive_behavior",
      "responsive_behavior_too_long",
    );
    if (typeof responsive !== "string") return responsive;
    return {
      ok: true,
      authoring: Object.freeze({ role, layoutPurpose: purpose, responsiveBehavior: responsive }),
    };
  }
  if (role === "display") {
    const informationTypes = identifiers(
      value["informationTypes"],
      "informationTypes",
      "information_type",
      "invalid_information_types",
      "too_many_information_types",
      "duplicate_information_type",
    );
    if (isRejection(informationTypes)) return informationTypes;
    const emphasis = value["visualEmphasis"];
    if (
      typeof emphasis !== "string" ||
      !COMPONENT_VISUAL_EMPHASES.includes(emphasis as ComponentVisualEmphasis)
    ) {
      return reject(
        "invalid_visual_emphasis",
        "authoring.visualEmphasis",
        "visualEmphasis must be primary, supporting, or quiet.",
      );
    }
    return {
      ok: true,
      authoring: Object.freeze({
        role,
        informationTypes,
        visualEmphasis: emphasis as ComponentVisualEmphasis,
      }),
    };
  }
  if (role === "action") {
    const interactionTypes = identifiers(
      value["interactionTypes"],
      "interactionTypes",
      "interaction_type",
      "invalid_interaction_types",
      "too_many_interaction_types",
      "duplicate_interaction_type",
    );
    return isRejection(interactionTypes)
      ? interactionTypes
      : { ok: true, authoring: Object.freeze({ role, interactionTypes }) };
  }
  const userIntents = identifiers(
    value["userIntents"],
    "userIntents",
    "user_intent",
    "invalid_user_intents",
    "too_many_user_intents",
    "duplicate_user_intent",
  );
  if (isRejection(userIntents)) return userIntents;
  const taskOutcomes = outcomes(value["outcomes"]);
  return isRejection(taskOutcomes)
    ? taskOutcomes
    : { ok: true, authoring: Object.freeze({ role, userIntents, outcomes: taskOutcomes }) };
}

export function componentSemanticSignals(authoring: ComponentAuthoring): readonly string[] {
  switch (authoring.role) {
    case "layout":
      return Object.freeze([authoring.layoutPurpose]);
    case "display":
      return Object.freeze([...authoring.informationTypes]);
    case "action":
      return Object.freeze([...authoring.interactionTypes]);
    case "task":
      return Object.freeze([...authoring.userIntents]);
  }
}
