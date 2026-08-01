import { parseDataPath } from "@facet/core";
import type { FacetToolSession } from "@facet/core";

import {
  executeInsertSubtree,
  executeRemoveSubtree,
  executeRenderPage,
  executeReplaceSubtree,
  executeUpdateNode,
  type MutationToolResult,
} from "./executor-mutations.js";
import {
  executeReadComponentSpec,
  executeReadData,
  executeReadScreen,
  type ReadComponentSpecResult,
  type ReadDataResult,
  type ReadScreenResult,
} from "./executor-reads.js";
import { executePublishData, type PublishDataResult } from "./executor-publish.js";
import type { PublishExecutorInput } from "./executor-publish.js";
import { facetToolInputKeys, type FacetToolName } from "./specs.js";
import type {
  InsertSubtreeInput,
  ReadComponentSpecInput,
  ReadDataInput,
  ReadScreenInput,
  RemoveSubtreeInput,
  RenderPageInput,
  ReplaceSubtreeInput,
  UpdateNodeInput,
} from "./types.js";

export type FacetToolResult =
  | MutationToolResult
  | ReadComponentSpecResult
  | ReadScreenResult
  | ReadDataResult
  | PublishDataResult
  | {
      readonly ok: false;
      readonly code: "unknown_tool" | "invalid_data_path" | "invalid_tool_input";
      readonly detail: string;
    };

type ToolInputReject = Extract<FacetToolResult, { readonly ok: false }>;

function unknownTool(name: string): ToolInputReject {
  return Object.freeze({
    ok: false as const,
    code: "unknown_tool" as const,
    detail: `Unknown Facet tool: ${name}`,
  });
}

function invalidPath(): ToolInputReject {
  return Object.freeze({
    ok: false as const,
    code: "invalid_data_path" as const,
    detail: "publish_data paths use named keys only.",
  });
}

function invalidInput(name: string, detail: string): ToolInputReject {
  return Object.freeze({
    ok: false as const,
    code: "invalid_tool_input" as const,
    detail: `${name} input rejected: ${detail}`,
  });
}

function objectKeys(input: object): readonly string[] | null {
  try {
    if (Array.isArray(input)) {
      return null;
    }
    return Object.keys(input);
  } catch {
    return null;
  }
}

function ownField(
  input: object,
  key: string,
): { readonly ok: true; readonly value: unknown } | null {
  try {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return null;
    }
    return { ok: true as const, value: Reflect.get(input, key) };
  } catch {
    return null;
  }
}

function requireExactObject(
  name: FacetToolName,
  input: unknown,
): { readonly ok: true; readonly input: object } | ToolInputReject {
  if (typeof input !== "object" || input === null) {
    return invalidInput(name, "expected an object with exactly the declared schema keys.");
  }
  const keys = objectKeys(input);
  if (keys === null) {
    return invalidInput(name, "expected an object with exactly the declared schema keys.");
  }
  const expectedKeys = facetToolInputKeys(name);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !expected.has(key));
  if (missing.length > 0) {
    return invalidInput(name, `missing required key ${missing[0]}.`);
  }
  if (extra.length > 0) {
    return invalidInput(name, `unexpected key ${extra[0]}.`);
  }
  return { ok: true as const, input };
}

function readStringField(
  name: string,
  input: object,
  key: string,
): { readonly ok: true; readonly value: string } | ToolInputReject {
  const field = ownField(input, key);
  if (field === null) {
    return invalidInput(name, `missing required key ${key}.`);
  }
  if (typeof field.value !== "string") {
    return invalidInput(name, `${key} must be a string.`);
  }
  return { ok: true as const, value: field.value };
}

function readRequiredField(
  name: string,
  input: object,
  key: string,
): { readonly ok: true; readonly value: unknown } | ToolInputReject {
  const field = ownField(input, key);
  if (field === null) {
    return invalidInput(name, `missing required key ${key}.`);
  }
  return field;
}

function renderPageInput(input: unknown): RenderPageInput | ToolInputReject {
  const checked = requireExactObject("render_page", input);
  if (!checked.ok) {
    return checked;
  }
  const markup = readStringField("render_page", checked.input, "markup");
  return markup.ok ? { markup: markup.value } : markup;
}

