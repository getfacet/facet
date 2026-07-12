import type { ChangeEvent, CSSProperties, FormEvent, ReactNode } from "react";
import {
  FIELD_INPUTS,
  MAX_FIELD_VALUE_CHARS,
  MAX_NODE_BODY_CHARS,
  MAX_NODE_LABEL_CHARS,
  type ComponentRecipe,
  type FacetNode,
  type FieldStyle,
  type NodeId,
} from "@facet/core";
import { fieldStyle } from "./theme.js";
import { resolveRecipePart } from "./recipe-parts.js";
import { rootContainmentStyle } from "./layout-contract.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import {
  MAX_INTRINSIC_ITEMS,
  cappedArray,
  cappedString,
  componentBoxStyle,
  componentRecipe,
  componentTextStyle,
  defaultInputForOptions,
  fieldChoiceControlStyle,
  fieldChoiceOptionStyle,
  fieldControlStyle,
  isFieldInput,
  optionsOf,
  partBoxStyle,
  safeOwnValue,
  scalarString,
  styleOf,
  virtualFieldId,
  withInert,
} from "./brick-renderer-shared.js";

export function renderForm<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert } = context;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "form", variant);
  const style = componentBoxStyle(theme, recipe, {
    gap: "sm",
    pad: "md",
    bg: "surface",
    border: true,
    radius: "md",
    width: "full",
  });
  const title = cappedString(safeOwnValue(node, "title"), MAX_NODE_LABEL_CHARS);
  const body = cappedString(safeOwnValue(node, "body"), MAX_NODE_BODY_CHARS);
  const submitLabel = cappedString(safeOwnValue(node, "submitLabel"), MAX_NODE_LABEL_CHARS);
  const submit = context.classifyPress(safeOwnValue(node, "onSubmit"));
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!inert && submit !== null) context.dispatch(submit);
  };
  return (
    <form
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
      onSubmit={submit === null ? (event) => event.preventDefault() : handleSubmit}
    >
      {title === undefined && body === undefined ? null : (
        <div style={partBoxStyle(theme, recipe, "header", { gap: "xs" })}>
          {title === undefined ? null : (
            <h3 style={componentTextStyle(theme, recipe, { weight: "bold" }, "title")}>{title}</h3>
          )}
          {body === undefined ? null : (
            <p style={componentTextStyle(theme, recipe, { color: "fg-muted" }, "body")}>{body}</p>
          )}
        </div>
      )}
      {context.children}
      {submitLabel === undefined ? null : (
        <button
          type="submit"
          disabled={inert || submit === null ? true : undefined}
          tabIndex={inert ? -1 : undefined}
          style={{
            ...rootContainmentStyle({
              alignSelf: "flex-start",
              background: theme.color.accent,
              border: 0,
              borderRadius: theme.radius.md,
              color: theme.color["accent-fg"],
              cursor: inert || submit === null ? undefined : "pointer",
              font: "inherit",
              fontWeight: theme.fontWeight.semibold,
              padding: `${theme.space.sm} ${theme.space.md}`,
            }),
            ...(resolveRecipePart(recipe, "actions", theme).box ?? {}),
            ...(resolveRecipePart(recipe, "actions", theme).text ?? {}),
          }}
        >
          {submitLabel}
        </button>
      )}
    </form>
  );
}

