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

function presetAction(
  preset: string | undefined,
): Pick<BoxNode, "onPress"> | Record<string, never> {
  if (preset === "primaryAction") {
    return { onPress: { kind: "agent", name: "catalog_primary_action" } };
  }
  if (preset === "secondaryAction") {
    return { onPress: { kind: "agent", name: "catalog_secondary_action" } };
  }
  return {};
}

function styledText(id: string, value: string, preset?: string): TextNode {
  return {
    id,
    type: "text",
    value,
    ...(preset === undefined ? {} : { style: { preset } }),
  };
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
  const childPreset =
    preset === "primaryAction" || preset === "secondaryAction"
      ? "actionLabel"
      : preset === "badge"
        ? "badge"
        : preset === "successBadge"
          ? "successBadge"
          : preset === "warningBadge"
            ? "warningBadge"
            : preset === "dangerBadge"
              ? "dangerBadge"
              : undefined;
  const childValue =
    preset === "primaryAction"
      ? "Continue"
      : preset === "secondaryAction"
        ? "View details"
        : preset === "successBadge"
          ? "Ready"
          : preset === "warningBadge"
            ? "Needs review"
            : preset === "dangerBadge"
              ? "Blocked"
              : preset === "badge"
                ? "Beta"
                : "Box content";
  const child = styledText("box-content", childValue, childPreset);
  const alertTitlePreset =
    preset === "infoAlert"
      ? "infoAlert"
      : preset === "successAlert"
        ? "successAlert"
        : preset === "warningAlert"
          ? "warningAlert"
          : preset === "dangerAlert"
            ? "dangerAlert"
            : undefined;
  const alertTitle =
    preset === "infoAlert"
      ? "Catalog updated"
      : preset === "successAlert"
        ? "Render passed"
        : preset === "warningAlert"
          ? "Review contrast"
          : preset === "dangerAlert"
            ? "Provider failed"
            : undefined;
  const alertBody =
    preset === "infoAlert"
      ? "The local package definitions are loaded."
      : preset === "successAlert"
        ? "Every required preview rendered successfully."
        : preset === "warningAlert"
          ? "One visual token needs owner review before release."
          : preset === "dangerAlert"
            ? "The sample run stopped before producing a usable stage."
            : undefined;
  const nodes: Record<string, FacetNode> = { [child.id]: child };
  const children =
    alertTitle === undefined || alertBody === undefined
      ? [child.id]
      : ["box-alert-title", "box-alert-body"];
  if (alertTitle !== undefined && alertBody !== undefined) {
    const title = styledText("box-alert-title", alertTitle, alertTitlePreset);
    const body = styledText("box-alert-body", alertBody);
    nodes[title.id] = title;
    nodes[body.id] = body;
  }
  const root: BoxNode = {
    id: "root",
    type: "box",
    children,
    ...presetStyle(preset),
    ...presetAction(preset),
  };
  return {
    brick: "box",
    nodeId: root.id,
    tree: { root: root.id, nodes: { root, ...nodes } },
  };
}

function textSample(preset?: string): BrickCatalogSample {
  const value =
    preset === "heading"
      ? "Catalog coverage"
      : preset === "subheading"
        ? "Renderer states"
        : preset === "body"
          ? "Every preview uses the package-owned renderer."
          : preset === "muted"
            ? "Updated 2 minutes ago"
            : preset === "eyebrow"
              ? "Catalog"
              : preset === "metric"
                ? "62%"
                : preset === "actionLabel"
                  ? "Continue"
                  : preset === "successBadge"
                    ? "Ready"
                    : preset === "warningBadge"
                      ? "Needs review"
                      : preset === "dangerBadge"
                        ? "Blocked"
                        : preset === "badge"
                          ? "Beta"
                          : preset === "infoAlert"
                            ? "Catalog updated"
                            : preset === "successAlert"
                              ? "Render passed"
                              : preset === "warningAlert"
                                ? "Review contrast"
                                : preset === "dangerAlert"
                                  ? "Provider failed"
                                  : "A concise text Brick sample.";
  const node = styledText("sample-text", value, preset);
  return leafSample("text", node);
}

