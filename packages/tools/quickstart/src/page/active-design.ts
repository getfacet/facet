import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { bootstrapRenderer } from "@facet/react";
import type { ComponentRegistry, RendererBootstrap } from "@facet/react";
import type { FacetTheme } from "@facet/core";

import {
  resolveQuickstartDesignOverlay,
  type QuickstartDesignNote,
  type QuickstartDesignOverlay,
  type QuickstartResolvedDesignExample,
} from "../design-overlay.js";

export type QuickstartActiveDesignMode = "default" | "overlay";

export interface QuickstartActiveDesignSummary {
  readonly mode: QuickstartActiveDesignMode;
  readonly defaultRegistryTags: readonly string[];
  readonly customRegistryTags: readonly string[];
  readonly registryTags: readonly string[];
  readonly notes: readonly QuickstartDesignNote[];
}

export interface QuickstartPageActiveDesign extends QuickstartActiveDesignSummary {
  readonly bootstrap: Extract<RendererBootstrap, { readonly ok: true }>;
  readonly examples: readonly QuickstartResolvedDesignExample[];
}

export interface QuickstartPageActiveDesignError {
  readonly code: string;
  readonly at: string;
  readonly detail: string;
}

export type QuickstartPageActiveDesignResult =
  | { readonly ok: true; readonly design: QuickstartPageActiveDesign }
  | { readonly ok: false; readonly error: QuickstartPageActiveDesignError };

export interface ResolveQuickstartPageActiveDesignOptions {
  readonly overlay?: QuickstartDesignOverlay;
  readonly defaultRegistry?: ComponentRegistry;
  readonly theme?: FacetTheme;
}

const DEFAULT_REGISTRY_TAGS = Object.freeze(
  DEFAULT_CATALOG.components.map((component) => component.tag),
);

export function resolveQuickstartPageActiveDesign(
  options: ResolveQuickstartPageActiveDesignOptions = {},
): QuickstartPageActiveDesignResult {
  const defaultRegistry = options.defaultRegistry ?? DEFAULT_REGISTRY;
  if (options.overlay === undefined) {
    return fromDefaults(defaultRegistry, options.theme ?? DEFAULT_THEME);
  }

  const resolved = resolveQuickstartDesignOverlay(options.overlay);
  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        code: resolved.error.code,
        at: resolved.error.at,
        detail: resolved.error.detail,
      },
    };
  }

  const registry: ComponentRegistry = Object.freeze({
    ...defaultRegistry,
    ...resolved.design.customRegistry,
  });
  const bootstrap = bootstrapRenderer({
    catalog: resolved.design.catalog,
    registry,
    theme: resolved.design.theme,
    themeExtensions: resolved.design.themeExtensions,
  });
  if (!bootstrap.ok) {
    return bootstrapFailure(bootstrap);
  }

  return {
    ok: true,
    design: Object.freeze({
      mode: "overlay",
      bootstrap,
      defaultRegistryTags: resolved.design.defaultRegistryTags,
      customRegistryTags: resolved.design.customRegistryTags,
      registryTags: resolved.design.registryTags,
      examples: resolved.design.examples,
      notes: resolved.design.notes,
    }),
  };
}

function fromDefaults(
  defaultRegistry: ComponentRegistry,
  theme: FacetTheme,
): QuickstartPageActiveDesignResult {
  const bootstrap = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry: defaultRegistry,
    theme,
  });
  if (!bootstrap.ok) {
    return bootstrapFailure(bootstrap);
  }
  return {
    ok: true,
    design: Object.freeze({
      mode: "default",
      bootstrap,
      defaultRegistryTags: DEFAULT_REGISTRY_TAGS,
      customRegistryTags: Object.freeze([]),
      registryTags: DEFAULT_REGISTRY_TAGS,
      examples: Object.freeze([]),
      notes: Object.freeze([]),
    }),
  };
}

function bootstrapFailure(
  rejection: Extract<RendererBootstrap, { readonly ok: false }>,
): QuickstartPageActiveDesignResult {
  return {
    ok: false,
    error: {
      code: "active_design_bootstrap_failed",
      at: rejection.at,
      detail: `${rejection.code}: ${rejection.detail}`,
    },
  };
}