export function renderSearch<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert, nodeId } = context;
  const name = cappedString(safeOwnValue(node, "name"), MAX_FIELD_VALUE_CHARS);
  if (name === undefined) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "search", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    align: "end",
    wrap: true,
    width: "full",
  });
  const label = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const placeholder = cappedString(safeOwnValue(node, "placeholder"), MAX_NODE_LABEL_CHARS);
  const value = cappedString(safeOwnValue(node, "value"), MAX_FIELD_VALUE_CHARS);
  const submitLabel =
    cappedString(safeOwnValue(node, "submitLabel"), MAX_NODE_LABEL_CHARS) ?? "Search";
  const submit = context.classifyPress(safeOwnValue(node, "onSubmit"));
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!inert && submit !== null) context.dispatch(submit);
  };
  return (
    <form
      role="search"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
      onSubmit={submit === null ? (event) => event.preventDefault() : handleSubmit}
    >
      <label style={{ ...partBoxStyle(theme, recipe, "control", { gap: "xs", grow: true }) }}>
        {label === undefined ? null : (
          <span style={componentTextStyle(theme, recipe, {}, "label")}>{label}</span>
        )}
        <input
          type="search"
          name={inert ? undefined : name}
          placeholder={placeholder}
          defaultValue={value}
          data-facet-field-id={inert ? undefined : virtualFieldId(nodeId, name)}
          style={fieldControlStyle(theme, recipe)}
          disabled={inert ? true : undefined}
          tabIndex={inert ? -1 : undefined}
        />
      </label>
      <button
        type="submit"
        disabled={inert || submit === null ? true : undefined}
        tabIndex={inert ? -1 : undefined}
        style={rootContainmentStyle({
          background: theme.color.accent,
          border: 0,
          borderRadius: theme.radius.md,
          color: theme.color["accent-fg"],
          cursor: inert || submit === null ? undefined : "pointer",
          font: "inherit",
          fontWeight: theme.fontWeight.semibold,
          padding: `${theme.space.sm} ${theme.space.md}`,
        })}
      >
        {submitLabel}
      </button>
    </form>
  );
}

interface FilterRenderModel<Press> {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly input: (typeof FIELD_INPUTS)[number];
  readonly options: readonly string[];
  readonly value: unknown;
  readonly action: Press | null;
}

