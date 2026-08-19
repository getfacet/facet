/** Trusted React implementations for inputs, communication, and disclosure. */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import {
  enumProp,
  flagProp,
  flowStyle,
  foundation,
  mountStyle,
  recipe,
  textProp,
} from "./style.js";

type Mount = ComponentMountProps<ReactNode>;

const FORM_LAYOUTS = ["stacked", "inline"] as const;
const CHOICE_LAYOUTS = ["stacked", "inline"] as const;

const ROOT_BOUNDS: FlowStyle = Object.freeze({
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
});

function regionStyle(extra: FlowStyle = {}): ReturnType<typeof flowStyle> {
  return flowStyle({
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    ...extra,
  });
}

function stringProp(mount: Mount, name: string, fallback = ""): string {
  try {
    const value = mount.props[name];
    return typeof value === "string" ? value : fallback;
  } catch {
    return fallback;
  }
}

function stringArrayProp(mount: Mount, name: string): readonly string[] {
  let value: unknown;
  try {
    value = mount.props[name];
  } catch {
    return [];
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function arrayProp(mount: Mount, name: string): readonly unknown[] {
  try {
    const value = mount.props[name];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function ownString(record: unknown, name: string): string | undefined {
  try {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
    if (!Object.hasOwn(record, name)) return undefined;
    const value = (record as Readonly<Record<string, unknown>>)[name];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function ownBoolean(record: unknown, name: string): boolean | undefined {
  try {
    if (typeof record !== "object" || record === null || Array.isArray(record)) return undefined;
    if (!Object.hasOwn(record, name)) return undefined;
    const value = (record as Readonly<Record<string, unknown>>)[name];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

function labelStyle(namespace: string): ReturnType<typeof flowStyle> {
  return flowStyle({
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color: recipe(namespace, "labelText"),
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
  });
}

function inputStyle(namespace: "field" | "select"): FlowStyle {
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: foundation("size", "touchTarget"),
    padding: recipe(namespace, "inputPadding"),
    border: `${foundation("borderWidth", "thin")} solid ${recipe(namespace, "inputBorder")}`,
    borderRadius: recipe(namespace, "inputRadius"),
    background: recipe(namespace, "inputBg"),
    color: recipe(namespace, "inputText"),
    boxShadow: recipe(namespace, "focusRing"),
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeMd"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  };
}

/** A semantic form grouping named field and action regions without a native submit path. */
export const Form: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const layout = enumProp(props, "layout", FORM_LAYOUTS, "stacked");

  return (
    <form
      data-facet-component="Form"
      data-facet-form-layout={layout}
      style={mountStyle(themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("form", "gap"),
        margin: 0,
      })}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div
        data-facet-slot="fields"
        style={regionStyle({
          display: layout === "inline" ? "grid" : "flex",
          gridTemplateColumns:
            layout === "inline"
              ? `repeat(auto-fit, minmax(min(${foundation("size", "containerXs")}, 100%), 1fr))`
              : undefined,
          flexDirection: layout === "stacked" ? "column" : undefined,
          alignItems: layout === "inline" ? "end" : "stretch",
          gap: layout === "inline" ? recipe("form", "inlineGap") : recipe("form", "gap"),
        })}
      >
        {slots["fields"] ?? null}
      </div>
      <div
        data-facet-slot="actions"
        style={regionStyle({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: recipe("form", "inlineGap"),
        })}
      >
        {slots["actions"] ?? null}
      </div>
    </form>
  );
};

/** One controlled short-text input. */
export const Field: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const label = textProp(mount.props, "label") ?? "";
  const value = stringProp(mount, "value");
  const placeholder = textProp(mount.props, "placeholder");
  const secret = flagProp(mount.props, "secret", false);

  return (
    <label
      data-facet-component="Field"
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "xs"),
      })}
    >
      <span style={labelStyle("field")}>{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        style={flowStyle(inputStyle("field"))}
        onChange={(event) => {
          mount.onValueChange?.(event.target.value);
        }}
      />
    </label>
  );
};

interface OptionRecord {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
}

function optionsFrom(mount: Mount): readonly OptionRecord[] {
  return arrayProp(mount, "options").flatMap((candidate): readonly OptionRecord[] => {
    const label = ownString(candidate, "label");
    const value = ownString(candidate, "value");
    if (label === undefined || value === undefined) return [];
    return [{ label, value, disabled: ownBoolean(candidate, "disabled") ?? false }];
  });
}

/** One controlled native select over a closed shaped option collection. */
export const Select: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const label = textProp(mount.props, "label") ?? "";
  const value = stringProp(mount, "value");
  const placeholder = textProp(mount.props, "placeholder");
  const options = optionsFrom(mount);

  return (
    <label
      data-facet-component="Select"
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: foundation("space", "xs"),
      })}
    >
      <span style={labelStyle("select")}>{label}</span>
      <select
        value={value}
        style={flowStyle(inputStyle("select"))}
        onChange={(event) => {
          mount.onValueChange?.(event.target.value);
        }}
      >
        {placeholder === undefined ? null : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option, index) => (
          <option key={`${option.value}-${index}`} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

function nextChoiceValues(
  options: readonly OptionRecord[],
  selected: ReadonlySet<string>,
  changedValue: string,
  checked: boolean,
): readonly string[] {
  const next: string[] = [];
  for (const option of options) {
    const included = option.value === changedValue ? checked : selected.has(option.value);
    if (included && !next.includes(option.value)) next.push(option.value);
  }
  return Object.freeze(next);
}

/** A controlled multi-select fieldset that emits a string array. */
export const ChoiceGroup: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const label = textProp(mount.props, "label") ?? "";
  const options = optionsFrom(mount);
  const selected = new Set(stringArrayProp(mount, "value"));
  const layout = enumProp(mount.props, "layout", CHOICE_LAYOUTS, "stacked");

  return (
    <fieldset
      data-facet-component="ChoiceGroup"
      data-facet-choice-group-layout={layout}
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("choice-group", "gap"),
        margin: 0,
        padding: 0,
        border: 0,
      })}
    >
      <legend style={labelStyle("choice-group")}>{label}</legend>
      <div
        data-facet-choice-group="options"
        style={regionStyle({
          display: "flex",
          flexDirection: layout === "inline" ? "row" : "column",
          flexWrap: layout === "inline" ? "wrap" : "nowrap",
          gap: recipe("choice-group", "gap"),
        })}
      >
        {options.map((option, index) => {
          const checked = selected.has(option.value);
          return (
            <label
              key={`${option.value}-${index}`}
              data-facet-choice-selected={checked ? "true" : "false"}
              style={regionStyle({
                display: "inline-flex",
                alignItems: "center",
                width: layout === "stacked" ? "100%" : "auto",
                minHeight: foundation("size", "touchTarget"),
                gap: foundation("space", "xs"),
                padding: foundation("space", "xs"),
                border: `${foundation("borderWidth", "thin")} solid ${
                  checked
                    ? recipe("choice-group", "selectedBorder")
                    : recipe("choice-group", "optionBorder")
                }`,
                borderRadius: recipe("choice-group", "radius"),
                background: checked ? recipe("choice-group", "selectedBg") : "transparent",
                color: recipe("choice-group", "optionText"),
                boxShadow: recipe("choice-group", "focusRing"),
                overflowWrap: "anywhere",
                cursor: option.disabled ? "not-allowed" : "pointer",
              })}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={option.disabled}
                onChange={(event) => {
                  mount.onValueChange?.(
                    nextChoiceValues(options, selected, option.value, event.target.checked),
                  );
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

/** One controlled boolean switch. */
export const Toggle: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const label = textProp(mount.props, "label") ?? "";
  const value = flagProp(mount.props, "value", false);

  return (
    <label
      data-facet-component="Toggle"
      data-facet-toggle-state={value ? "on" : "off"}
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "inline-flex",
        alignItems: "center",
        gap: foundation("space", "sm"),
        minHeight: foundation("size", "touchTarget"),
        color: recipe("toggle", "labelText"),
        fontFamily: foundation("typography", "fontFamilySans"),
        fontSize: foundation("typography", "fontSizeSm"),
        fontWeight: foundation("typography", "fontWeightMedium"),
        overflowWrap: "anywhere",
      })}
    >
      <input
        type="checkbox"
        role="switch"
        checked={value}
        style={flowStyle({
          flex: "0 0 auto",
          width: foundation("size", "iconLg"),
          height: foundation("size", "iconLg"),
          accentColor: value ? recipe("toggle", "trackOn") : recipe("toggle", "trackOff"),
          boxShadow: recipe("toggle", "focusRing"),
          cursor: "pointer",
        })}
        onChange={(event) => {
          mount.onValueChange?.(event.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
};

interface MessageRecord {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly timestamp?: string;
  readonly side: "incoming" | "outgoing";
  readonly status?: string;
}

function messagesFrom(mount: Mount): readonly MessageRecord[] {
  return arrayProp(mount, "messages").flatMap((candidate): readonly MessageRecord[] => {
    const id = ownString(candidate, "id");
    const author = ownString(candidate, "author");
    const body = ownString(candidate, "body");
    if (id === undefined || author === undefined || body === undefined) return [];
    const timestamp = ownString(candidate, "timestamp");
    const status = ownString(candidate, "status");
    const side = ownString(candidate, "side") === "outgoing" ? "outgoing" : "incoming";
    return [
      {
        id,
        author,
        body,
        side,
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(status === undefined ? {} : { status }),
      },
    ];
  });
}

/** A chronological, data-backed conversation. */
export const MessageThread: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const messages = messagesFrom(mount);

  return (
    <ol
      data-facet-component="MessageThread"
      aria-label="Messages"
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        gap: recipe("message-thread", "gap"),
        margin: 0,
        padding: 0,
        listStyle: "none",
        overflowX: "hidden",
      })}
    >
      {messages.map((message, index) => {
        const outgoing = message.side === "outgoing";
        const background = outgoing
          ? recipe("message-thread", "outgoingBg")
          : recipe("message-thread", "incomingBg");
        const color = outgoing
          ? recipe("message-thread", "outgoingText")
          : recipe("message-thread", "incomingText");
        return (
          <li
            key={`${message.id}-${index}`}
            data-facet-message-side={message.side}
            style={regionStyle({
              alignSelf: outgoing ? "flex-end" : "flex-start",
              width: "fit-content",
              maxWidth: `min(100%, ${foundation("size", "contentMeasureSm")})`,
            })}
          >
            <article
              style={regionStyle({
                display: "flex",
                flexDirection: "column",
                gap: foundation("space", "xs"),
                padding: foundation("space", "sm"),
                borderRadius: recipe("message-thread", "radius"),
                background,
                color,
                fontFamily: foundation("typography", "fontFamilySans"),
              })}
            >
              <div
                style={regionStyle({
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: foundation("space", "xs"),
                  fontSize: foundation("typography", "fontSizeXs"),
                })}
              >
                <strong>{message.author}</strong>
                {message.timestamp === undefined ? null : (
                  <time style={flowStyle({ color: recipe("message-thread", "mutedText") })}>
                    {message.timestamp}
                  </time>
                )}
              </div>
              <p
                style={flowStyle({
                  margin: 0,
                  maxWidth: "100%",
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  fontSize: foundation("typography", "fontSizeSm"),
                  lineHeight: foundation("typography", "lineHeightNormal"),
                })}
              >
                {message.body}
              </p>
              {message.status === undefined ? null : (
                <span
                  style={flowStyle({
                    color: recipe("message-thread", "mutedText"),
                    fontSize: foundation("typography", "fontSizeXs"),
                    overflowWrap: "anywhere",
                  })}
                >
                  {message.status}
                </span>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
};

interface AccordionState {
  readonly openIds: readonly string[];
  readonly registerItem: (id: string, defaultOpen: boolean) => () => void;
  readonly toggleItem: (id: string) => void;
}

const AccordionContext = createContext<AccordionState | undefined>(undefined);

/** A browser-local disclosure group. Its state never leaves this React subtree. */
export const Accordion: MountedComponent<ReactNode, ReactNode> = ({
  props,
  slots,
  themeVars,
}: Mount): ReactNode => {
  const multiple = flagProp(props, "multiple", false);
  const [openIds, setOpenIds] = useState<readonly string[]>([]);

  const registerItem = useCallback(
    (id: string, defaultOpen: boolean): (() => void) => {
      if (defaultOpen) {
        setOpenIds((current) => {
          if (current.includes(id)) return current;
          if (!multiple && current.length > 0) return current;
          return Object.freeze([...current, id]);
        });
      }
      return () => {
        setOpenIds((current) =>
          current.includes(id)
            ? Object.freeze(current.filter((candidate) => candidate !== id))
            : current,
        );
      };
    },
    [multiple],
  );

  const toggleItem = useCallback(
    (id: string): void => {
      setOpenIds((current) => {
        if (current.includes(id)) {
          return Object.freeze(current.filter((candidate) => candidate !== id));
        }
        return Object.freeze(multiple ? [...current, id] : [id]);
      });
    },
    [multiple],
  );

  useEffect(() => {
    if (!multiple) setOpenIds((current) => (current.length > 1 ? current.slice(0, 1) : current));
  }, [multiple]);

  const context = useMemo<AccordionState>(
    () => ({ openIds, registerItem, toggleItem }),
    [openIds, registerItem, toggleItem],
  );

  return (
    <AccordionContext.Provider value={context}>
      <div
        data-facet-component="Accordion"
        data-facet-accordion-multiple={multiple ? "true" : "false"}
        style={mountStyle(themeVars, {
          ...ROOT_BOUNDS,
          display: "flex",
          flexDirection: "column",
          border: `${foundation("borderWidth", "thin")} solid ${recipe("accordion", "border")}`,
          borderRadius: recipe("accordion", "radius"),
          overflow: "hidden",
        })}
      >
        <div
          data-facet-slot="items"
          style={regionStyle({ display: "flex", flexDirection: "column" })}
        >
          {slots["items"] ?? null}
        </div>
      </div>
    </AccordionContext.Provider>
  );
};

/** One accessible disclosure controlled by its nearest Accordion. */
export const AccordionItem: MountedComponent<ReactNode, ReactNode> = (mount): ReactNode => {
  const title = textProp(mount.props, "title") ?? "";
  const [initiallyOpen] = useState(() => flagProp(mount.props, "defaultOpen", false));
  const [localOpen, setLocalOpen] = useState(initiallyOpen);
  const context = useContext(AccordionContext);
  const reactId = useId();
  const triggerId = `facet-accordion-trigger-${reactId}`;
  const regionId = `facet-accordion-region-${reactId}`;
  const registerItem = context?.registerItem;

  useEffect(() => {
    if (registerItem === undefined) return undefined;
    return registerItem(reactId, initiallyOpen);
  }, [initiallyOpen, reactId, registerItem]);

  const open = context === undefined ? localOpen : context.openIds.includes(reactId);
  const toggle = useCallback((): void => {
    if (context === undefined) setLocalOpen((current) => !current);
    else context.toggleItem(reactId);
  }, [context, reactId]);
  const activateFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  };

  return (
    <section
      data-facet-component="AccordionItem"
      style={mountStyle(mount.themeVars, {
        ...ROOT_BOUNDS,
        display: "flex",
        flexDirection: "column",
        borderBottom: `${foundation("borderWidth", "thin")} solid ${recipe(
          "accordion",
          "divider",
        )}`,
      })}
    >
      <h3 style={flowStyle({ margin: 0, minWidth: 0, maxWidth: "100%" })}>
        <button
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          style={flowStyle({
            ...ROOT_BOUNDS,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: recipe("accordion-item", "gap"),
            minHeight: foundation("size", "touchTarget"),
            padding: foundation("space", "sm"),
            border: 0,
            background: "transparent",
            color: recipe("accordion-item", "summaryText"),
            boxShadow: recipe("accordion-item", "focusRing"),
            fontFamily: foundation("typography", "fontFamilySans"),
            fontSize: foundation("typography", "fontSizeMd"),
            fontWeight: foundation("typography", "fontWeightMedium"),
            textAlign: "left",
            overflowWrap: "anywhere",
            cursor: "pointer",
          })}
          onClick={toggle}
          onKeyDown={activateFromKeyboard}
        >
          <span>{title}</span>
          <span aria-hidden="true">{open ? "-" : "+"}</span>
        </button>
      </h3>
      <div
        id={regionId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
        style={regionStyle({
          display: open ? "flex" : undefined,
          flexDirection: "column",
          gap: recipe("accordion-item", "gap"),
          padding: open ? foundation("space", "sm") : 0,
          color: recipe("accordion-item", "bodyText"),
          fontFamily: foundation("typography", "fontFamilySans"),
          overflowWrap: "anywhere",
        })}
      >
        <div data-facet-slot="body" style={regionStyle()}>
          {mount.slots["body"] ?? null}
        </div>
        {mount.slots["actions"] === undefined || mount.slots["actions"] === null ? null : (
          <div
            data-facet-slot="actions"
            style={regionStyle({
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: recipe("accordion-item", "gap"),
            })}
          >
            {mount.slots["actions"]}
          </div>
        )}
      </div>
    </section>
  );
};
