/** Renderer-owned ephemeral interaction states. Agents cannot add selectors. */
export const INTERACTION_STATES = ["hover", "pressed", "focus"] as const;
export type InteractionState = (typeof INTERACTION_STATES)[number];

/** Closed CSS-facing properties supported by the ephemeral state contract. */
export const INTERACTION_PROPERTIES = [
  "background",
  "color",
  "borderColor",
  "borderWidth",
  "shadow",
  "highlight",
] as const;
export type InteractionProperty = (typeof INTERACTION_PROPERTIES)[number];

export const INTERACTION_CLASS = "facet-interaction";

const CSS_PROPERTIES: Readonly<Record<InteractionProperty, string>> = {
  background: "background",
  color: "color",
  borderColor: "border-color",
  borderWidth: "border-width",
  shadow: "box-shadow",
  highlight: "background-image",
};

const STATE_SELECTORS: Readonly<Record<InteractionState, string>> = {
  hover: ":hover",
  pressed: ":active",
  focus: ":focus-visible",
};

const STATE_PROPERTIES: Readonly<Record<InteractionState, readonly InteractionProperty[]>> = {
  hover: ["background", "color", "borderColor", "borderWidth", "shadow", "highlight"],
  pressed: ["background", "color", "borderColor", "shadow", "highlight"],
  focus: ["color", "borderColor", "borderWidth", "shadow", "highlight"],
};

export function interactionClass(state: InteractionState, property: InteractionProperty): string {
  return `facet-${state}-${property}`;
}

export function interactionVariable(
  state: InteractionState,
  property: InteractionProperty,
): `--facet-${InteractionState}-${InteractionProperty}` {
  return `--facet-${state}-${property}`;
}

/**
 * Fixed stylesheet used by renderers that opt a known target/property into an
 * ephemeral state. Values enter only through validated Theme-backed variables;
 * document data never becomes a selector, declaration name, or raw CSS rule.
 */
export const INTERACTION_CSS = INTERACTION_STATES.flatMap((state) =>
  STATE_PROPERTIES[state].map((property) => {
    const className = interactionClass(state, property);
    const variable = interactionVariable(state, property);
    const borderStyle = property === "borderWidth" ? ";border-style:solid!important" : "";
    return `.${INTERACTION_CLASS}.${className}${STATE_SELECTORS[state]}{${CSS_PROPERTIES[property]}:var(${variable})!important${borderStyle}}`;
  }),
).join("\n");
