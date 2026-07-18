import {
  BRICK_TYPES,
  type BoxNode,
  type BrickType,
  type ChartNode,
  type FacetNode,
  type FacetTree,
  type InputNode,
  type KeyValueNode,
  type ListNode,
  type LoadingNode,
  type MediaNode,
  type ProgressNode,
  type RichTextNode,
  type TableNode,
  type TextNode,
} from "@facet/core";

export interface BrickCatalogSample {
  readonly brick: BrickType;
  readonly nodeId: string;
  readonly tree: FacetTree;
}

export type BrickSampleConstructor = (preset?: string) => BrickCatalogSample;

interface OptionalPresetStyle {
  readonly style?: { readonly preset: string };
}

function presetStyle(preset: string | undefined): OptionalPresetStyle {
  return preset === undefined ? {} : { style: { preset } };
}

function leafSample(brick: Exclude<BrickType, "box">, node: FacetNode): BrickCatalogSample {
  const root: BoxNode = { id: "root", type: "box", children: [node.id] };
  return {
    brick,
    nodeId: node.id,
    tree: { root: root.id, nodes: { [root.id]: root, [node.id]: node } },
  };
}

function boxSample(preset?: string): BrickCatalogSample {
  const child: TextNode = { id: "box-content", type: "text", value: "Box content" };
  const root: BoxNode = {
    id: "root",
    type: "box",
    children: [child.id],
    ...presetStyle(preset),
  };
  return {
    brick: "box",
    nodeId: root.id,
    tree: { root: root.id, nodes: { root, [child.id]: child } },
  };
}

function textSample(preset?: string): BrickCatalogSample {
  const node: TextNode = {
    id: "sample-text",
    type: "text",
    value: "A concise text Brick sample.",
    ...presetStyle(preset),
  };
  return leafSample("text", node);
}

function mediaSample(preset?: string): BrickCatalogSample {
  const node: MediaNode = {
    id: "sample-media",
    type: "media",
    kind: "image",
    src: "https://example.com/facet-catalog.png",
    alt: "Catalog media sample",
    ...presetStyle(preset),
  };
  return leafSample("media", node);
}

function inputSample(preset?: string): BrickCatalogSample {
  const node: InputNode = {
    id: "sample-input",
    type: "input",
    name: "catalog_email",
    input: "email",
    label: "Email",
    placeholder: "you@example.com",
    ...presetStyle(preset),
  };
  return leafSample("input", node);
}

function richTextSample(preset?: string): BrickCatalogSample {
  const node: RichTextNode = {
    id: "sample-richtext",
    type: "richtext",
    blocks: [
      {
        type: "paragraph",
        runs: [
          { text: "Rich text can mix " },
          { text: "emphasis", marks: [{ kind: "bold" }] },
          { text: " safely." },
        ],
      },
    ],
    ...presetStyle(preset),
  };
  return leafSample("richtext", node);
}

function tableSample(preset?: string): BrickCatalogSample {
  const node: TableNode = {
    id: "sample-table",
    type: "table",
    caption: "Release status",
    columns: [
      { key: "package", label: "Package" },
      { key: "status", label: "Status" },
    ],
    rows: [{ package: "@facet/core", status: "Ready" }],
    ...presetStyle(preset),
  };
  return leafSample("table", node);
}

function chartSample(preset?: string): BrickCatalogSample {
  const node: ChartNode = {
    id: "sample-chart",
    type: "chart",
    kind: "bar",
    title: "Weekly activity",
    labels: ["Mon", "Tue", "Wed"],
    series: [{ label: "Runs", values: [4, 7, 5] }],
    ...presetStyle(preset),
  };
  return leafSample("chart", node);
}

function listSample(preset?: string): BrickCatalogSample {
  const node: ListNode = {
    id: "sample-list",
    type: "list",
    items: [
      { title: "Inspect", body: "Read the package-owned definition." },
      { title: "Render", body: "Preview the native Brick." },
    ],
    ...presetStyle(preset),
  };
  return leafSample("list", node);
}

function keyValueSample(preset?: string): BrickCatalogSample {
  const node: KeyValueNode = {
    id: "sample-key-value",
    type: "keyValue",
    items: [
      { label: "Source", value: "Package exports" },
      { label: "Status", value: "Validated" },
    ],
    ...presetStyle(preset),
  };
  return leafSample("keyValue", node);
}

function progressSample(preset?: string): BrickCatalogSample {
  const node: ProgressNode = {
    id: "sample-progress",
    type: "progress",
    value: 62,
    label: "Catalog coverage",
    ...presetStyle(preset),
  };
  return leafSample("progress", node);
}

function loadingSample(preset?: string): BrickCatalogSample {
  const node: LoadingNode = {
    id: "sample-loading",
    type: "loading",
    label: "Loading package assets",
    ...presetStyle(preset),
  };
  return leafSample("loading", node);
}

export const BRICK_SAMPLE_CONSTRUCTORS = {
  box: boxSample,
  text: textSample,
  media: mediaSample,
  input: inputSample,
  richtext: richTextSample,
  table: tableSample,
  chart: chartSample,
  list: listSample,
  keyValue: keyValueSample,
  progress: progressSample,
  loading: loadingSample,
} satisfies Record<BrickType, BrickSampleConstructor>;

function isBrickType(value: string): value is BrickType {
  return BRICK_TYPES.some((brick) => brick === value);
}

export function createBrickSample(brick: string, preset?: string): BrickCatalogSample | undefined {
  if (!isBrickType(brick)) return undefined;
  return BRICK_SAMPLE_CONSTRUCTORS[brick](preset);
}