function mediaSample(preset?: string): BrickCatalogSample {
  const node: MediaNode = {
    id: "sample-media",
    type: "media",
    kind: "image",
    src: preset === "thumbnail" ? "/facet-catalog-thumbnail.svg" : "/facet-catalog.svg",
    alt: "Catalog media sample",
    ...presetStyle(preset),
  };
  return leafSample("media", node);
}

function inputSample(preset?: string): BrickCatalogSample {
  const nameInput: InputNode = {
    id: "sample-input-name",
    type: "input",
    name: "catalog_name",
    input: "text",
    label: "Name",
    placeholder: "Ada Lovelace",
    ...presetStyle(preset),
  };
  const emailInput: InputNode = {
    id: "sample-input-email",
    type: "input",
    name: "catalog_email",
    input: "email",
    label: "Email",
    placeholder: "you@example.com",
    ...presetStyle(preset),
  };
  const planInput: InputNode = {
    id: "sample-input-plan",
    type: "input",
    name: "catalog_plan",
    input: "select",
    label: "Plan",
    options: ["Starter", "Pro", "Enterprise"],
    ...presetStyle(preset),
  };
  const consentInput: InputNode = {
    id: "sample-input-consent",
    type: "input",
    name: "catalog_consent",
    input: "checkbox",
    label: "Send me release notes",
    ...presetStyle(preset),
  };
  const root: BoxNode = {
    id: "root",
    type: "box",
    children: [nameInput.id, emailInput.id, planInput.id, consentInput.id],
    style: { direction: "column", gap: "sm" },
  };
  return {
    brick: "input",
    nodeId: nameInput.id,
    tree: {
      root: root.id,
      nodes: {
        [root.id]: root,
        [nameInput.id]: nameInput,
        [emailInput.id]: emailInput,
        [planInput.id]: planInput,
        [consentInput.id]: consentInput,
      },
    },
  };
}

function richTextSample(preset?: string): BrickCatalogSample {
  const node: RichTextNode = {
    id: "sample-richtext",
    type: "richtext",
    blocks: [
      {
        type: "heading",
        level: 2,
        runs: [{ text: "Rich text renderer states" }],
      },
      {
        type: "paragraph",
        runs: [
          { text: "Rich text can mix " },
          { text: "emphasis", marks: [{ kind: "bold" }] },
          { text: ", inline code", marks: [{ kind: "code" }] },
          { text: ", and safe links" },
          {
            text: " in one flowing paragraph.",
            marks: [{ kind: "link", target: { href: "https://facet.local/catalog" } }],
          },
        ],
      },
      {
        type: "listItem",
        depth: 1,
        runs: [{ text: "Nested list copy keeps a visible indent without raw CSS." }],
      },
      {
        type: "quote",
        runs: [{ text: "Quoted copy should stay visually distinct from body text." }],
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
      { key: "package", label: "Package", sortable: true },
      { key: "status", label: "Status", sortable: true },
      { key: "coverage", label: "Coverage" },
    ],
    rows: [
      { package: "@facet/core", status: "Ready", coverage: "Contract" },
      { package: "@facet/react", status: "Review", coverage: "Renderer" },
      { package: "@facet/lab", status: "Sampled", coverage: "Catalog" },
    ],
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
    labels: ["Mon", "Tue", "Wed", "Thu"],
    series: [
      { label: "Runs", values: [4, 7, 5, 8] },
      { label: "Reviews", values: [2, 4, 3, 6] },
    ],
    ...presetStyle(preset),
  };
  return leafSample("chart", node);
}

function listSample(preset?: string): BrickCatalogSample {
  const node: ListNode = {
    id: "sample-list",
    type: "list",
    items: [
      {
        title: "Inspect",
        body: "Read the package-owned definition, then compare the validated example against the rendered preview so wrapping and marker alignment stay visible.",
      },
      {
        title: "Render",
        body: "Preview the native Brick in desktop, tablet, mobile, light, and dark surfaces.",
      },
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
      {
        label: "Source",
        value:
          "Package exports are reflected directly in Lab; no handwritten roster decides what exists.",
      },
      {
        label: "Status",
        value:
          "Validated sample with intentionally long copy so compact grid alignment and wrapping are visible.",
      },
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
