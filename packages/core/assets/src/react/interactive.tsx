/**
 * The trusted React implementations of the three interactive components:
 * `Button`, `Field` and `Table`.
 *
 * These three are where the mount contract earns its shape, because they are the
 * only default components that do anything.
 *
 * **`Button` reports; it does not act.** Activating it calls `onAction("action")`
 * and stops there. The renderer holds the node, parses the `nav:` or `agent:`
 * reference and decides what happens next, so this file contains no router, no
 * anchor, no history call and no idea what a screen is. That is also why the
 * control is an explicit `type="button"`: the HTML default is `submit`, which
 * would navigate on its own the moment a host wrapped the page in a form —
 * exactly the local action path the invariants refuse.
 *
 * **`Field` is controlled by Facet (D-08).** The value arrives as a prop and the
 * visitor's edit leaves through `onValueChange`; the component never keeps state,
 * never writes the value into an attribute, and never stamps its collect name
 * into the DOM. The catalog declares which prop is the value and which flags it
 * sensitive, so collectable identity is spec-owned — a component cannot opt
 * itself in or quietly yield nothing. A secret field masks its value and keeps it
 * out of everything but the masked control it belongs to.
 *
 * **`Table` renders bound rows.** `rows` is a required bindable array, so the
 * rows have already come from the bounded data model through a `data:<path>`
 * reference and are handed here resolved. There is no fetch, no column
 * configuration and no inline row literal. Because the values are the host's,
 * every read of a row is total: a row that is not a record, a key whose getter
 * throws, and a value that is itself a structure all degrade to a blank cell.
 * Unwinding instead would trip a subtree boundary and blank the region.
 *
 * Styling is token names and nothing else — no raw CSS, no `position`, no
 * `z-index`. Each root carries the active theme's custom properties and every
 * declaration references a token by name, so a control resolves the theme that
 * is active now rather than the one that was active when it first rendered.
 *
 * The module is **private**: it is not barrel-exported and is not a package
 * entry point. `react.tsx` composes these into the one default registry.
 */

import type { ComponentMountProps, MountedComponent } from "@facet/core";
import type { ReactNode } from "react";

import type { FlowStyle } from "./style.js";
import { flowStyle, foundation, mountStyle, recipe } from "./style.js";

/** What one of these components is handed. React supplies both element types. */
type Mount = ComponentMountProps<ReactNode>;

/** Reads a declared string prop, falling back when the value is anything else. */
function readString(mount: Mount, name: string, fallback: string): string {
  const value = mount.props[name];
  return typeof value === "string" ? value : fallback;
}

/** Reads a declared boolean prop, falling back when the value is anything else. */
function readBoolean(mount: Mount, name: string, fallback: boolean): boolean {
  const value = mount.props[name];
  return typeof value === "boolean" ? value : fallback;
}

/** Reads a declared enum prop, folding a value outside the domain to the default. */
function readEnum<Value extends string>(
  mount: Mount,
  name: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const value = mount.props[name];
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * How prominent each `Button` tone is, as the pair of token references it paints
 * with. `quiet` carries no fill and no border at all, which is what makes it
 * read as the least of three controls without needing a token of its own — its
 * `transparent` is a CSS keyword rather than a token, because "no paint" is not
 * a value a host reskins.
 */
const BUTTON_TONES = {
  primary: {
    background: recipe("button", "primaryBg"),
    color: recipe("button", "primaryText"),
    border: recipe("button", "primaryBorder"),
    bordered: true,
  },
  secondary: {
    background: recipe("button", "secondaryBg"),
    color: recipe("button", "secondaryText"),
    border: recipe("button", "secondaryBorder"),
    bordered: true,
  },
  quiet: {
    background: "transparent",
    color: recipe("button", "quietText"),
    border: "transparent",
    bordered: false,
  },
} as const;

const BUTTON_TONE_NAMES = Object.keys(BUTTON_TONES) as readonly (keyof typeof BUTTON_TONES)[];

/**
 * One control that reports an activation and nothing more.
 *
 * `onAction` is handed the name of this component's own declared action prop.
 * Passing the prop name rather than the resolved reference is what keeps the
 * decision on the renderer's side: this file never learns whether `action` said
 * `nav:` or `agent:`, so it cannot grow a shortcut for either.
 */
export const Button: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const tone = BUTTON_TONES[readEnum(mount, "tone", BUTTON_TONE_NAMES, "secondary")];
  const onAction = mount.onAction;

  const style: FlowStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: foundation("space", "xs"),
    padding: `${recipe("button", "paddingBlock")} ${recipe("button", "paddingInline")}`,
    borderRadius: recipe("button", "radius"),
    border: tone.bordered ? `${foundation("borderWidth", "thin")} solid ${tone.border}` : "none",
    background: tone.background,
    color: tone.color,
    boxShadow: recipe("button", "focusRing"),
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    lineHeight: foundation("typography", "lineHeightTight"),
    cursor: "pointer",
  };

  return (
    <button
      type="button"
      style={mountStyle(mount.themeVars, style)}
      onClick={() => {
        onAction("action");
      }}
    >
      {label}
    </button>
  );
};