function targetedMarkupInput(
  name: "insert_subtree" | "replace_subtree" | "update_node",
  input: unknown,
): InsertSubtreeInput | ReplaceSubtreeInput | UpdateNodeInput | ToolInputReject {
  const checked = requireExactObject(name, input);
  if (!checked.ok) {
    return checked;
  }
  const targetId = readStringField(name, checked.input, "targetId");
  if (!targetId.ok) {
    return targetId;
  }
  const markup = readStringField(name, checked.input, "markup");
  if (!markup.ok) {
    return markup;
  }
  return { targetId: targetId.value, markup: markup.value };
}

function removeSubtreeInput(input: unknown): RemoveSubtreeInput | ToolInputReject {
  const checked = requireExactObject("remove_subtree", input);
  if (!checked.ok) {
    return checked;
  }
  const targetId = readStringField("remove_subtree", checked.input, "targetId");
  return targetId.ok ? { targetId: targetId.value } : targetId;
}

function tagInput(input: unknown): ReadComponentSpecInput | ToolInputReject {
  const checked = requireExactObject("read_component_spec", input);
  if (!checked.ok) {
    return checked;
  }
  const tag = readStringField("read_component_spec", checked.input, "tag");
  return tag.ok ? { tag: tag.value } : tag;
}

function readScreenInput(input: unknown): ReadScreenInput | ToolInputReject {
  const checked = requireExactObject("read_screen", input);
  if (!checked.ok) {
    return checked;
  }
  const screen = readStringField("read_screen", checked.input, "screen");
  return screen.ok ? { screen: screen.value } : screen;
}

function readDataInput(input: unknown): ReadDataInput | ToolInputReject {
  const checked = requireExactObject("read_data", input);
  if (!checked.ok) {
    return checked;
  }
  const path = readStringField("read_data", checked.input, "path");
  return path.ok ? { path: path.value } : path;
}

function publishInput(input: unknown): PublishExecutorInput | ToolInputReject {
  const checked = requireExactObject("publish_data", input);
  if (!checked.ok) {
    return checked;
  }
  const pathText = readStringField("publish_data", checked.input, "path");
  if (!pathText.ok) {
    return pathText;
  }
  const path = parseDataPath(pathText.value);
  if (path === null) {
    return invalidPath();
  }
  const value = readRequiredField("publish_data", checked.input, "value");
  if (!value.ok) {
    return value;
  }
  return { path, value: value.value };
}

export async function executeFacetTool(
  name: FacetToolName | string,
  input: unknown,
  session: FacetToolSession,
): Promise<FacetToolResult> {
  switch (name) {
    case "render_page": {
      const checked = renderPageInput(input);
      return "markup" in checked ? executeRenderPage(checked, session) : checked;
    }
    case "insert_subtree": {
      const checked = targetedMarkupInput("insert_subtree", input);
      return "targetId" in checked ? executeInsertSubtree(checked, session) : checked;
    }
    case "replace_subtree": {
      const checked = targetedMarkupInput("replace_subtree", input);
      return "targetId" in checked ? executeReplaceSubtree(checked, session) : checked;
    }
    case "update_node": {
      const checked = targetedMarkupInput("update_node", input);
      return "targetId" in checked ? executeUpdateNode(checked, session) : checked;
    }
    case "remove_subtree": {
      const checked = removeSubtreeInput(input);
      return "targetId" in checked ? executeRemoveSubtree(checked, session) : checked;
    }
    case "read_component_spec": {
      const checked = tagInput(input);
      return "tag" in checked ? executeReadComponentSpec(checked, session) : checked;
    }
    case "read_screen": {
      const checked = readScreenInput(input);
      return "screen" in checked ? executeReadScreen(checked, session) : checked;
    }
    case "read_data": {
      const checked = readDataInput(input);
      return "path" in checked ? executeReadData(checked, session) : checked;
    }
    case "publish_data": {
      const resolved = publishInput(input);
      return "ok" in resolved ? resolved : executePublishData(resolved, session);
    }
    default:
      return unknownTool(name);
  }
}
