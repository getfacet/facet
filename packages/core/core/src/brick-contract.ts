/** The sole closed roster of native Bricks an agent may author. */
export const BRICK_TYPES = [
  "box",
  "text",
  "media",
  "input",
  "richtext",
  "table",
  "chart",
  "list",
  "keyValue",
  "progress",
  "loading",
] as const;

export type BrickType = (typeof BRICK_TYPES)[number];

/** Closed input kinds shared by the node type and target applicability metadata. */
export const INPUT_KINDS = [
  "text",
  "number",
  "email",
  "password",
  "search",
  "checkbox",
  "radio",
  "select",
  "switch",
] as const;

export type InputKind = (typeof INPUT_KINDS)[number];

export type StyleValueSource = "token" | "fixed";

export interface BrickFieldContract {
  readonly required: boolean;
  readonly description: string;
}

export interface BrickStylePropertyContract {
  readonly source: StyleValueSource;
  readonly domain: string;
  readonly description: string;
  readonly useWhen: string;
}

export interface BrickStyleTargetContract {
  readonly properties: Readonly<Record<string, BrickStylePropertyContract>>;
  readonly states?: Readonly<Record<string, readonly string[]>>;
  readonly applicableTo?: readonly InputKind[];
}

export interface BrickContractEntry {
  readonly name: BrickType;
  readonly description: string;
  readonly useWhen: string;
  readonly avoidWhen?: string;
  readonly fields: Readonly<Record<string, BrickFieldContract>>;
  readonly supportsActiveWhen: boolean;
  readonly style: {
    readonly root: BrickStyleTargetContract;
    readonly targets: Readonly<Record<string, BrickStyleTargetContract>>;
  };
}

type Domain = `token:${string}` | `fixed:${string}`;

const property = (domain: Domain, name: string): BrickStylePropertyContract => {
  const separator = domain.indexOf(":");
  return {
    source: domain.slice(0, separator) as StyleValueSource,
    domain: domain.slice(separator + 1),
    description: `Controls the Brick's ${name} style choice.`,
    useWhen: `Use ${name} when this Brick needs that deliberate visual treatment.`,
  };
};

const properties = <const T extends Readonly<Record<string, Domain>>>(values: T) =>
  Object.fromEntries(
    Object.entries(values).map(([name, domain]) => [name, property(domain, name)]),
  ) as {
    readonly [K in keyof T]: BrickStylePropertyContract;
  };

const field = (required: boolean, description: string): BrickFieldContract => ({
  required,
  description,
});

const id = field(true, "Stable node identifier within the Facet tree.");
const type = field(true, "Exact native Brick type discriminant.");

const typography = {
  fontFamily: "token:fontFamily",
  fontSize: "token:fontSize",
  fontWeight: "token:fontWeight",
  fontStyle: "fixed:fontStyle",
  color: "token:color",
  textAlign: "fixed:textAlign",
  letterSpacing: "token:letterSpacing",
  lineHeight: "token:lineHeight",
} as const;

const textFlow = {
  textWrap: "fixed:textWrap",
  lineClamp: "fixed:lineClamp",
} as const;

const flowTypography = {
  ...typography,
  ...textFlow,
} as const;

const boxRoot = properties({
  direction: "fixed:direction",
  gap: "token:space",
  padding: "token:space",
  alignItems: "fixed:alignment",
  justifyContent: "fixed:justification",
  wrap: "fixed:boolean",
  columns: "fixed:columns",
  grow: "fixed:boolean",
  width: "fixed:width",
  minHeight: "token:minHeight",
  maxWidth: "token:maxWidth",
  scroll: "fixed:scroll",
  sticky: "fixed:boolean",
  background: "token:color",
  color: "token:color",
  backgroundGradient: "token:gradient",
  borderColor: "token:color",
  borderWidth: "token:borderWidth",
  borderRadius: "token:radius",
  shadow: "token:shadow",
  backdropScrim: "token:scrim",
  enterAnimation: "fixed:enterAnimation",
});

const textRoot = properties({ ...flowTypography, highlight: "token:highlight" });

const surface = {
  background: "token:color",
  color: "token:color",
  borderColor: "token:color",
  borderWidth: "token:borderWidth",
  borderRadius: "token:radius",
  shadow: "token:shadow",
} as const;

