import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  FIXED_STYLE_VALUE_CONTRACT,
  TOKEN_STYLE_VALUE_CONTRACT,
  isValidThemeName,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickContractEntry,
  type BrickType,
  type FacetTree,
  type StyleValue,
  type StyleValueDomain,
  type StyleValueMetadata,
} from "@facet/core";
import { formatAssetObservation } from "./asset-observation.js";
import { formatAgentToolObservation } from "./observation.js";
import { selectPatternReference } from "./pattern-references.js";
import type {
  StageToolAssets,
  StageToolErrorCode,
  StageToolErrorResult,
  StageToolOkResult,
} from "./types.js";

type Input = Readonly<Record<string, unknown>>;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function safeExactKeys(input: Input, expected: readonly string[]): boolean {
  try {
    const keys = Object.keys(input);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
  } catch {
    return false;
  }
}

function safeRead(input: Input, key: string): unknown {
  try {
    return Reflect.get(input, key);
  } catch {
    return undefined;
  }
}

function isBrickType(value: unknown): value is BrickType {
  return typeof value === "string" && (BRICK_TYPES as readonly string[]).includes(value);
}

function exactName(input: Input): string | undefined {
  const value = safeRead(input, "name");
  return typeof value === "string" && isValidThemeName(value) ? value : undefined;
}

function propertyValueDomain(property: BrickStylePropertyContract): StyleValueDomain {
  const domains: Readonly<Record<string, StyleValueDomain>> =
    property.source === "token" ? TOKEN_STYLE_VALUE_CONTRACT : FIXED_STYLE_VALUE_CONTRACT;
  const domain = domains[property.domain];
  if (domain === undefined) {
    throw new Error(`Core Brick contract references missing ${property.source} domain.`);
  }
  return domain;
}

function projectTarget(target: BrickStyleTargetContract) {
  const projected: {
    properties: Record<string, "token" | "fixed">;
    states?: Readonly<Record<string, readonly string[]>>;
    applicableTo?: readonly string[];
  } = {
    properties: Object.fromEntries(
      Object.entries(target.properties).map(([name, property]) => [name, property.source]),
    ),
  };
  if (target.states !== undefined) projected.states = target.states;
  if (target.applicableTo !== undefined) projected.applicableTo = target.applicableTo;
  return projected;
}

type ChoiceTuple =
  | readonly [name: StyleValue, description: string, useWhen: string]
  | readonly [name: StyleValue, description: string, useWhen: string, avoidWhen: string];

function choiceTuple(choice: StyleValueMetadata): ChoiceTuple {
  return choice.avoidWhen === undefined
    ? [choice.name, choice.description, choice.useWhen]
    : [choice.name, choice.description, choice.useWhen, choice.avoidWhen];
}

function ownedTarget(
  contract: BrickContractEntry,
  target: string,
): BrickStyleTargetContract | undefined {
  if (target === "root") return contract.style.root;
  if (!Object.hasOwn(contract.style.targets, target)) return undefined;
  return contract.style.targets[target];
}

function ownedProperty(
  target: BrickStyleTargetContract | undefined,
  property: string,
): BrickStylePropertyContract | undefined {
  if (target === undefined || !Object.hasOwn(target.properties, property)) return undefined;
  return target.properties[property];
}

function projectBrick(type: BrickType) {
  const contract: BrickContractEntry = BRICK_CONTRACT[type];
  const projection = {
    name: contract.name,
    description: contract.description,
    useWhen: contract.useWhen,
    ...(contract.avoidWhen === undefined ? {} : { avoidWhen: contract.avoidWhen }),
    fields: contract.fields,
    supportsActiveWhen: contract.supportsActiveWhen,
    style: {
      root: projectTarget(contract.style.root),
      targets: Object.fromEntries(
        Object.entries(contract.style.targets).map(([name, target]) => [
          name,
          projectTarget(target),
        ]),
      ),
    },
  };
  return deepFreeze(structuredClone(projection));
}

function okRead(
  tool: "get_brick_spec" | "get_style_choices" | "get_preset" | "get_pattern",
  message: string,
  nextAction: string,
  exactData: unknown,
  shadow: FacetTree,
): StageToolOkResult {
  const observation = formatAssetObservation(
    {
      tool,
      status: "ok",
      outcome: "no_stage_change",
      message,
      applied: false,
      stageChanged: false,
      visibleToVisitor: false,
      patchCount: 0,
      changedNodeIds: [],
      warnings: [],
      nextAction,
      summary: "no stage changes",
    },
    JSON.stringify(exactData),
  );
  return {
    status: "ok",
    observation,
    messages: [],
    patches: [],
    changedNodeIds: [],
    patchCount: 0,
    summary: "no stage changes",
    shadow,
    issues: [],
  };
}

function rejectedRead(
  tool: "get_brick_spec" | "get_style_choices" | "get_preset" | "get_pattern",
  code: StageToolErrorCode,
  message: string,
  nextAction: string,
  shadow: FacetTree,
): StageToolErrorResult {
  return {
    status: "error",
    code,
    observation: formatAgentToolObservation({
      tool,
      status: "error",
      outcome: "rejected",
      code,
      message,
      applied: false,
      stageChanged: false,
      visibleToVisitor: false,
      patchCount: 0,
      changedNodeIds: [],
      warnings: [],
      nextAction,
      summary: "no stage changes",
    }),
    messages: [],
    patches: [],
    changedNodeIds: [],
    patchCount: 0,
    summary: "no stage changes",
    shadow,
    issues: [],
  };
}

