/**
 * The mount contract — what a trusted registered component is handed, and what
 * the registry holds.
 *
 * This module lives in `@facet/core` and **names nothing outside itself**. That
 * is the whole point of it, not an incidental property: `@facet/assets/react`
 * ships the default trusted React implementations, and its only dependencies
 * are `@facet/core` and `react`. If the contract those implementations are
 * written against lived in `@facet/react`, the renderer would have to depend on
 * assets to mount them and assets would depend on the renderer to be written —
 * a cycle. Declaring it here means the edge runs one way and cannot be turned
 * around later (D-09). A dependency-free core is also what keeps this file
 * honest: there is no React type, no DOM type and no sibling module to reach
 * for, so nothing here can quietly acquire a runtime.
 *
 * Being React-free is not the same as being useless to React. The element type
 * a renderer works in is a **type parameter**, so `@facet/assets/react` supplies
 * React's own `ReactNode` and writes ordinary components, while this file never
 * learns what React is. Widening `children` to `unknown` instead would push a
 * cast into every trusted component, which is a worse place for one.
 *
 * These are **types only**: the module emits no runtime code at all, asserted in
 * `mount-contract.test.ts` against both this source and the declaration `tsc`
 * emits for it. A source-only check would not be enough — a type-only import is
 * erased before any test runs, so it could reach the emitted `.d.ts` unseen.
 */

/**
 * Everything one mounted component receives.
 *
 * `props` are **resolved**: a scalar the author wrote, or the value a
 * `data:path` binding selected from the Data Model. The union is the same one
 * `resolveBinding` produces — spelled out structurally here rather than imported
 * (this module imports nothing) and pinned to the resolver's declaration in both
 * directions by the test, so the two cannot drift into two vocabularies.
 *
 * `themeVars` are the CSS custom properties `themeToCssVars` projects. A
 * component styles itself from those names and nothing else; there is no raw
 * CSS and no open style bag on this contract.
 *
 * The two callbacks are the only ways a component reports back, and Facet — not
 * the component — owns what happens next. Neither returns anything: a component
 * cannot navigate, mutate the document, or decide whether an event is sent.
 */
export type CollectedValue = string | boolean | readonly string[];

/** The catalog spelling of each collected value branch. */
export type CollectedValueKind = "string" | "boolean" | "string[]";

export interface ComponentMountProps<Children = unknown> {
  /**
   * The node's resolved props, keyed by the declared prop name. Every value has
   * already been checked against the component's declared schema.
   */
  readonly props: Readonly<
    Record<
      string,
      string | number | boolean | readonly unknown[] | { readonly [key: string]: unknown }
    >
  >;
  /** The already-mounted children, in document order. */
  readonly children: Children;
  /** Named regions for a structured component, already mounted and frozen. */
  readonly slots: Readonly<Record<string, Children>>;
  /** The active theme's custom properties, ready to put on a style attribute. */
  readonly themeVars: Readonly<Record<string, string>>;
  /**
   * Reports that the visitor activated the interaction declared on `prop` — the
   * name of the component's own declared prop that carries the action reference,
   * such as `"action"` on a button.
   *
   * Always injected, because any component may declare an action prop. The
   * renderer holds the node, resolves the reference, and decides what the action
   * means; naming a prop that carries no action reference is a **no-op**, never
   * an error, so a component can report an interaction without first knowing
   * whether the author wired one up. Passing the prop name rather than nothing
   * is also what lets a component declare more than one actionable prop without
   * a second callback.
   */
  readonly onAction: (prop: string) => void;
  /**
   * Reports the visitor's new value for a **collectable** component.
   *
   * Present only when the active catalog declares the component collectable, so
   * it is optional here and guaranteed by `CollectableMount`. Facet owns the
   * value: it arrives back through `props` under the catalog-declared value
   * prop, and the component never stamps it anywhere for Facet to read (D-08).
   */
  readonly onValueChange?: (value: CollectedValue) => void;
}

/**
 * The mount payload of a component the catalog declared collectable: exactly
 * `ComponentMountProps`, with `onValueChange` guaranteed.
 *
 * It is **derived from** the ordinary payload rather than restating it, so a
 * field added there appears here and the callback's signature exists in one
 * place. A collectable mount is therefore usable anywhere an ordinary one is.
 */
export type CollectableMount<Children = unknown> = ComponentMountProps<Children> &
  Required<Pick<ComponentMountProps<Children>, "onValueChange">>;

/**
 * A trusted component implementation: mount props in, a rendered thing out.
 *
 * Both the children type and the rendered type are the consumer's — in React,
 * `MountedComponent<ReactNode, ReactNode>`, which an ordinary function component
 * satisfies as written. This is the value a registry stores against a tag.
 */
export type MountedComponent<Children = unknown, Rendered = unknown> = (
  props: ComponentMountProps<Children>,
) => Rendered;