const labelTarget = { properties: properties(typography) };
const flowLabelTarget = { properties: properties(flowTypography) };

const BRICK_CONTRACT_VALUE = {
  box: {
    name: "box",
    description: "The sole container Brick for safe flow layout, surfaces, and actions.",
    useWhen: "Use for grouping, spacing, layout, panels, or a pressable action surface.",
    fields: {
      id,
      type,
      children: field(true, "Ordered child node identifiers owned by this container."),
      onPress: field(false, "Optional closed action dispatched by a normal press."),
      onHold: field(false, "Optional secondary closed action dispatched by a long press."),
      hidden: field(false, "Content-authored initial visibility flag."),
      backdrop: field(false, "Media node identifier used as a bounded background layer."),
      overlay: field(false, "Renderer-owned modal or drawer placement descriptor."),
      activeWhen: field(false, "Closed local view predicate controlling style.active."),
    },
    supportsActiveWhen: true,
    style: {
      root: {
        properties: boxRoot,
        states: {
          hover: ["background", "color", "borderColor", "shadow"],
          pressed: ["background", "color", "borderColor", "shadow"],
          focus: ["borderColor", "borderWidth", "shadow"],
        },
      },
      targets: {},
    },
  },
  text: {
    name: "text",
    description: "A single flowing text value with bounded typography and data binding.",
    useWhen: "Use for labels, headings, body copy, metrics, and other plain text runs.",
    fields: {
      id,
      type,
      value: field(true, "Inline text used when no dataset binding supplies a value."),
      from: field(false, "Optional dataset name for a single-cell binding."),
      column: field(false, "Dataset column selected by the binding."),
      row: field(false, "Dataset row selected by the binding."),
      activeWhen: field(false, "Closed local view predicate controlling style.active."),
    },
    supportsActiveWhen: true,
    style: { root: { properties: textRoot }, targets: {} },
  },
  media: {
    name: "media",
    description: "A safe image, video, or closed icon Brick rendered by the renderer.",
    useWhen: "Use when the interface needs an image, illustration, bounded video, or icon.",
    fields: {
      id,
      type,
      kind: field(true, "Closed image, video, or icon media kind."),
      src: field(false, "Gated media source URL for image and video media."),
      icon: field(false, "Closed icon name from Core's fixed media icon vocabulary."),
      alt: field(false, "Accessible alternative text for image or icon media."),
      poster: field(false, "Gated poster source for video media."),
      controls: field(false, "Whether renderer-owned video controls are visible."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          width: "fixed:width",
          aspectRatio: "token:aspectRatio",
          objectFit: "fixed:objectFit",
          objectPosition: "fixed:objectPosition",
          iconSize: "token:indicatorSize",
          padding: "token:space",
          background: "token:color",
          color: "token:color",
          borderColor: "token:color",
          borderWidth: "token:borderWidth",
          borderRadius: "token:radius",
        }),
      },
      targets: {},
    },
  },
  input: {
    name: "input",
    description: "A renderer-owned form control with closed input-kind behavior.",
    useWhen: "Use to collect a named text, numeric, choice, or boolean field value.",
    fields: {
      id,
      type,
      name: field(true, "Stable field name used when values are collected."),
      input: field(false, "Closed renderer-owned input kind."),
      options: field(false, "Closed choice labels for select or radio input kinds."),
      label: field(false, "Human-readable control label."),
      placeholder: field(false, "Short hint shown when the control has no value."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          width: "fixed:width",
          direction: "fixed:direction",
          gap: "token:space",
          alignItems: "fixed:alignment",
        }),
      },
      targets: {
        label: labelTarget,
        control: {
          properties: properties({
            ...typography,
            padding: "token:space",
            controlHeight: "token:controlHeight",
            ...surface,
          }),
          states: {
            hover: ["background", "color", "borderColor", "shadow"],
            focus: ["borderColor", "borderWidth", "shadow"],
          },
        },
        placeholder: {
          properties: properties({ color: "token:color", fontStyle: "fixed:fontStyle" }),
          applicableTo: ["text", "number", "email", "password", "search", "select"],
        },
        indicator: {
          properties: properties({
            color: "token:color",
            background: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
            borderRadius: "token:radius",
            indicatorSize: "token:indicatorSize",
          }),
          states: {
            checked: ["color", "background", "borderColor"],
            focus: ["borderColor", "borderWidth"],
          },
          applicableTo: ["checkbox", "radio", "switch"],
        },
        option: {
          properties: properties({ gap: "token:space", ...typography }),
          states: { checked: ["color", "fontWeight"], hover: ["color", "fontWeight"] },
          applicableTo: ["radio", "select"],
        },
      },
    },
  },
  richtext: {
    name: "richtext",
    description: "Flowing structured prose made from closed blocks, runs, and marks.",
    useWhen: "Use for mixed-format prose that a single plain text Brick cannot express.",
    fields: { id, type, blocks: field(true, "Ordered structured prose blocks and marked runs.") },
    supportsActiveWhen: false,
    style: {
      root: { properties: properties({ ...flowTypography, blockGap: "token:space" }) },
      targets: {
        heading1: labelTarget,
        heading2: labelTarget,
        heading3: labelTarget,
        quote: {
          properties: properties({
            ...typography,
            background: "token:color",
            padding: "token:space",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
          }),
        },
        code: {
          properties: properties({
            ...typography,
            background: "token:color",
            padding: "token:space",
            borderRadius: "token:radius",
          }),
        },
        link: {
          properties: properties({ ...typography, highlight: "token:highlight" }),
          states: {
            hover: ["color", "highlight"],
            pressed: ["color", "highlight"],
            focus: ["color", "highlight"],
          },
        },
        listMarker: {
          properties: properties({
            color: "token:color",
            fontSize: "token:fontSize",
            fontWeight: "token:fontWeight",
          }),
        },
      },
    },
  },
  table: {
    name: "table",
    description: "A bounded display-only table with renderer-owned row and cell behavior.",
    useWhen: "Use for comparable records whose labeled columns matter to the reader.",
    fields: {
      id,
      type,
      columns: field(
        true,
        "Closed column descriptors, including optional text alignment and closed width choice.",
      ),
      rows: field(true, "Inline display records used without a dataset binding."),
      caption: field(false, "Accessible title describing the table."),
      emptyLabel: field(false, "Optional label rendered when the table resolves zero rows."),
      from: field(false, "Optional dataset supplying projected table rows."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          width: "fixed:width",
          dividers: "fixed:dividers",
          stickyHeader: "fixed:boolean",
          background: "token:color",
          color: "token:color",
          borderColor: "token:color",
          borderWidth: "token:borderWidth",
          borderRadius: "token:radius",
          shadow: "token:shadow",
        }),
      },
      targets: {
        caption: {
          properties: properties({
            ...flowTypography,
            padding: "token:space",
            background: "token:color",
          }),
        },
        header: {
          properties: properties({
            ...flowTypography,
            padding: "token:space",
            background: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
          }),
          states: {
            hover: ["background", "color", "borderColor"],
            pressed: ["background", "color", "borderColor"],
            focus: ["borderColor", "borderWidth"],
            sorted: ["background", "color", "fontWeight"],
          },
        },
        row: {
          properties: properties({
            background: "token:color",
            color: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
          }),
          states: {
            alternate: ["background", "color", "borderColor", "borderWidth"],
            hover: ["background", "color", "borderColor", "borderWidth"],
          },
        },
        cell: {
          properties: properties({
            ...flowTypography,
            padding: "token:space",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
          }),
        },
      },
    },
  },
  chart: {
    name: "chart",
    description: "A bounded renderer-owned bar, line, or donut data visualization.",
    useWhen: "Use to communicate a trend, distribution, or comparison visually.",
    fields: {
      id,
      type,
      kind: field(true, "Closed bar, line, or donut chart kind."),
      series: field(
        true,
        "Inline named numeric series with optional closed line style and axis choice.",
      ),
      labels: field(false, "Optional labels shared by the chart series."),
      title: field(false, "Short human-readable chart title."),
      from: field(false, "Optional dataset projected into numeric chart series."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          width: "fixed:width",
          gap: "token:space",
          padding: "token:space",
          background: "token:color",
          borderColor: "token:color",
          borderWidth: "token:borderWidth",
          borderRadius: "token:radius",
          shadow: "token:shadow",
        }),
      },
      targets: {
        title: labelTarget,
        plot: {
          properties: properties({
            background: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
            borderRadius: "token:radius",
            axisColor: "token:color",
            gridColor: "token:color",
            labelColor: "token:color",
          }),
        },
        series: {
          properties: properties({
            color1: "token:color",
            color2: "token:color",
            color3: "token:color",
            color4: "token:color",
            color5: "token:color",
            color6: "token:color",
            thickness: "token:chartThickness",
          }),
        },
      },
    },
  },
  list: {
    name: "list",
    description: "A display-only sequence of title and optional body items.",
    useWhen: "Use for repeated short items that do not need tabular columns.",
    fields: {
      id,
      type,
      items: field(true, "Inline title and optional body item records."),
      from: field(false, "Optional dataset projected into list items."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          gap: "token:space",
          padding: "token:space",
          background: "token:color",
          color: "token:color",
          borderColor: "token:color",
          borderWidth: "token:borderWidth",
          borderRadius: "token:radius",
        }),
      },
      targets: {
        item: {
          properties: properties({
            gap: "token:space",
            padding: "token:space",
            background: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
            borderRadius: "token:radius",
          }),
        },
        title: flowLabelTarget,
        body: flowLabelTarget,
        marker: {
          properties: properties({
            color: "token:color",
            fontSize: "token:fontSize",
            fontWeight: "token:fontWeight",
          }),
        },
      },
    },
  },
  keyValue: {
    name: "keyValue",
    description: "A display-only sequence of paired labels and values.",
    useWhen: "Use for compact facts, attributes, or summary label-value pairs.",
    fields: {
      id,
      type,
      items: field(true, "Inline label and value records."),
      from: field(false, "Optional dataset projected into label-value records."),
    },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          gap: "token:space",
          padding: "token:space",
          background: "token:color",
          color: "token:color",
          borderColor: "token:color",
          borderWidth: "token:borderWidth",
          borderRadius: "token:radius",
        }),
      },
      targets: {
        item: {
          properties: properties({
            gap: "token:space",
            padding: "token:space",
            background: "token:color",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
          }),
        },
        label: labelTarget,
        value: labelTarget,
      },
    },
  },
  progress: {
    name: "progress",
    description: "A bounded completion indicator whose fill extent is renderer-owned.",
    useWhen: "Use to show measurable completion or progress from zero through one hundred.",
    fields: {
      id,
      type,
      value: field(true, "Completion value clamped from zero through one hundred."),
      label: field(false, "Optional text describing the progress measure."),
    },
    supportsActiveWhen: false,
    style: {
      root: { properties: properties({ width: "fixed:width", gap: "token:space" }) },
      targets: {
        label: labelTarget,
        track: {
          properties: properties({
            background: "token:color",
            height: "token:progressThickness",
            borderColor: "token:color",
            borderWidth: "token:borderWidth",
            borderRadius: "token:radius",
          }),
        },
        fill: {
          properties: properties({
            background: "token:color",
            backgroundGradient: "token:gradient",
            borderRadius: "token:radius",
          }),
        },
      },
    },
  },
  loading: {
    name: "loading",
    description: "A renderer-owned pending indicator with optional explanatory text.",
    useWhen: "Use while content or an operation is pending and no progress is measurable.",
    fields: { id, type, label: field(false, "Optional text describing what is pending.") },
    supportsActiveWhen: false,
    style: {
      root: {
        properties: properties({
          direction: "fixed:direction",
          gap: "token:space",
          alignItems: "fixed:alignment",
        }),
      },
      targets: {
        indicator: {
          properties: properties({
            size: "token:indicatorSize",
            color: "token:color",
            animation: "fixed:animation",
          }),
        },
        label: labelTarget,
      },
    },
  },
} as const satisfies Record<BrickType, BrickContractEntry>;

/** Serializable source for Brick indexes, detail lookup, and style validation. */
export const BRICK_CONTRACT: Readonly<typeof BRICK_CONTRACT_VALUE> = BRICK_CONTRACT_VALUE;
