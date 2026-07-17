import type { CSSProperties, ReactNode } from "react";
import {
  INPUT_KINDS,
  MAX_FIELD_VALUE_CHARS,
  MAX_NODE_LABEL_CHARS,
  type FacetNode,
  type NodeId,
} from "@facet/core";
import { joinStyleClasses, resolveInputStylePresentation } from "./brick-style-input.js";
import type { BrickRenderContext } from "./brick-renderer-types.js";
import { cappedString, isFieldInput, optionsOf, safeOwnValue } from "./brick-renderer-shared.js";

interface FieldRenderModel {
  readonly className: string | undefined;
  readonly controlClassName: string | undefined;
  readonly choiceControlClassName: string | undefined;
  readonly choiceOptionClassName: string | undefined;
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
        className={model.controlClassName}
        name={model.controlName}
        data-facet-field-id={model.fieldId}
        style={model.controlStyle}
        {...model.inertControlProps}
      >
        {model.options.map((option, index) => (
          <option
            key={`${String(index)}:${option}`}
            value={option}
            className={model.choiceOptionClassName}
            style={model.choiceOptionStyle}
          >
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
        <label
          key={`${String(index)}:${option}`}
          className={model.choiceOptionClassName}
          style={model.choiceOptionStyle}
        >
          <input
            className={model.choiceControlClassName}
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
        className={model.choiceControlClassName}
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
  input: Exclude<(typeof INPUT_KINDS)[number], "checkbox" | "radio" | "select" | "switch">,
): ReactNode {
  return (
    <label
      className={model.className}
      aria-hidden={model.inert ? true : undefined}
      style={model.wrapperStyle}
    >
      {model.label}
      <input
        className={model.controlClassName}
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

export function renderInput<Press>(node: FacetNode, context: BrickRenderContext<Press>): ReactNode {
  const { theme, className, inert, nodeId } = context;
  const rawInput = safeOwnValue(node, "input");
  const input = isFieldInput(rawInput) ? rawInput : "text";
  const name = cappedString(safeOwnValue(node, "name"), MAX_FIELD_VALUE_CHARS);
  const placeholder = cappedString(safeOwnValue(node, "placeholder"), MAX_NODE_LABEL_CHARS);
  const options = optionsOf(safeOwnValue(node, "options"));
  const presentation = resolveInputStylePresentation(theme, safeOwnValue(node, "style"), input);
  const wrapperStyle: CSSProperties = {
    ...presentation.root,
    ...(inert ? { pointerEvents: "none" } : {}),
  };
  const fieldLabel = cappedString(safeOwnValue(node, "label"), MAX_NODE_LABEL_CHARS);
  const label =
    fieldLabel === undefined ? null : <span style={presentation.label}>{fieldLabel}</span>;
  const choiceControlStyle: CSSProperties = {
    ...presentation.control.style,
    ...presentation.indicator.style,
  };
  const model: FieldRenderModel = {
    className,
    controlClassName: presentation.control.className,
    choiceControlClassName: joinStyleClasses(
      presentation.control.className,
      presentation.indicator.className,
    ),
    choiceOptionClassName: presentation.option.className,
    inert,
    wrapperStyle,
    label,
    fieldId: inert ? undefined : nodeId,
    controlName: inert ? undefined : name,
    inertControlProps: inert ? { disabled: true, tabIndex: -1 } : {},
    controlStyle: presentation.control.style,
    choiceControlStyle,
    choiceOptionStyle: presentation.option.style,
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
