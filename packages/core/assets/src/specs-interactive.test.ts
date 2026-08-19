import { readFileSync } from "node:fs";

import { BOUNDS, validateComponentSpec } from "@facet/core";
import type { ComponentSpec } from "@facet/core";
import { describe, expect, it } from "vitest";

import { INTERACTIVE_SPECS } from "./specs-interactive.js";

const INTERACTIVE_TAGS: readonly string[] = [
  "Form",
  "Field",
  "Select",
  "ChoiceGroup",
  "Toggle",
  "MessageThread",
  "Accordion",
  "AccordionItem",
];

const OPTION_SHAPE = {
  fields: {
    label: {
      type: "string",
      required: true,
      guidance: "The visitor-facing option label.",
    },
    value: {
      type: "string",
      required: true,
      guidance: "The stable value collected when the option is chosen.",
    },
    disabled: {
      type: "boolean",
      guidance: "Whether the option is unavailable.",
    },
  },
} as const;

const MESSAGE_SHAPE = {
  fields: {
    id: {
      type: "string",
      required: true,
      guidance: "The stable message identifier.",
    },
    author: {
      type: "string",
      required: true,
      guidance: "The name of the message author.",
    },
    body: {
      type: "string",
      required: true,
      guidance: "The message text.",
    },
    timestamp: {
      type: "string",
      guidance: "A display-ready timestamp.",
    },
    side: {
      type: "string",
      guidance: "Which side of the thread presents the message.",
    },
    status: {
      type: "string",
      guidance: "A display-ready delivery status.",
    },
  },
} as const;

const EXPECTED_SPECS = {
  Form: {
    props: {
      layout: {
        type: "string",
        enum: ["stacked", "inline"],
        default: "stacked",
        guidance: "Whether fields stack vertically or flow inline when space permits.",
      },
    },
    content: {
      mode: "slots",
      slots: {
        fields: {
          guidance: "The controls whose values this form collects.",
          minChildren: 1,
          maxChildren: 20,
        },
        actions: {
          guidance: "The controls that submit or otherwise act on the form.",
          minChildren: 1,
          maxChildren: 4,
        },
      },
    },
    collect: undefined,
  },
  Field: {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The unique name a Button writes in its collect list.",
      },
      label: {
        type: "string",
        required: true,
        guidance: "What the visitor is being asked for.",
      },
      value: {
        type: "string",
        default: "",
        guidance: "The initial value before the visitor edits the field.",
      },
      placeholder: {
        type: "string",
        guidance: "A short hint shown while the field is empty.",
      },
      secret: {
        type: "boolean",
        default: false,
        guidance: "Whether the value is masked and withheld from event payloads.",
      },
    },
    content: { mode: "none" },
    collect: {
      collectable: true,
      valueProp: "value",
      valueKind: "string",
      sensitiveProp: "secret",
    },
  },
  Select: {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The unique name a Button writes in its collect list.",
      },
      label: {
        type: "string",
        required: true,
        guidance: "What the visitor is choosing.",
      },
      options: {
        type: "array",
        required: true,
        bindable: true,
        shape: OPTION_SHAPE,
        guidance: "Options published through the data model.",
      },
      value: {
        type: "string",
        default: "",
        guidance: "The initially selected option value.",
      },
      placeholder: {
        type: "string",
        guidance: "A short prompt shown until an option is selected.",
      },
    },
    content: { mode: "none" },
    collect: { collectable: true, valueProp: "value", valueKind: "string" },
  },
  ChoiceGroup: {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The unique name a Button writes in its collect list.",
      },
      label: {
        type: "string",
        required: true,
        guidance: "What the visitor is choosing.",
      },
      options: {
        type: "array",
        required: true,
        bindable: true,
        shape: OPTION_SHAPE,
        guidance: "Choices published through the data model.",
      },
      value: {
        type: "array",
        bindable: true,
        guidance: "The currently selected option values.",
      },
      layout: {
        type: "string",
        enum: ["stacked", "inline"],
        default: "stacked",
        guidance: "Whether choices stack vertically or flow inline when space permits.",
      },
    },
    content: { mode: "none" },
    collect: { collectable: true, valueProp: "value", valueKind: "string[]" },
  },
  Toggle: {
    props: {
      name: {
        type: "string",
        required: true,
        guidance: "The unique name a Button writes in its collect list.",
      },
      label: {
        type: "string",
        required: true,
        guidance: "The setting the visitor can turn on or off.",
      },
      value: {
        type: "boolean",
        default: false,
        guidance: "Whether the setting starts on.",
      },
    },
    content: { mode: "none" },
    collect: { collectable: true, valueProp: "value", valueKind: "boolean" },
  },
  MessageThread: {
    props: {
      messages: {
        type: "array",
        required: true,
        bindable: true,
        shape: MESSAGE_SHAPE,
        guidance: "Messages published through the data model in display order.",
      },
    },
    content: { mode: "none" },
    collect: undefined,
  },
  Accordion: {
    props: {
      multiple: {
        type: "boolean",
        default: false,
        guidance: "Whether more than one item may be expanded at a time.",
      },
    },
    content: {
      mode: "slots",
      slots: {
        items: {
          guidance: "The disclosure items in display order.",
          minChildren: 1,
          maxChildren: 12,
        },
      },
    },
    collect: undefined,
  },
  AccordionItem: {
    props: {
      title: {
        type: "string",
        required: true,
        guidance: "The label on the disclosure control.",
      },
      defaultOpen: {
        type: "boolean",
        default: false,
        guidance: "Whether the item starts expanded.",
      },
    },
    content: {
      mode: "slots",
      slots: {
        body: {
          guidance: "The content revealed when the item is expanded.",
          minChildren: 1,
          maxChildren: 8,
        },
        actions: {
          guidance: "Optional actions associated with the item.",
          minChildren: 0,
          maxChildren: 2,
        },
      },
    },
    collect: undefined,
  },
} as const;