/**
 * One value the visitor supplies, owned by Facet.
 *
 * The label wraps the control rather than pointing at it with `htmlFor`, so the
 * association needs no generated `id` — and therefore cannot collide with a host
 * page's ids or become a second identity for the field.
 *
 * The declared `name` deliberately does **not** become a DOM `name` attribute.
 * `name` is the identity a `Button` writes in its `collect` list, and Facet reads
 * the value through the callback it injected; putting the same identity on the
 * element would create a second, DOM-side channel for a value the framework
 * already owns, which is the stamp D-08 exists to forbid.
 *
 * `onValueChange` is present exactly when the catalog declares the component
 * collectable, so it is called optionally: a `Field` mounted without it simply
 * shows its value and reports nothing, rather than throwing on the first
 * keystroke.
 */
export const Field: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const label = readString(mount, "label", "");
  const value = readString(mount, "value", "");
  const placeholder = readString(mount, "placeholder", "");
  const secret = readBoolean(mount, "secret", false);
  const onValueChange = mount.onValueChange;

  const rootStyle: FlowStyle = {
    display: "flex",
    flexDirection: "column",
    gap: foundation("space", "xs"),
    fontFamily: foundation("typography", "fontFamilySans"),
  };
  const labelStyle: FlowStyle = {
    fontSize: foundation("typography", "fontSizeSm"),
    fontWeight: foundation("typography", "fontWeightMedium"),
    color: recipe("field", "labelText"),
  };
  const inputStyle: FlowStyle = {
    padding: recipe("field", "inputPadding"),
    borderRadius: recipe("field", "inputRadius"),
    border: `${foundation("borderWidth", "thin")} solid ${recipe("field", "inputBorder")}`,
    background: recipe("field", "inputBg"),
    color: recipe("field", "inputText"),
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeMd"),
    lineHeight: foundation("typography", "lineHeightNormal"),
  };

  return (
    <label style={mountStyle(mount.themeVars, rootStyle)}>
      <span style={flowStyle(labelStyle)}>{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        placeholder={placeholder === "" ? undefined : placeholder}
        style={flowStyle(inputStyle)}
        onChange={(event) => {
          onValueChange?.(event.target.value);
        }}
      />
    </label>
  );
};

/**
 * Reads one own property of a candidate row without trusting it.
 *
 * Inherited keys do not stand in for declared ones, and a throwing accessor
 * reads as absent rather than propagating: published data is the host's, and a
 * single hostile getter must not be able to unwind the table it appears in.
 */
function safeOwnValue(row: unknown, key: string): unknown {
  try {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
    if (!Object.hasOwn(row, key)) return undefined;
    return (row as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * The columns a bound collection shows: the own keys of the first row that is a
 * record.
 *
 * The catalog declares no `columns` prop, so the shape of the published records
 * is the only statement of what a table's columns are. Taking the *first*
 * record — rather than the union of every row's keys — keeps the header stable
 * and ordered as the host published it; a later row carrying an extra key
 * contributes nothing rather than widening the table halfway down.
 */
function deriveColumns(rows: readonly unknown[]): readonly string[] {
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    try {
      return Object.keys(row);
    } catch {
      return [];
    }
  }
  return [];
}

/** What one cell shows. Only scalars render; a structure degrades to a blank. */
function cellText(row: unknown, column: string): string {
  const value = safeOwnValue(row, column);
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return String(value);
  return "";
}

/** A published collection of records, as rows and columns. */
export const Table: MountedComponent<ReactNode, ReactNode> = (mount) => {
  const raw = mount.props["rows"];
  const rows: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const caption = readString(mount, "caption", "");
  const columns = deriveColumns(rows);

  const tableStyle: FlowStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: foundation("typography", "fontFamilySans"),
    fontSize: foundation("typography", "fontSizeSm"),
    color: recipe("table", "text"),
  };
  const captionStyle: FlowStyle = {
    textAlign: "left",
    paddingBottom: foundation("space", "xs"),
    color: recipe("table", "captionText"),
    fontSize: foundation("typography", "fontSizeXs"),
  };
  const cellStyle: FlowStyle = {
    textAlign: "left",
    padding: recipe("table", "cellPadding"),
    borderBottom: `${foundation("borderWidth", "thin")} solid ${recipe("table", "rowBorder")}`,
  };
  const headerStyle: FlowStyle = {
    ...cellStyle,
    fontWeight: foundation("typography", "fontWeightMedium"),
    color: recipe("table", "headerText"),
    background: recipe("table", "headerBg"),
  };

  return (
    <table style={mountStyle(mount.themeVars, tableStyle)}>
      {caption === "" ? null : <caption style={flowStyle(captionStyle)}>{caption}</caption>}
      {columns.length === 0 ? null : (
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" style={flowStyle(headerStyle)}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {columns.length === 0
          ? null
          : rows.map((row, index) => (
              // Published rows carry no identity of their own, so position in the
              // bound collection is the only honest key.
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} style={flowStyle(cellStyle)}>
                    {cellText(row, column)}
                  </td>
                ))}
              </tr>
            ))}
      </tbody>
    </table>
  );
};
