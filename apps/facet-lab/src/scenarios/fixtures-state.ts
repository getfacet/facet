import type { FacetTree, JsonPatchOperation } from "@facet/core";

export const LIFECYCLE_STATE_ORDER = ["loading", "empty", "error", "result"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATE_ORDER)[number];

export interface LifecycleStateStep {
  readonly state: LifecycleState;
  readonly tree: FacetTree;
}

export interface LifecycleTransition {
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly tree: FacetTree;
  readonly patches: readonly JsonPatchOperation[];
}

const LOADING_TREE = {
  root: "state-root",
  nodes: {
    "state-root": {
      id: "state-root",
      type: "box",
      children: ["state-heading", "state-loading"],
    },
    "state-heading": {
      id: "state-heading",
      type: "text",
      value: "Preparing your results",
    },
    "state-loading": {
      id: "state-loading",
      type: "loading",
      label: "Loading the latest information",
    },
  },
} as const satisfies FacetTree;

const EMPTY_TREE = {
  root: "state-root",
  nodes: {
    "state-root": {
      id: "state-root",
      type: "box",
      children: ["state-heading", "state-message"],
    },
    "state-heading": {
      id: "state-heading",
      type: "text",
      value: "No results yet",
    },
    "state-message": {
      id: "state-message",
      type: "text",
      value: "Try another request or adjust the available filters.",
    },
  },
} as const satisfies FacetTree;

const ERROR_TREE = {
  root: "state-root",
  nodes: {
    "state-root": {
      id: "state-root",
      type: "box",
      children: ["state-heading", "state-message", "state-retry"],
    },
    "state-heading": {
      id: "state-heading",
      type: "text",
      value: "Results are temporarily unavailable",
    },
    "state-message": {
      id: "state-message",
      type: "text",
      value: "The request could not be completed. Your previous work is unchanged.",
    },
    "state-retry": {
      id: "state-retry",
      type: "box",
      children: ["state-retry-label"],
      onPress: { kind: "agent", name: "retry_lifecycle_fixture" },
    },
    "state-retry-label": {
      id: "state-retry-label",
      type: "text",
      value: "Retry",
    },
  },
} as const satisfies FacetTree;

const RESULT_TREE = {
  root: "state-root",
  nodes: {
    "state-root": {
      id: "state-root",
      type: "box",
      children: ["state-heading", "state-summary"],
    },
    "state-heading": {
      id: "state-heading",
      type: "text",
      value: "Results ready",
    },
    "state-summary": {
      id: "state-summary",
      type: "keyValue",
      items: [
        { label: "Status", value: "Complete" },
        { label: "Records", value: "3" },
      ],
    },
  },
} as const satisfies FacetTree;

export const LIFECYCLE_STATE_STEPS = [
  { state: "loading", tree: LOADING_TREE },
  { state: "empty", tree: EMPTY_TREE },
  { state: "error", tree: ERROR_TREE },
  { state: "result", tree: RESULT_TREE },
] as const satisfies readonly LifecycleStateStep[];

function replaceTree(tree: FacetTree): readonly JsonPatchOperation[] {
  return [{ op: "replace", path: "", value: tree }];
}

export const LIFECYCLE_TRANSITIONS = [
  {
    from: "loading",
    to: "empty",
    tree: EMPTY_TREE,
    patches: replaceTree(EMPTY_TREE),
  },
  {
    from: "empty",
    to: "error",
    tree: ERROR_TREE,
    patches: replaceTree(ERROR_TREE),
  },
  {
    from: "error",
    to: "result",
    tree: RESULT_TREE,
    patches: replaceTree(RESULT_TREE),
  },
] as const satisfies readonly LifecycleTransition[];

/** Stable deterministic role consumed by the broader WU-10 scenario fixtures. */
export const LIFECYCLE_FIXTURE = {
  role: "lifecycle-state",
  initialState: "loading",
  initialTree: LOADING_TREE,
  steps: LIFECYCLE_STATE_STEPS,
  transitions: LIFECYCLE_TRANSITIONS,
} as const;