function specFor(tag: string): ComponentSpec {
  const spec = INTERACTIVE_SPECS.find((candidate) => candidate.tag === tag);
  if (spec === undefined) {
    throw new Error(`Missing interactive spec: ${tag}`);
  }
  return spec;
}

describe("interactive specs", () => {
  it("exports exactly the locked eight tags in registration order", () => {
    expect(INTERACTIVE_SPECS.map((spec) => spec.tag)).toEqual(INTERACTIVE_TAGS);
    expect(new Set(INTERACTIVE_SPECS.map((spec) => spec.tag)).size).toBe(8);
  });

  it.each(INTERACTIVE_TAGS)("pins the complete %s prop, content, and collect contract", (tag) => {
    const spec = specFor(tag);
    const expected = EXPECTED_SPECS[tag as keyof typeof EXPECTED_SPECS];
    expect(spec.props).toEqual(expected.props);
    expect(spec.content).toEqual(expected.content);
    expect(spec.collect).toEqual(expected.collect);
  });

  it("validates every spec against the Core trust boundary", () => {
    expect(
      INTERACTIVE_SPECS.map((spec) => {
        const result = validateComponentSpec(spec);
        return [spec.tag, result.ok ? "accepted" : `${result.code} at ${result.at}`];
      }),
    ).toEqual(INTERACTIVE_TAGS.map((tag) => [tag, "accepted"]));
  });

  it("declares exactly the typed collectable controls", () => {
    expect(
      INTERACTIVE_SPECS.flatMap((spec) =>
        spec.collect === undefined ? [] : [[spec.tag, spec.collect.valueKind]],
      ),
    ).toEqual([
      ["Field", "string"],
      ["Select", "string"],
      ["ChoiceGroup", "string[]"],
      ["Toggle", "boolean"],
    ]);
  });

  it("uses the exact approved option and message shapes", () => {
    expect(specFor("Select").props["options"]).toMatchObject({ shape: OPTION_SHAPE });
    expect(specFor("ChoiceGroup").props["options"]).toMatchObject({ shape: OPTION_SHAPE });
    expect(specFor("MessageThread").props["messages"]).toMatchObject({
      shape: MESSAGE_SHAPE,
    });
  });

  it("keeps metadata within the catalog bounds", () => {
    for (const spec of INTERACTIVE_SPECS) {
      expect(spec.whenToUse.length).toBeGreaterThan(0);
      expect(spec.whenToUse.length).toBeLessThanOrEqual(BOUNDS.componentWhenToUseChars);
      expect(Object.keys(spec.props).length).toBeLessThanOrEqual(BOUNDS.propsPerComponentSpec);
      for (const schema of Object.values(spec.props)) {
        expect(schema.guidance.length).toBeGreaterThan(0);
        expect(schema.guidance.length).toBeLessThanOrEqual(BOUNDS.propGuidanceChars);
      }
    }
  });

  it("contains neither retired component fields", () => {
    const retiredFields = [
      ["accepts", "Children"],
      ["authoring", "Role"],
    ].map((parts) => parts.join(""));
    for (const spec of INTERACTIVE_SPECS as readonly unknown[]) {
      for (const field of retiredFields) expect(spec).not.toHaveProperty(field);
    }
  });

  it("stays a private Core-only module without NUL bytes", () => {
    const source = readFileSync(new URL("./specs-interactive.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
    expect([...new Set(imports)]).toEqual(["@facet/core"]);
    expect(source.indexOf("\0")).toBe(-1);
  });
});