/** Read one compact Brick detail projection from Core's sole contract. */
export function executeGetBrickSpec(
  input: Input,
  shadow: FacetTree,
  _assets: StageToolAssets,
): StageToolOkResult | StageToolErrorResult {
  if (!safeExactKeys(input, ["type"])) {
    return rejectedRead(
      "get_brick_spec",
      "invalid_input",
      "get_brick_spec requires exactly one type field.",
      "Pass one exact Brick type from the Brick index.",
      shadow,
    );
  }
  const type = safeRead(input, "type");
  if (!isBrickType(type)) {
    return rejectedRead(
      "get_brick_spec",
      "invalid_input",
      "get_brick_spec requires one exact Brick type.",
      "Choose one exact type from the Brick index and retry.",
      shadow,
    );
  }

  return okRead(
    "get_brick_spec",
    "Read one exact compact Core Brick specification.",
    "Author only these fields and style properties; query an unfamiliar value with get_style_choices.",
    projectBrick(type),
    shadow,
  );
}

/** Read choices for one exact Brick-owned style property; never a global token lookup. */
export function executeGetStyleChoices(
  input: Input,
  shadow: FacetTree,
  _assets: StageToolAssets,
): StageToolOkResult | StageToolErrorResult {
  if (!safeExactKeys(input, ["brick", "target", "property"])) {
    return rejectedRead(
      "get_style_choices",
      "invalid_input",
      "get_style_choices requires exactly brick, target, and property.",
      "Pass one exact local style path from get_brick_spec.",
      shadow,
    );
  }
  const brick = safeRead(input, "brick");
  const target = safeRead(input, "target");
  const propertyName = safeRead(input, "property");
  if (
    !isBrickType(brick) ||
    typeof target !== "string" ||
    !isValidThemeName(target) ||
    typeof propertyName !== "string" ||
    !isValidThemeName(propertyName)
  ) {
    return rejectedRead(
      "get_style_choices",
      "invalid_input",
      "get_style_choices requires one exact Brick-owned style path.",
      "Pass brick, target, and property exactly as returned by get_brick_spec.",
      shadow,
    );
  }

  const property = ownedProperty(ownedTarget(BRICK_CONTRACT[brick], target), propertyName);
  if (property === undefined) {
    return rejectedRead(
      "get_style_choices",
      "not_available",
      "The requested local style choices are not available.",
      "Choose one exact Brick, target, and property path from get_brick_spec.",
      shadow,
    );
  }
  const domain = propertyValueDomain(property);
  return okRead(
    "get_style_choices",
    "Read one exact local style value set.",
    "Choose one allowed value for this exact Brick-owned property.",
    {
      brick,
      target,
      property: propertyName,
      description: property.description,
      useWhen: property.useWhen,
      source: property.source,
      valueSetDescription: domain.description,
      choiceFields: ["name", "description", "useWhen", "avoidWhen?"],
      choices: domain.values.map(choiceTuple),
    },
    shadow,
  );
}

/** Read one exact same-Brick Preset from the immutable turn snapshot. */
export function executeGetPreset(
  input: Input,
  shadow: FacetTree,
  assets: StageToolAssets,
): StageToolOkResult | StageToolErrorResult {
  if (!safeExactKeys(input, ["brick", "name"])) {
    return rejectedRead(
      "get_preset",
      "invalid_input",
      "get_preset requires exactly brick and name.",
      "Pass one exact Brick and Preset name from the active Preset index.",
      shadow,
    );
  }
  const brick = safeRead(input, "brick");
  const name = exactName(input);
  if (!isBrickType(brick) || name === undefined) {
    return rejectedRead(
      "get_preset",
      "invalid_input",
      "get_preset requires one exact Brick and a valid non-empty Preset name.",
      "Pass one exact Brick and Preset name from the active Preset index.",
      shadow,
    );
  }

  const presets = assets.theme.presets?.[brick] as Readonly<Record<string, unknown>> | undefined;
  const preset = presets?.[name];
  if (preset === undefined) {
    return rejectedRead(
      "get_preset",
      "not_available",
      "The requested Preset is not available in this turn snapshot.",
      "Choose an exact Brick and Preset name from the active Preset index.",
      shadow,
    );
  }

  return okRead(
    "get_preset",
    "Read one exact unresolved Preset.",
    "Apply it only to a Brick of the requested type; direct style may override specific choices.",
    preset,
    shadow,
  );
}

/** Read one exact compatible Pattern from the immutable turn snapshot. */
export function executeGetPattern(
  input: Input,
  shadow: FacetTree,
  assets: StageToolAssets,
): StageToolOkResult | StageToolErrorResult {
  if (!safeExactKeys(input, ["name"])) {
    return rejectedRead(
      "get_pattern",
      "invalid_input",
      "get_pattern requires exactly one name field.",
      "Pass one exact name from the active Pattern index.",
      shadow,
    );
  }
  const name = exactName(input);
  if (name === undefined) {
    return rejectedRead(
      "get_pattern",
      "invalid_input",
      "get_pattern requires one valid non-empty Pattern name.",
      "Pass one exact name from the active Pattern index.",
      shadow,
    );
  }

  const pattern = selectPatternReference(assets.patterns, name);
  if (pattern === undefined) {
    return rejectedRead(
      "get_pattern",
      "not_available",
      "The requested Pattern is not available in this turn snapshot.",
      "Choose an exact name from the active Pattern index.",
      shadow,
    );
  }

  return okRead(
    "get_pattern",
    "Read one exact unresolved Pattern.",
    "Adapt the reference and author ordinary native Bricks separately; do not insert it blindly.",
    pattern,
    shadow,
  );
}
