import { isFacetIdentifier } from "./identifiers.js";
import type { CollectedValueKind } from "./mount-contract.js";
import type { CollectSpec, ComponentSpecValidationResult, PropSchema } from "./component-spec.js";

type SpecRejection = Extract<ComponentSpecValidationResult, { readonly ok: false }>;

const COLLECT_KEYS: readonly string[] = ["collectable", "valueProp", "valueKind", "sensitiveProp"];
const COLLECTED_VALUE_KINDS: readonly CollectedValueKind[] = ["string", "boolean", "string[]"];
const COLLECT_NAME_PROP = "name";
const COLLECT_REQUEST_PROP = "collect";
const EVENT_ARG_PROP = "arg";
const FRAMEWORK_PROP_FORBIDDEN_KEYS: readonly string[] = ["default", "enum", "bindable"];
const EVENT_ARG_FORBIDDEN_KEYS: readonly string[] = ["default", "bindable"];

function reject(code: string, at: string, detail: string): SpecRejection {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstUnknownKey(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): string | undefined {
  try {
    return Object.keys(value).find((key) => !allowed.includes(key));
  } catch {
    return "(unreadable)";
  }
}

export function validateCollect(
  value: unknown,
  props: Readonly<Record<string, PropSchema>>,
):
  | { readonly ok: true; readonly collect: CollectSpec }
  | Extract<ComponentSpecValidationResult, { readonly ok: false }> {
  if (!isRecord(value)) {
    return reject("invalid_collect", "collect", "A collect block must be a plain object.");
  }
  const unknownKey = firstUnknownKey(value, COLLECT_KEYS);
  if (unknownKey !== undefined) {
    return reject("unknown_collect_key", `collect.${unknownKey}`, "The collect block is closed.");
  }
  if (value["collectable"] !== true) {
    return reject(
      "invalid_collectable",
      "collect.collectable",
      "A non-collectable component omits the collect block entirely.",
    );
  }
  const valueProp = value["valueProp"];
  if (!isFacetIdentifier(valueProp) || !Object.hasOwn(props, valueProp)) {
    return reject(
      "unknown_value_prop",
      "collect.valueProp",
      "valueProp must name a declared prop.",
    );
  }
  const valueKind = value["valueKind"];
  if (
    typeof valueKind !== "string" ||
    !COLLECTED_VALUE_KINDS.includes(valueKind as CollectedValueKind)
  ) {
    return reject(
      "invalid_collect_value_kind",
      "collect.valueKind",
      "valueKind must be string, boolean, or string[].",
    );
  }
  const declaredType = props[valueProp]?.type;
  const matchingType =
    valueKind === "string[]" ? "array" : valueKind === "boolean" ? "boolean" : "string";
  if (declaredType !== matchingType) {
    return reject(
      "collect_value_kind_mismatch",
      "collect.valueKind",
      "valueKind must agree with the declared value prop type.",
    );
  }
  if (!("sensitiveProp" in value)) {
    const address = validateCollectName(props, valueProp);
    return (
      address ?? {
        ok: true,
        collect: Object.freeze({
          collectable: true as const,
          valueProp,
          valueKind: valueKind as CollectedValueKind,
        }),
      }
    );
  }
  const sensitiveProp = value["sensitiveProp"];
  if (!isFacetIdentifier(sensitiveProp) || props[sensitiveProp]?.type !== "boolean") {
    return reject(
      "invalid_sensitive_prop",
      "collect.sensitiveProp",
      "sensitiveProp must name a declared boolean prop.",
    );
  }
  const address = validateCollectName(props, valueProp);
  return (
    address ?? {
      ok: true,
      collect: Object.freeze({
        collectable: true as const,
        valueProp,
        valueKind: valueKind as CollectedValueKind,
        sensitiveProp,
      }),
    }
  );
}

/**
 * Checks the collection request list, when a spec declares one.
 *
 * The prop name is the reservation, so a declaration of the wrong type is a
 * nonconforming request list rather than an ordinary prop that happens to share
 * the name: a host cannot opt out of the convention by declaring `collect` as
 * something else. The rule deliberately does **not** consult the collect block —
 * a `Button` declares the list and collects nothing, a `Field` collects and
 * declares no list — and `required` is left to the spec, because whether a
 * component must carry a list is a question about that component, not about
 * Facet's ability to read one.
 *
 * Guidance is not re-checked here. Every prop already needs it, so the "scalar
 * string with guidance" shape is complete once ordinary validation has run.
 *
 * Returns `undefined` when the declaration conforms, so the caller reads as a
 * guard.
 */
export function validateCollectRequest(
  props: Readonly<Record<string, PropSchema>>,
): Extract<ComponentSpecValidationResult, { readonly ok: false }> | undefined {
  const at = `props.${COLLECT_REQUEST_PROP}`;
  const request = props[COLLECT_REQUEST_PROP];
  if (request === undefined) {
    return undefined;
  }
  if (request.type !== "string") {
    return rejectCollectRequest(`${at}.type`, "A collection request list is a scalar string.");
  }
  const forbidden = FRAMEWORK_PROP_FORBIDDEN_KEYS.find((key) => key in request);
  if (forbidden !== undefined) {
    return rejectCollectRequest(
      `${at}.${forbidden}`,
      "A request list is authored literally, so it carries no default, domain or binding.",
    );
  }
  return undefined;
}

function rejectCollectRequest(at: string, detail: string): SpecRejection {
  return reject("nonconforming_collect_request", at, detail);
}

/**
 * Checks the event argument, when a spec declares one.
 *
 * An `agent:` event carries one explicit argument, so the exact lowercase `arg`
 * is reserved the way the two collection props are: the renderer forwarding it
 * is reading a framework convention, not inferring meaning from a
 * component-specific prop. The name is the reservation, so a declaration of the
 * wrong type is a nonconforming argument rather than an ordinary prop that
 * happens to share the name.
 *
 * Two things the request list forbids are **left to the spec** here, and the
 * shorter forbidden-key set above is the whole difference. `required` is the
 * component's own business — whether a control must carry an argument says
 * nothing about Facet's ability to read one — and `enum` is a legitimate
 * authoring constraint: the author still writes one literal value, and pinning
 * the closed set it comes from is exactly what a prop domain is for. Reusing the
 * collection set would forbid a domain the default `Button` is entitled to.
 *
 * Guidance is not re-checked here; every prop already needs it.
 *
 * Returns `undefined` when the declaration conforms, so the caller reads as a
 * guard.
 */
export function validateEventArg(
  props: Readonly<Record<string, PropSchema>>,
): Extract<ComponentSpecValidationResult, { readonly ok: false }> | undefined {
  const at = `props.${EVENT_ARG_PROP}`;
  const arg = props[EVENT_ARG_PROP];
  if (arg === undefined) {
    return undefined;
  }
  if (arg.type !== "string") {
    return rejectEventArg(`${at}.type`, "An event argument is a scalar string.");
  }
  const forbidden = EVENT_ARG_FORBIDDEN_KEYS.find((key) => key in arg);
  if (forbidden !== undefined) {
    return rejectEventArg(
      `${at}.${forbidden}`,
      "An argument is authored literally, so it carries no default and no binding.",
    );
  }
  return undefined;
}

function rejectEventArg(at: string, detail: string): SpecRejection {
  return reject("nonconforming_event_arg", at, detail);
}

/**
 * Checks the collection address a collectable spec must declare.
 *
 * It runs **after** the collect block's own keys, so a malformed block is
 * reported as the malformed block it is rather than as a missing address; and it
 * reads the already-normalized props, so bounded guidance and every other
 * ordinary prop rule have been applied first. One code covers every
 * nonconformity — a host reading it has one thing to fix and the location names
 * which part.
 *
 * The address is also the one prop `valueProp` may **not** name. The framework
 * consumes the address and strips it before mount, so a spec that pointed the
 * injected value at it would have Facet overwrite the very name a collect list
 * resolves. That check comes last, once the address is known to exist and
 * conform, so a spec wrong in both ways is reported as the address fault it is.
 *
 * Returns `undefined` when the address conforms, so the caller reads as a guard.
 */
function validateCollectName(
  props: Readonly<Record<string, PropSchema>>,
  valueProp: string,
): SpecRejection | undefined {
  const at = `props.${COLLECT_NAME_PROP}`;
  const name = props[COLLECT_NAME_PROP];
  if (name === undefined) {
    return rejectCollectName(at, "A collectable component declares the name a collect list uses.");
  }
  if (name.type !== "string") {
    return rejectCollectName(`${at}.type`, "A collection address is a scalar string.");
  }
  const forbidden = FRAMEWORK_PROP_FORBIDDEN_KEYS.find((key) => key in name);
  if (forbidden !== undefined) {
    return rejectCollectName(
      `${at}.${forbidden}`,
      "An address is authored literally, so it carries no default, domain or binding.",
    );
  }
  if (name.required !== true) {
    return rejectCollectName(`${at}.required`, "Every collectable field is addressed by name.");
  }
  if (valueProp === COLLECT_NAME_PROP) {
    return rejectCollectName(
      "collect.valueProp",
      "The collection address cannot also be the value prop Facet injects.",
    );
  }
  return undefined;
}

function rejectCollectName(at: string, detail: string): SpecRejection {
  return reject("nonconforming_collect_name", at, detail);
}
