/**
 * `@facet/assets` — the default design system and the default component
 * catalog, as plain data.
 *
 * Three symbols, and they are the whole root surface. Every other module in
 * this package is private: `theme-default.ts` holds the token values, the four
 * `specs-*.ts` modules hold the component specs, and `catalog.ts` composes
 * them. None of the five is a package entry point, and the barrel names them
 * explicitly rather than re-exporting a module wholesale, so what this package
 * publishes is decided here and cannot widen by accident (D-12: no `export *`,
 * anywhere).
 *
 * This entry is **Node-safe**: it imports no React and touches no browser
 * global, so a server that only needs the catalog and the theme never pulls a
 * renderer in behind them. The trusted React implementations of these same
 * default components live behind the explicit `@facet/assets/react` subpath,
 * which is the one place in this package React appears.
 */

export { DEFAULT_THEME } from "./theme-default.js";
export { DEFAULT_CATALOG, DEFAULT_COMPONENT_SPECS } from "./catalog.js";
