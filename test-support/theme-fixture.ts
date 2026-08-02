import { FACET_THEME_CONTRACT, validateTheme } from "../packages/core/core/src/index.js";
import type {
  FacetCatalog,
  FacetTheme,
  FacetThemeExtensionDeclaration,
  FacetThemeGroupSpec,
  FacetThemeTokenValueKind,
} from "../packages/core/core/src/index.js";

type TokenLayerPatch = Readonly<Record<string, Readonly<Record<string, string>>>>;

interface TestThemeInputOptions {
  readonly foundation?: TokenLayerPatch;
  readonly semantic?: TokenLayerPatch;
  readonly recipes?: TokenLayerPatch;
  readonly extensions?: TokenLayerPatch;
}

interface ValidTestThemeOptions extends TestThemeInputOptions {
  readonly catalog?: FacetCatalog;
  readonly themeExtensions?: readonly FacetThemeExtensionDeclaration[];
}

export function completeThemeInput(options: TestThemeInputOptions = {}): Record<string, unknown> {
  return {
    foundation: completeLayer("foundation", FACET_THEME_CONTRACT.foundation, options.foundation),
    semantic: completeLayer("semantic", FACET_THEME_CONTRACT.semantic, options.semantic),
    ...(options.recipes === undefined ? {} : { recipes: copyLayer(options.recipes) }),
    ...(options.extensions === undefined ? {} : { extensions: copyLayer(options.extensions) }),
  };
}

export function validTestTheme(options: ValidTestThemeOptions = {}): FacetTheme {
  const validationOptions = {
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    ...(options.themeExtensions === undefined ? {} : { extensions: options.themeExtensions }),
  };
  const result = validateTheme(completeThemeInput(options), validationOptions);
  if (!result.ok) {
    throw new Error(`expected theme acceptance, got ${result.code} at ${result.at}`);
  }
  return result.theme;
}

function completeLayer(
  layer: "foundation" | "semantic",
  groups: readonly FacetThemeGroupSpec[],
  patch: TokenLayerPatch | undefined,
): TokenLayerPatch {
  return Object.fromEntries(
    groups.map((group) => [
      group.name,
      Object.fromEntries(
        group.tokens.map((token) => [
          token.name,
          patch?.[group.name]?.[token.name] ?? defaultTokenValue(layer, token.kind),
        ]),
      ),
    ]),
  );
}

function copyLayer(layer: TokenLayerPatch): TokenLayerPatch {
  return Object.fromEntries(
    Object.entries(layer).map(([group, tokens]) => [
      group,
      Object.fromEntries(Object.entries(tokens)),
    ]),
  );
}

function defaultTokenValue(
  layer: "foundation" | "semantic",
  kind: FacetThemeTokenValueKind,
): string {
  if (kind === "color") return layer === "foundation" ? "#64748b" : "#0f172a";
  if (kind === "length") return "1rem";
  if (kind === "number") return "1";
  if (kind === "opacity") return "1";
  if (kind === "fontFamily") return "system-ui, sans-serif";
  if (kind === "fontWeight") return "400";
  if (kind === "lineHeight") return "1.5";
  if (kind === "duration") return "150ms";
  if (kind === "easing") return "ease";
  if (kind === "shadow") return "none";
  if (kind === "effect") return "none";
  return "solid";
}