function renderFilterControl<Press>(
  model: FilterRenderModel<Press>,
  context: BrickRenderContext<Press>,
  recipe: ComponentRecipe,
): ReactNode {
  const { theme, inert } = context;
  const controlProps = {
    name: inert ? undefined : model.name,
    "data-facet-field-id": inert ? undefined : model.id,
    disabled: inert ? true : undefined,
    tabIndex: inert ? -1 : undefined,
    onChange:
      inert || model.action === null
        ? undefined
        : (_event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
            context.dispatch(model.action as Press);
          },
  };
  if (model.input === "select") {
    return (
      <select
        {...controlProps}
        defaultValue={scalarString(model.value)}
        style={fieldControlStyle(theme, recipe)}
      >
        {model.options.map((option, index) => (
          <option key={`${String(index)}:${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (model.input === "checkbox" || model.input === "switch") {
    return (
      <input
        {...controlProps}
        type="checkbox"
        role={model.input === "switch" ? "switch" : undefined}
        defaultChecked={model.value === true}
        style={fieldChoiceControlStyle(theme)}
      />
    );
  }
  return (
    <input
      {...controlProps}
      type={model.input === "radio" ? "text" : model.input}
      defaultValue={scalarString(model.value)}
      style={fieldControlStyle(theme, recipe)}
    />
  );
}

export function renderFilterBar<Press>(
  node: FacetNode,
  context: BrickRenderContext<Press>,
): ReactNode {
  const { theme, className, inert, nodeId } = context;
  const action = context.classifyPress(safeOwnValue(node, "onChange"));
  const filters = cappedArray(safeOwnValue(node, "filters"), MAX_INTRINSIC_ITEMS).flatMap(
    (item) => {
      const name = cappedString(safeOwnValue(item, "name"), MAX_FIELD_VALUE_CHARS);
      const label = cappedString(safeOwnValue(item, "label"), MAX_NODE_LABEL_CHARS);
      if (name === undefined || label === undefined) return [];
      const options = optionsOf(safeOwnValue(item, "options"));
      return [
        {
          id: virtualFieldId(nodeId, name),
          name,
          label,
          input: defaultInputForOptions(safeOwnValue(item, "input"), options),
          options,
          value: safeOwnValue(item, "value"),
          action,
        },
      ];
    },
  );
  if (filters.length === 0) return null;
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "filterBar", variant);
  const style = componentBoxStyle(theme, recipe, {
    direction: "row",
    gap: "sm",
    align: "end",
    wrap: true,
    width: "full",
  });
  return (
    <div
      role="group"
      className={className}
      aria-hidden={inert ? true : undefined}
      style={withInert(style, inert)}
    >
      {filters.map((filter) => (
        <label
          key={filter.id}
          style={partBoxStyle(theme, recipe, "item", { gap: "xs", grow: true })}
        >
          <span style={componentTextStyle(theme, recipe, {}, "label")}>{filter.label}</span>
          {renderFilterControl(filter, context, recipe)}
        </label>
      ))}
    </div>
  );
}

interface FieldRenderModel {
  readonly className: string | undefined;
  readonly inert: boolean;
  readonly wrapperStyle: CSSProperties;
  readonly label: ReactNode;
  readonly fieldId: NodeId | undefined;
  readonly controlName: string | undefined;
  readonly inertControlProps: { readonly disabled?: true; readonly tabIndex?: -1 };
  readonly controlStyle: CSSProperties;
  readonly choiceControlStyle: CSSProperties;
  readonly choiceOptionStyle: CSSProperties;
  readonly options: readonly string[];
  readonly placeholder: string | undefined;
}

function renderSelectField(model: FieldRenderModel): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <select
        name={model.controlName}
        data-facet-field-id={model.fieldId}
        style={model.controlStyle}
        {...model.inertControlProps}
      >
        {model.options.map((option, index) => (
          <option key={`${String(index)}:${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function renderRadioField(model: FieldRenderModel): ReactNode {
  return (
    <div
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      {model.options.map((option, index) => (
        <label key={`${String(index)}:${option}`} style={model.choiceOptionStyle}>
          <input
            type="radio"
            name={model.controlName}
            value={option}
            data-facet-field-id={model.fieldId}
            style={model.choiceControlStyle}
            {...model.inertControlProps}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function renderBooleanField(model: FieldRenderModel, role?: "switch"): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <input
        type="checkbox"
        role={role}
        name={model.controlName}
        data-facet-field-id={model.fieldId}
        style={model.choiceControlStyle}
        {...model.inertControlProps}
      />
    </label>
  );
}

function renderTextField(
  model: FieldRenderModel,
  input: Exclude<(typeof FIELD_INPUTS)[number], "checkbox" | "radio" | "select" | "switch">,
): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <input
        type={input}
        name={model.controlName}
        placeholder={model.placeholder}
        data-facet-field-id={model.fieldId}
        style={model.controlStyle}
        {...model.inertControlProps}
      />
    </label>
  );
}

export function renderField<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert, nodeId } = context;
  const rawInput = safeOwnValue(node, "input");
  const input = isFieldInput(rawInput) ? rawInput : "text";
  const name = cappedString(safeOwnValue(node, "name"), MAX_FIELD_VALUE_CHARS);
  const placeholder = cappedString(safeOwnValue(node, "placeholder"), MAX_NODE_LABEL_CHARS);
  const options = optionsOf(safeOwnValue(node, "options"));
  const variant = safeOwnValue(node, "variant");
  const recipe = componentRecipe(theme, "field", variant);
  const wrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    ...fieldStyle(
      {
        ...(recipe.field ?? {}),
        ...(styleOf<FieldStyle>(safeOwnValue(node, "style")) ?? {}),
      },
      theme,
    ),
    ...(inert ? { pointerEvents: "none" } : {}),
  };
  const fieldLabel = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const label =
    fieldLabel === undefined ? null : (
      <span style={componentTextStyle(theme, recipe, {}, "label")}>{fieldLabel}</span>
    );
  const model: FieldRenderModel = {
    className,
    inert,
    wrapperStyle,
    label,
    fieldId: inert ? undefined : nodeId,
    controlName: inert ? undefined : name,
    inertControlProps: inert ? { disabled: true, tabIndex: -1 } : {},
    controlStyle: fieldControlStyle(theme, recipe),
    choiceControlStyle: fieldChoiceControlStyle(theme),
    choiceOptionStyle: fieldChoiceOptionStyle(theme),
    options,
    placeholder,
  };
  if (input === "select") {
    return renderSelectField(model);
  }
  if (input === "radio") {
    return renderRadioField(model);
  }
  if (input === "checkbox") {
    return renderBooleanField(model);
  }
  if (input === "switch") {
    return renderBooleanField(model, "switch");
  }
  return renderTextField(model, input);
}
