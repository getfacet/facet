export const PRODUCT_AREA_IDS = ["catalog", "generate", "runs", "replay", "sandbox"] as const;
export type ProductAreaId = (typeof PRODUCT_AREA_IDS)[number];

export type LabRouteId =
  | "catalog"
  | "generate"
  | "scenarios"
  | "runs"
  | "run-detail"
  | "replay"
  | "compare"
  | "sandbox"
  | "settings";

export interface LabRouteDefinition {
  readonly id: LabRouteId;
  readonly areaId: ProductAreaId;
  readonly label: string;
  readonly path: string;
}

export interface ProductAreaDefinition {
  readonly id: ProductAreaId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly path: string;
  readonly routes: readonly LabRouteId[];
}

export interface ResolvedLabRoute {
  readonly id: LabRouteId | "not-found";
  readonly areaId: ProductAreaId | null;
  readonly label: string;
  readonly path: string;
  readonly runId: string | null;
}

export type ProductNavigationKey =
  "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export interface RouteFocusTarget {
  focus(options?: FocusOptions): void;
}

export interface RouteViewport {
  scrollTo(options: ScrollToOptions): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const LAB_ROUTES: readonly LabRouteDefinition[] = Object.freeze([
  { id: "catalog", areaId: "catalog", label: "Catalog", path: "/catalog" },
  { id: "generate", areaId: "generate", label: "Generate", path: "/generate" },
  { id: "scenarios", areaId: "generate", label: "Scenarios", path: "/scenarios" },
  { id: "runs", areaId: "runs", label: "Run history", path: "/runs" },
  { id: "run-detail", areaId: "runs", label: "Run detail", path: "/runs/:runId" },
  { id: "replay", areaId: "replay", label: "Replay", path: "/replay" },
  { id: "compare", areaId: "replay", label: "Compare", path: "/compare" },
  { id: "sandbox", areaId: "sandbox", label: "Sandbox", path: "/sandbox" },
  { id: "settings", areaId: "sandbox", label: "Settings", path: "/settings" },
]);

export const PRODUCT_AREAS: readonly ProductAreaDefinition[] = Object.freeze([
  {
    id: "catalog",
    label: "Catalog",
    shortLabel: "01",
    description: "Inspect the complete Brick, Pattern, Preset, and style vocabulary.",
    path: "/catalog",
    routes: ["catalog"],
  },
  {
    id: "generate",
    label: "Generate",
    shortLabel: "02",
    description: "Run free-form prompts and the official capability scenarios.",
    path: "/generate",
    routes: ["generate", "scenarios"],
  },
  {
    id: "runs",
    label: "Runs",
    shortLabel: "03",
    description: "Inspect immutable history, trace, evaluations, and artifacts.",
    path: "/runs",
    routes: ["runs", "run-detail"],
  },
  {
    id: "replay",
    label: "Replay",
    shortLabel: "04",
    description: "Replay accepted checkpoints and compare recorded outcomes.",
    path: "/replay",
    routes: ["replay", "compare"],
  },
  {
    id: "sandbox",
    label: "Sandbox",
    shortLabel: "05",
    description: "Edit isolated Facet trees and inspect safe server capabilities.",
    path: "/sandbox",
    routes: ["sandbox", "settings"],
  },
]);

function normalizePath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) {
    return "/__invalid__";
  }
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/u, "") || "/";
}

function resolved(
  definition: LabRouteDefinition,
  path: string,
  runId: string | null,
): ResolvedLabRoute {
  return Object.freeze({
    id: definition.id,
    areaId: definition.areaId,
    label: definition.label,
    path,
    runId,
  });
}

export function resolveLabRoute(pathname: string): ResolvedLabRoute {
  const path = normalizePath(pathname);
  const effectivePath = path === "/" ? "/catalog" : path;
  const replayMatch = /^\/replay\/([^/]+)$/u.exec(effectivePath);
  if (replayMatch !== null) {
    const runId = replayMatch[1];
    const definition = LAB_ROUTES.find(({ id }) => id === "replay");
    if (definition !== undefined && runId !== undefined && UUID.test(runId)) {
      return resolved(definition, effectivePath, runId);
    }
  }
  const runMatch = /^\/runs\/([^/]+)$/u.exec(effectivePath);
  if (runMatch !== null) {
    const runId = runMatch[1];
    const definition = LAB_ROUTES.find(({ id }) => id === "run-detail");
    if (definition !== undefined && runId !== undefined && UUID.test(runId)) {
      return resolved(definition, effectivePath, runId);
    }
  }
  const definition = LAB_ROUTES.find(
    (candidate) => candidate.id !== "run-detail" && candidate.path === effectivePath,
  );
  if (definition !== undefined) return resolved(definition, effectivePath, null);
  return Object.freeze({
    id: "not-found",
    areaId: null,
    label: "Page not found",
    path: effectivePath,
    runId: null,
  });
}

export function isProductAreaActive(areaId: ProductAreaId, route: ResolvedLabRoute): boolean {
  return route.areaId === areaId;
}

export function moveProductAreaFocus(current: ProductAreaId, key: string): ProductAreaId | null {
  const index = PRODUCT_AREA_IDS.indexOf(current);
  if (index < 0) return null;
  if (key === "Home") return PRODUCT_AREA_IDS[0];
  if (key === "End") return PRODUCT_AREA_IDS.at(-1) ?? null;
  const direction =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (direction === 0) return null;
  const target = (index + direction + PRODUCT_AREA_IDS.length) % PRODUCT_AREA_IDS.length;
  return PRODUCT_AREA_IDS[target] ?? null;
}

export function focusSelectedRoute(target: RouteFocusTarget | null, viewport: RouteViewport): void {
  target?.focus({ preventScroll: true });
  viewport.scrollTo({ top: 0, behavior: "auto" });
}

export function pathForRoute(routeId: Exclude<LabRouteId, "run-detail">): string {
  return LAB_ROUTES.find(({ id }) => id === routeId)?.path ?? "/catalog";
}

export function pathForRun(runId: string): string {
  if (!UUID.test(runId)) throw new Error("invalid run navigation identity");
  return `/runs/${runId}`;
}
