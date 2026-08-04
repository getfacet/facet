import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";

import {
  DEFAULT_THEME_CSS_VARS,
  DEFAULT_THEME_TOKEN_ROWS,
  type AssetTokenLayer,
  type AssetTokenRow,
} from "./asset-token-model.js";

const TOKEN_LAYERS: readonly AssetTokenLayer[] = ["foundation", "semantic", "recipe"];

interface TokenGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly AssetTokenRow[];
}

export interface ThemeInspectorProps {
  readonly rows?: readonly AssetTokenRow[];
}

export function ThemeInspector({
  rows = DEFAULT_THEME_TOKEN_ROWS,
}: ThemeInspectorProps = {}): ReactNode {
  const groupsByLayer = useMemo(() => groupRowsByLayer(rows), [rows]);
  const inspectorStyle = useMemo(
    (): CSSProperties => ({ ...styles.inspector, ...DEFAULT_THEME_CSS_VARS }),
    [],
  );

  return (
    <section aria-label="Theme inspector" data-facet-theme-inspector style={inspectorStyle}>
      <ThemeOverview rows={rows} />
      <FoundationShowcase rows={rows} />
      <SemanticShowcase rows={rows} />
      <RecipeShowcase rows={rows} />
      <details data-theme-raw-tokens style={styles.rawDetails}>
        <summary style={styles.rawSummary}>Raw tokens</summary>
        <RawTokenSections groupsByLayer={groupsByLayer} />
      </details>
    </section>
  );
}

function ThemeOverview({ rows }: { readonly rows: readonly AssetTokenRow[] }): ReactNode {
  const tokenCounts = TOKEN_LAYERS.map((layer) => ({
    layer,
    count: rows.filter((row) => row.layer === layer).length,
  }));

  return (
    <section
      aria-label="Default design system overview"
      data-theme-overview
      style={styles.overview}
    >
      <header style={styles.overviewHeader}>
        <h2 style={styles.overviewTitle}>Default design system</h2>
        <div style={styles.overviewStats}>
          {tokenCounts.map(({ layer, count }) => (
            <span data-theme-overview-count={layer} key={layer} style={styles.overviewStat}>
              {layer} {count}
            </span>
          ))}
        </div>
      </header>

      <div style={styles.overviewGrid}>
        <OverviewPanel id="system-map" meta="flow" title="System map">
          <div style={styles.systemMap}>
            {["Foundation", "Semantic", "Recipe", "Screens"].map((label, index) => (
              <div data-theme-system-map-step={label} key={label} style={styles.systemMapStep}>
                <span style={styles.systemMapIndex}>{index + 1}</span>
                <span style={styles.systemMapLabel}>{label}</span>
              </div>
            ))}
          </div>
        </OverviewPanel>

        <OverviewPanel id="meaning" meta="semantic" title="Meaning">
          <div style={styles.overviewMeaningGrid}>
            <SurfaceSample
              background={cssRef(rows, "semantic.surface.default", "#ffffff")}
              color={cssRef(rows, "semantic.text.default", "#17140f")}
              label="Surface"
            />
            <ActionSample
              background={cssRef(rows, "semantic.action.primaryBg", "#2e5aa7")}
              border={cssRef(rows, "semantic.action.primaryBorder", "#2e5aa7")}
              color={cssRef(rows, "semantic.action.primaryText", "#ffffff")}
              label="Action"
            />
            <span
              style={{
                ...styles.statusSample,
                background: cssRef(rows, "semantic.status.successBg", "#ecfdf5"),
                borderColor: cssRef(rows, "semantic.status.successBorder", "#a7f3d0"),
                color: cssRef(rows, "semantic.status.successText", "#047857"),
              }}
            >
              Status
            </span>
          </div>
        </OverviewPanel>

        <OverviewPanel id="recipe-map" meta="components" title="Recipe families">
          <div style={styles.recipeOverviewList}>
            {(
              [
                ["Button", "tone", "action color + shape + focus"],
                ["Card", "tone", "surface + status edge"],
                ["Text", "variant", "type scale + text color"],
              ] as const
            ).map(([component, token, target]) => (
              <span
                data-theme-recipe-overview={component}
                key={component}
                style={styles.recipeChain}
              >
                <span style={styles.recipeTokenName}>
                  {component}.{token}
                </span>
                <span style={styles.recipeArrow}>-&gt;</span>
                <span style={styles.recipeTokenValue}>{target}</span>
              </span>
            ))}
          </div>
        </OverviewPanel>

        <OverviewPanel id="screen-result" meta="output" title="Screen result">
          <div style={styles.overviewScreenSample}>
            <span style={styles.overviewScreenTitle}>Revenue overview</span>
            <span style={styles.overviewScreenMetric}>98,420 USD</span>
            <span style={styles.overviewScreenCard}>Card + badge + action</span>
          </div>
        </OverviewPanel>
      </div>
    </section>
  );
}

function OverviewPanel({
  children,
  id,
  meta,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly meta: string;
  readonly title: string;
}): ReactNode {
  return (
    <section data-theme-overview-panel={id} style={styles.overviewPanel}>
      <header style={styles.overviewPanelHeader}>
        <h3 style={styles.overviewPanelTitle}>{title}</h3>
        <span style={styles.overviewPanelMeta}>{meta}</span>
      </header>
      {children}
    </section>
  );
}

function SurfaceSample({
  background,
  color,
  label,
}: {
  readonly background: string;
  readonly color: string;
  readonly label: string;
}): ReactNode {
  return (
    <div data-theme-surface-sample={label} style={{ ...styles.surfaceSample, background, color }}>
      <span style={styles.surfaceSampleTitle}>{label}</span>
      <span style={styles.surfaceSampleLine} />
    </div>
  );
}

function TypeSample({
  fontSize,
  fontWeight,
  label,
  lineHeight,
}: {
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly label: string;
  readonly lineHeight: string;
}): ReactNode {
  return (
    <div
      data-theme-type-sample={label}
      style={{ ...styles.typeSample, fontSize, fontWeight, lineHeight }}
    >
      {label}
    </div>
  );
}

function ScaleSample({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <div data-theme-space-sample={label} style={styles.scaleSample}>
      <span style={styles.scaleLabel}>{label}</span>
      <span
        style={{
          ...styles.scaleBar,
          ["--theme-scale-value" as string]: value,
          width: "clamp(0.375rem, var(--theme-scale-value), 3rem)",
        }}
      />
    </div>
  );
}

function RadiusSample({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactNode {
  return (
    <div
      data-theme-radius-sample={label}
      style={{
        ...styles.radiusSample,
        borderRadius: "clamp(0.125rem, var(--theme-radius-value), 1rem)",
        ["--theme-radius-value" as string]: value,
      }}
    >
      {label}
    </div>
  );
}

function ActionSample({
  background,
  border,
  color,
  label,
}: {
  readonly background: string;
  readonly border: string;
  readonly color: string;
  readonly label: string;
}): ReactNode {
  return (
    <div
      data-theme-action-sample={label}
      style={{ ...styles.actionSample, background, borderColor: border, color }}
    >
      {label}
    </div>
  );
}

interface PaletteFamily {
  readonly name: string;
  readonly rows: readonly AssetTokenRow[];
}

const PALETTE_FAMILY_ORDER = [
  "brand",
  "neutral",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
  "categorical",
];

function groupPaletteFamilies(rows: readonly AssetTokenRow[]): readonly PaletteFamily[] {
  const groups = new Map<string, AssetTokenRow[]>();
  for (const row of rows) {
    const family = paletteFamilyName(row.token);
    const existing = groups.get(family) ?? [];
    groups.set(family, [...existing, row]);
  }

  return [...groups.entries()]
    .map(([name, familyRows]) => ({
      name,
      rows: familyRows.filter((_, index) => index % 2 === 0).slice(0, 6),
    }))
    .sort((left, right) => paletteFamilySort(left.name) - paletteFamilySort(right.name));
}

function paletteFamilyName(token: string): string {
  return token.replace(/\d+$/u, "");
}

function paletteFamilySort(name: string): number {
  const index = PALETTE_FAMILY_ORDER.indexOf(name);
  return index === -1 ? PALETTE_FAMILY_ORDER.length : index;
}

function paletteFamilyLabel(name: string): string {
  if (name === "brand") return "brand / primary";
  if (name === "accent") return "accent / support";
  if (["success", "warning", "danger", "info"].includes(name)) {
    return `${name} / status`;
  }
  return name;
}

function cssRef(rows: readonly AssetTokenRow[], path: string, fallback: string): string {
  return rows.find((row) => row.path === path)?.cssReference ?? fallback;
}

function tokenByPath(rows: readonly AssetTokenRow[], path: string): AssetTokenRow | null {
  return rows.find((row) => row.path === path) ?? null;
}

function layerRows(
  rows: readonly AssetTokenRow[],
  layer: AssetTokenLayer,
  group: string,
): readonly AssetTokenRow[] {
  return rows.filter((row) => {
    if (row.layer !== layer) return false;
    return row.layer === "recipe" ? row.namespace === group : row.group === group;
  });
}

function tokenTitle(row: AssetTokenRow | null, fallbackPath: string): string {
  if (row === null) return fallbackPath;
  return `${row.path}\n${row.value}\n${row.cssVariable}`;
}

function ShowcaseSection({
  children,
  count,
  description,
  layer,
  title,
}: {
  readonly children: ReactNode;
  readonly count: number;
  readonly description: string;
  readonly layer: AssetTokenLayer;
  readonly title: string;
}): ReactNode {
  return (
    <section
      aria-label={`${title} design system layer`}
      data-theme-showcase-layer={layer}
      style={styles.showcaseSection}
    >
      <header style={styles.showcaseHeader}>
        <div style={styles.showcaseTitleBlock}>
          <h2 style={styles.showcaseTitle}>{title}</h2>
          <p style={styles.showcaseDescription}>{description}</p>
        </div>
        <span style={styles.layerCount}>{count} tokens</span>
      </header>
      <div style={styles.showcaseGrid}>{children}</div>
    </section>
  );
}

function ShowcaseCard({
  children,
  id,
  meta,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly meta: string;
  readonly title: string;
}): ReactNode {
  return (
    <section data-theme-showcase-card={id} style={styles.showcaseCard}>
      <header style={styles.overviewPanelHeader}>
        <h3 style={styles.overviewPanelTitle}>{title}</h3>
        <span style={styles.overviewPanelMeta}>{meta}</span>
      </header>
      {children}
    </section>
  );
}

function FoundationShowcase({ rows }: { readonly rows: readonly AssetTokenRow[] }): ReactNode {
  const paletteRows = layerRows(rows, "foundation", "palette");
  const typographyRows = layerRows(rows, "foundation", "typography");
  const spaceRows = layerRows(rows, "foundation", "space");
  const sizeRows = layerRows(rows, "foundation", "size");
  const radiusRows = layerRows(rows, "foundation", "radius");
  const borderRows = layerRows(rows, "foundation", "borderWidth");
  const shadowRows = layerRows(rows, "foundation", "shadow");
  const opacityRows = layerRows(rows, "foundation", "opacity");
  const motionRows = layerRows(rows, "foundation", "motion");
  const effectRows = layerRows(rows, "foundation", "effect");
  const breakpointRows = layerRows(rows, "foundation", "breakpoint");
  const densityRows = layerRows(rows, "foundation", "density");

  return (
    <ShowcaseSection
      count={rows.filter((row) => row.layer === "foundation").length}
      description="Raw material: color, type, space, size, shape, depth and motion scales."
      layer="foundation"
      title="Foundation"
    >
      <ShowcaseCard id="foundation-palette" meta={`${paletteRows.length} colors`} title="Palette">
        <div style={styles.paletteStack}>
          {groupPaletteFamilies(paletteRows).map((family) => (
            <div
              data-theme-palette-family={family.name}
              key={family.name}
              style={styles.paletteRow}
            >
              <span style={styles.paletteLabel}>{paletteFamilyLabel(family.name)}</span>
              <div style={styles.paletteSwatches}>
                {family.rows.map((row) => (
                  <span
                    aria-label={row.path}
                    data-theme-palette-swatch={row.path}
                    key={row.path}
                    style={{ ...styles.paletteSwatch, background: row.visual.value }}
                    title={tokenTitle(row, row.path)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ShowcaseCard>

      <ShowcaseCard
        id="foundation-typography"
        meta={`${typographyRows.length} tokens`}
        title="Typography"
      >
        <div style={styles.typeSamples}>
          {(
            [
              ["Display", "fontSize5xl", "fontWeightBold", "lineHeightTight"],
              ["Title", "fontSize3xl", "fontWeightBold", "lineHeightTight"],
              ["Heading", "fontSizeXl", "fontWeightSemibold", "lineHeightSnug"],
              ["Body", "fontSizeMd", "fontWeightRegular", "lineHeightNormal"],
              ["Caption", "fontSizeXs", "fontWeightRegular", "lineHeightNormal"],
            ] as const
          ).map(([label, size, weight, lineHeight]) => {
            const sizePath = `foundation.typography.${size}`;
            return (
              <TypeSample
                fontSize={cssRef(rows, sizePath, "1rem")}
                fontWeight={cssRef(rows, `foundation.typography.${weight}`, "400")}
                key={label}
                label={label}
                lineHeight={cssRef(rows, `foundation.typography.${lineHeight}`, "1.4")}
              />
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="foundation-space" meta={`${spaceRows.length} tokens`} title="Space">
        <div style={styles.scaleSamples}>
          {["micro", "tiny", "xs", "sm", "md", "lg", "xl", "xxl", "xxxl"].map((token) => (
            <ScaleSample
              key={token}
              label={token}
              value={cssRef(rows, `foundation.space.${token}`, "0.75rem")}
            />
          ))}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="foundation-size" meta={`${sizeRows.length} tokens`} title="Size">
        <div style={styles.sizeSamples}>
          {["controlHeightSm", "controlHeightMd", "controlHeightLg", "controlHeightXl"].map(
            (token) => {
              const path = `foundation.size.${token}`;
              return (
                <span
                  data-theme-size-sample={token}
                  key={token}
                  style={{
                    ...styles.sizeSample,
                    ["--theme-size-value" as string]: cssRef(rows, path, "2rem"),
                    height: "clamp(1.5rem, var(--theme-size-value), 3.5rem)",
                  }}
                  title={tokenTitle(tokenByPath(rows, path), path)}
                >
                  {token.replace("controlHeight", "")}
                </span>
              );
            },
          )}
        </div>
        <div style={styles.measureSamples}>
          {["contentMeasureSm", "contentMeasureMd", "contentMeasureLg"].map((token) => {
            const path = `foundation.size.${token}`;
            return (
              <span
                data-theme-measure-sample={token}
                key={token}
                style={styles.measureSample}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token.replace("contentMeasure", "measure ")}
              </span>
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard
        id="foundation-shape"
        meta={`${radiusRows.length + borderRows.length} tokens`}
        title="Radius + border"
      >
        <div style={styles.radiusSamples}>
          {["none", "xs", "sm", "md", "lg", "xl", "xxl", "full"].map((token) => (
            <RadiusSample
              key={token}
              label={token}
              value={cssRef(rows, `foundation.radius.${token}`, "0.5rem")}
            />
          ))}
        </div>
        <div style={styles.borderSamples}>
          {["hairline", "thin", "medium", "thick"].map((token) => {
            const path = `foundation.borderWidth.${token}`;
            return (
              <span
                data-theme-border-sample={token}
                key={token}
                style={{
                  ...styles.borderSample,
                  borderWidth: `clamp(1px, ${cssRef(rows, path, "1px")}, 8px)`,
                }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="foundation-depth" meta={`${shadowRows.length} tokens`} title="Shadow">
        <div style={styles.shadowSamples}>
          {["xs", "sm", "md", "lg", "xl", "inner"].map((token) => {
            const path = `foundation.shadow.${token}`;
            return (
              <span
                data-theme-shadow-sample={token}
                key={token}
                style={{ ...styles.shadowSample, boxShadow: cssRef(rows, path, "none") }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard
        id="foundation-opacity-motion"
        meta={`${opacityRows.length + motionRows.length} tokens`}
        title="Opacity + motion"
      >
        <div style={styles.opacitySamples}>
          {["disabled", "muted", "overlay", "visible"].map((token) => {
            const path = `foundation.opacity.${token}`;
            return (
              <span
                data-theme-opacity-sample={token}
                key={token}
                style={{ ...styles.opacitySample, opacity: cssRef(rows, path, "1") }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
        <div style={styles.motionSamples}>
          {["durationFast", "durationNormal", "durationSlow", "easeStandard"].map((token) => {
            const path = `foundation.motion.${token}`;
            return (
              <span data-theme-motion-sample={token} key={token} style={styles.motionSample}>
                <span style={styles.motionDot} />
                <span title={tokenTitle(tokenByPath(rows, path), path)}>{token}</span>
              </span>
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard
        id="foundation-system"
        meta={`${effectRows.length + breakpointRows.length + densityRows.length} tokens`}
        title="Effect + layout system"
      >
        <div style={styles.effectSamples}>
          {["blurSm", "blurMd", "backdropMuted"].map((token) => {
            const path = `foundation.effect.${token}`;
            return (
              <span
                data-theme-effect-sample={token}
                key={token}
                style={{ ...styles.effectSample, filter: cssRef(rows, path, "none") }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
        <div style={styles.breakpointSamples}>
          {["xs", "sm", "md", "lg", "xl", "xxl"].map((token) => {
            const path = `foundation.breakpoint.${token}`;
            return (
              <span
                data-theme-breakpoint-sample={token}
                key={token}
                style={styles.breakpointSample}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
        <div style={styles.densitySamples}>
          {["compact", "comfortable", "spacious"].map((token) => {
            const path = `foundation.density.${token}`;
            return (
              <span
                data-theme-density-sample={token}
                key={token}
                style={{
                  ...styles.densitySample,
                  paddingBlock:
                    token === "compact"
                      ? "0.25rem"
                      : token === "comfortable"
                        ? "0.5rem"
                        : "0.75rem",
                }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
        </div>
      </ShowcaseCard>
    </ShowcaseSection>
  );
}

function SemanticShowcase({ rows }: { readonly rows: readonly AssetTokenRow[] }): ReactNode {
  const semanticRows = rows.filter((row) => row.layer === "semantic");

  return (
    <ShowcaseSection
      count={semanticRows.length}
      description="Meaning: surfaces, text, actions, status, focus, overlays and UI states."
      layer="semantic"
      title="Semantic"
    >
      <ShowcaseCard id="semantic-surface" meta="canvas + surface" title="Canvas + surfaces">
        <div style={styles.surfaceSamples}>
          {(
            [
              ["Canvas", "semantic.canvas.background", "semantic.text.default"],
              ["Muted", "semantic.surface.muted", "semantic.text.default"],
              ["Raised", "semantic.surface.raised", "semantic.text.default"],
              ["Inverse", "semantic.surface.inverse", "semantic.text.inverse"],
            ] as const
          ).map(([label, backgroundPath, textPath]) => (
            <SurfaceSample
              background={cssRef(rows, backgroundPath, "#ffffff")}
              color={cssRef(rows, textPath, "#17140f")}
              key={label}
              label={label}
            />
          ))}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="semantic-text" meta="text roles" title="Text">
        <div style={styles.semanticTextSamples}>
          {["default", "muted", "subtle", "disabled", "link"].map((token) => {
            const path = `semantic.text.${token}`;
            return (
              <span
                data-theme-semantic-text={token}
                key={token}
                style={{ color: cssRef(rows, path, "#17140f") }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token} text
              </span>
            );
          })}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="semantic-action" meta="buttons" title="Actions">
        <div style={styles.actionSamples}>
          {(
            [
              ["Primary", "primaryBg", "primaryText", "primaryBorder"],
              ["Primary hover", "primaryHoverBg", "primaryText", "primaryBorder"],
              ["Secondary", "secondaryBg", "secondaryText", "secondaryBorder"],
              ["Tertiary", "tertiaryBg", "tertiaryText", "transparent"],
              ["Destructive", "destructiveBg", "destructiveText", "destructiveBg"],
            ] as const
          ).map(([label, bg, text, border]) => (
            <ActionSample
              background={cssRef(rows, `semantic.action.${bg}`, bg)}
              border={
                border === "transparent"
                  ? "transparent"
                  : cssRef(rows, `semantic.action.${border}`, border)
              }
              color={cssRef(rows, `semantic.action.${text}`, text)}
              key={label}
              label={label}
            />
          ))}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="semantic-status" meta="status + validation" title="Status">
        <div style={styles.statusSamples}>
          {["neutral", "success", "warning", "danger", "info"].map((tone) => (
            <span
              data-theme-status-sample={tone}
              key={tone}
              style={{
                ...styles.statusSample,
                background: cssRef(rows, `semantic.status.${tone}Bg`, "#ffffff"),
                borderColor: cssRef(rows, `semantic.status.${tone}Border`, "#d9ccb2"),
                color: cssRef(rows, `semantic.status.${tone}Text`, "#17140f"),
              }}
            >
              {tone}
            </span>
          ))}
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="semantic-state" meta="state + focus" title="State + focus">
        <div style={styles.stateSamples}>
          {["hoverBg", "activeBg", "selectedBg", "pressedBg"].map((token) => {
            const path = `semantic.state.${token}`;
            return (
              <span
                data-theme-state-sample={token}
                key={token}
                style={{ ...styles.stateSample, background: cssRef(rows, path, "#f8fafc") }}
                title={tokenTitle(tokenByPath(rows, path), path)}
              >
                {token}
              </span>
            );
          })}
          <span
            data-theme-focus-sample
            style={{
              ...styles.focusSample,
              boxShadow: `0 0 0 ${cssRef(rows, "semantic.focus.ringWidth", "3px")} ${cssRef(
                rows,
                "semantic.focus.ringColor",
                "#2e5aa7",
              )}`,
            }}
          >
            focus
          </span>
        </div>
      </ShowcaseCard>

      <ShowcaseCard id="semantic-system" meta="overlay + loading + layer" title="System states">
        <div style={styles.systemSamples}>
          <span
            data-theme-overlay-sample
            style={{
              ...styles.systemSample,
              background: cssRef(rows, "semantic.overlay.scrim", "rgba(0,0,0,.4)"),
              color: cssRef(rows, "semantic.text.inverse", "#ffffff"),
            }}
          >
            overlay
          </span>
          <span
            data-theme-loading-sample
            style={{
              ...styles.systemSample,
              background: `linear-gradient(90deg, ${cssRef(
                rows,
                "semantic.loading.skeletonBase",
                "#e2e8f0",
              )}, ${cssRef(rows, "semantic.loading.skeletonHighlight", "#f8fafc")})`,
            }}
          >
            loading
          </span>
          <span
            data-theme-layer-sample
            style={{
              ...styles.systemSample,
              boxShadow: cssRef(rows, "semantic.layer.raisedShadow", "none"),
            }}
          >
            layer
          </span>
        </div>
      </ShowcaseCard>
    </ShowcaseSection>
  );
}

function RecipeShowcase({ rows }: { readonly rows: readonly AssetTokenRow[] }): ReactNode {
  const recipeRows = rows.filter((row) => row.layer === "recipe");
  const namespaces = [...new Set(recipeRows.map((row) => row.namespace))];

  return (
    <ShowcaseSection
      count={recipeRows.length}
      description="Application: component recipes bind semantic and foundation values into concrete UI families."
      layer="recipe"
      title="Recipe"
    >
      {namespaces.map((namespace) => {
        const namespaceRows = layerRows(rows, "recipe", namespace);
        return (
          <ShowcaseCard
            id={`recipe-${namespace}`}
            key={namespace}
            meta={`${namespaceRows.length} tokens`}
            title={titleCase(namespace)}
          >
            <div style={styles.recipeChainList}>
              {namespaceRows.map((row) => (
                <span data-theme-recipe-chain={row.path} key={row.path} style={styles.recipeChain}>
                  <span style={styles.recipeTokenName}>{row.token}</span>
                  <span style={styles.recipeArrow}>-&gt;</span>
                  <span style={styles.recipeTokenValue} title={tokenTitle(row, row.path)}>
                    {row.visual.referencedVariables[0]?.replace("--facet-", "") ?? row.value}
                  </span>
                </span>
              ))}
            </div>
          </ShowcaseCard>
        );
      })}
    </ShowcaseSection>
  );
}

function RawTokenSections({
  groupsByLayer,
}: {
  readonly groupsByLayer: ReadonlyMap<AssetTokenLayer, readonly TokenGroup[]>;
}): ReactNode {
  return (
    <div style={styles.rawTokenGrid}>
      {TOKEN_LAYERS.map((layer) => {
        const groups = groupsByLayer.get(layer) ?? [];
        return (
          <section
            aria-label={`${titleCase(layer)} theme tokens`}
            data-token-layer={layer}
            key={layer}
            role="region"
            style={styles.layerSection}
          >
            <header style={styles.layerHeader}>
              <h2 style={styles.layerTitle}>{titleCase(layer)}</h2>
              <span style={styles.layerCount}>{countRows(groups)} tokens</span>
            </header>
            <div style={styles.groupStack}>
              {groups.map((group) => (
                <section
                  data-token-group-section={group.key}
                  key={group.key}
                  style={styles.groupSection}
                >
                  <header style={styles.groupHeader}>
                    <h3 style={styles.groupTitle}>{group.label}</h3>
                    <span style={styles.groupCount}>{group.rows.length}</span>
                  </header>
                  <div style={styles.tokenList}>
                    {group.rows.map((row) => (
                      <TokenRow key={row.path} row={row} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TokenRow({ row }: { readonly row: AssetTokenRow }): ReactNode {
  const group = groupKey(row);
  return (
    <article
      data-theme-token-row
      data-token-group={group}
      data-token-kind={row.visual.kind}
      data-token-path={row.path}
      style={styles.tokenRow}
    >
      <TokenVisual row={row} />
      <div style={styles.tokenText}>
        <code style={styles.pathCode}>{row.path}</code>
        <code style={styles.valueCode}>{row.value}</code>
        <span style={styles.variableText}>{row.cssVariable}</span>
      </div>
    </article>
  );
}

function TokenVisual({ row }: { readonly row: AssetTokenRow }): ReactNode {
  const sampleStyle = visualStyle(row);
  return (
    <div
      aria-label={`Visual sample for ${row.path}`}
      data-token-css-reference={row.cssReference}
      data-token-css-variable={row.cssVariable}
      data-token-visual-kind={row.visual.kind}
      data-token-visual-value={row.visual.value}
      style={sampleStyle}
    >
      {visualLabel(row)}
    </div>
  );
}

function groupRowsByLayer(
  rows: readonly AssetTokenRow[],
): ReadonlyMap<AssetTokenLayer, readonly TokenGroup[]> {
  const next = new Map<AssetTokenLayer, TokenGroup[]>();
  for (const layer of TOKEN_LAYERS) {
    next.set(layer, []);
  }

  for (const row of rows) {
    const layerGroups = next.get(row.layer);
    if (layerGroups === undefined) continue;
    const key = groupKey(row);
    const existing = layerGroups.find((group) => group.key === key);
    if (existing === undefined) {
      layerGroups.push({ key, label: titleCase(key), rows: [row] });
    } else {
      layerGroups[layerGroups.indexOf(existing)] = {
        ...existing,
        rows: [...existing.rows, row],
      };
    }
  }

  return next;
}

function groupKey(row: AssetTokenRow): string {
  return row.layer === "recipe" ? row.namespace : row.group;
}

function countRows(groups: readonly TokenGroup[]): number {
  return groups.reduce((total, group) => total + group.rows.length, 0);
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function visualStyle(row: AssetTokenRow): CSSProperties {
  const base = styles.visualSample;
  switch (row.visual.kind) {
    case "color":
      return { ...base, background: row.visual.value };
    case "length":
      return lengthSampleStyle(row);
    case "number":
      return { ...base, background: "linear-gradient(90deg, #2e5aa7 55%, #d9ecff 55%)" };
    case "opacity":
      return {
        ...base,
        background:
          "linear-gradient(45deg, #d4dbd7 25%, transparent 25%), linear-gradient(-45deg, #d4dbd7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4dbd7 75%), linear-gradient(-45deg, transparent 75%, #d4dbd7 75%)",
        backgroundColor: "#ffffff",
        backgroundPosition: "0 0, 0 0.5rem, 0.5rem -0.5rem, -0.5rem 0",
        backgroundSize: "1rem 1rem",
        opacity: row.visual.value,
      };
    case "typography":
      return typographySampleStyle(row);
    case "motion":
      return {
        ...base,
        background: "#ede3cf",
        borderColor: "#86aaa8",
        transitionDuration: row.kind === "duration" ? row.visual.value : "180ms",
        transitionTimingFunction: row.kind === "easing" ? row.visual.value : "ease",
      };
    case "shadow":
      return { ...base, background: "#ffffff", boxShadow: row.visual.value };
    case "effect":
      return { ...base, background: "#fbf5e8", filter: row.visual.value };
    case "text":
      return { ...base, background: "#f2f6f4" };
  }
}

function typographySampleStyle(row: AssetTokenRow): CSSProperties {
  const sample = { ...styles.visualSample, background: "#fbf5e8", color: "#17140f" };
  if (row.kind === "fontFamily") {
    return { ...sample, fontFamily: row.visual.value };
  }
  if (row.kind === "fontWeight") {
    return { ...sample, fontWeight: row.visual.value };
  }
  if (row.kind === "lineHeight") {
    return { ...sample, lineHeight: row.visual.value };
  }
  return sample;
}

function lengthSampleStyle(row: AssetTokenRow): CSSProperties {
  const sample = {
    ...styles.visualSample,
    ["--token-sample-length" as string]: row.visual.value,
    background: "#fbf5e8",
    borderColor: "#827763",
    color: "#14231f",
    textTransform: "none",
  };
  const variant = lengthSampleVariant(row);

  if (variant === "fontSize") {
    return {
      ...sample,
      alignItems: "baseline",
      fontSize: "clamp(0.75rem, var(--token-sample-length), 1.5rem)",
      lineHeight: 1,
    };
  }

  if (variant === "radius") {
    return {
      ...sample,
      background: "#ffffff",
      borderRadius: "clamp(0.125rem, var(--token-sample-length), 1rem)",
    };
  }

  if (variant === "padding") {
    return {
      ...sample,
      background: "#ffffff",
      boxShadow: "inset 0 0 0 clamp(0.125rem, var(--token-sample-length), 0.625rem) #dceae5",
    };
  }

  if (variant === "stroke") {
    return {
      ...sample,
      background: "#ffffff",
      borderColor: "#2e5aa7",
      borderWidth: "clamp(1px, var(--token-sample-length), 6px)",
    };
  }

  return {
    ...sample,
    background: "linear-gradient(90deg, #2e5aa7 0 65%, #d9ecff 65% 100%)",
    width: "clamp(1.75rem, var(--token-sample-length), 3.25rem)",
  };
}

function lengthSampleVariant(
  row: AssetTokenRow,
): "fontSize" | "padding" | "radius" | "stroke" | "space" {
  const path = row.path.toLowerCase();
  if (path.includes("fontsize")) {
    return "fontSize";
  }
  if (path.includes("padding")) {
    return "padding";
  }
  if (path.includes("radius")) {
    return "radius";
  }
  if (path.includes("borderwidth") || path.includes("ringwidth") || path.endsWith("width")) {
    return "stroke";
  }
  return "space";
}

function visualLabel(row: AssetTokenRow): string {
  switch (row.visual.kind) {
    case "typography":
      return "Ag";
    case "motion":
      return "move";
    case "length":
      return lengthVisualLabel(row);
    case "color":
      return "";
    case "number":
    case "opacity":
    case "shadow":
    case "effect":
    case "text":
      return row.visual.kind;
  }
}

function lengthVisualLabel(row: AssetTokenRow): string {
  const variant = lengthSampleVariant(row);
  if (variant === "fontSize") {
    return "Ag";
  }
  if (variant === "radius") {
    return "r";
  }
  if (variant === "padding") {
    return "pad";
  }
  if (variant === "stroke") {
    return "line";
  }
  return "gap";
}

const styles = {
  inspector: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
    gap: "1rem",
    alignItems: "start",
    width: "100%",
  },
  overview: {
    minWidth: 0,
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
  },
  overviewHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.5rem",
  },
  overviewTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "1rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  overviewStats: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "end",
    gap: "0.375rem",
  },
  overviewStat: {
    border: "1px solid #d9ccb2",
    borderRadius: "999px",
    color: "#625844",
    fontSize: "0.75rem",
    lineHeight: 1,
    padding: "0.25rem 0.5rem",
    whiteSpace: "nowrap",
  },
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
    gap: "0.625rem",
  },
  overviewPanel: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    padding: "0.625rem",
  },
  overviewPanelHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  overviewPanelTitle: {
    margin: 0,
    color: "#29251d",
    fontSize: "0.875rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  overviewPanelMeta: {
    color: "#827763",
    fontSize: "0.75rem",
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  systemMap: {
    display: "grid",
    gap: "0.375rem",
  },
  systemMapStep: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "1.5rem minmax(0, 1fr)",
    gap: "0.5rem",
    alignItems: "center",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    padding: "0.5rem",
  },
  systemMapIndex: {
    width: "1.5rem",
    height: "1.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    background: "#2e5aa7",
    color: "#ffffff",
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  systemMapLabel: {
    color: "#17140f",
    fontSize: "0.875rem",
    fontWeight: 700,
  },
  overviewMeaningGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  recipeOverviewList: {
    display: "grid",
    gap: "0.25rem",
  },
  overviewScreenSample: {
    minWidth: 0,
    display: "grid",
    gap: "0.5rem",
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    padding: "0.75rem",
  },
  overviewScreenTitle: {
    color: "#101828",
    fontSize: "1rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  overviewScreenMetric: {
    color: "#101828",
    fontSize: "1.5rem",
    fontWeight: 800,
    lineHeight: 1,
  },
  overviewScreenCard: {
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    color: "#625844",
    fontSize: "0.75rem",
    padding: "0.5rem",
  },
  paletteStack: {
    display: "grid",
    gap: "0.375rem",
  },
  paletteRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "4.25rem minmax(0, 1fr)",
    gap: "0.5rem",
    alignItems: "center",
  },
  paletteLabel: {
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
    overflowWrap: "anywhere",
  },
  paletteSwatches: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: "0.1875rem",
  },
  paletteSwatch: {
    minWidth: 0,
    aspectRatio: "1",
    border: "1px solid #d9ccb2",
    borderRadius: "0.1875rem",
  },
  surfaceSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  surfaceSample: {
    minWidth: 0,
    minHeight: "4.5rem",
    display: "grid",
    alignContent: "space-between",
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    padding: "0.5rem",
  },
  surfaceSampleTitle: {
    fontSize: "0.75rem",
    fontWeight: 700,
    lineHeight: 1.1,
  },
  surfaceSampleLine: {
    width: "70%",
    height: "0.375rem",
    borderRadius: "999px",
    background: "currentColor",
    opacity: 0.35,
  },
  typeSamples: {
    minWidth: 0,
    display: "grid",
    gap: "0.375rem",
  },
  typeSample: {
    minWidth: 0,
    color: "#17140f",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  scaleSamples: {
    display: "grid",
    gap: "0.375rem",
  },
  scaleSample: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "2rem minmax(0, 1fr)",
    gap: "0.5rem",
    alignItems: "center",
  },
  scaleLabel: {
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
  },
  scaleBar: {
    display: "block",
    height: "0.75rem",
    borderRadius: "999px",
    background: "#2e5aa7",
  },
  radiusSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  radiusSample: {
    minWidth: 0,
    height: "2.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #827763",
    color: "#625844",
    fontSize: "0.75rem",
    fontWeight: 650,
  },
  actionSamples: {
    display: "grid",
    gap: "0.375rem",
  },
  actionSample: {
    minWidth: 0,
    borderStyle: "solid",
    borderWidth: "1px",
    borderRadius: "0.375rem",
    fontSize: "0.8125rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.625rem 0.75rem",
    textAlign: "center",
  },
  showcaseSection: {
    minWidth: 0,
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
  },
  showcaseHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.5rem",
  },
  showcaseTitleBlock: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  showcaseTitle: {
    margin: 0,
    color: "#17140f",
    fontSize: "1rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  showcaseDescription: {
    margin: 0,
    color: "#625844",
    fontSize: "0.8125rem",
    lineHeight: 1.35,
  },
  showcaseGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
    gap: "0.625rem",
  },
  showcaseCard: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    padding: "0.625rem",
  },
  sizeSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.375rem",
    alignItems: "end",
  },
  sizeSample: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #827763",
    borderRadius: "0.375rem",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 700,
  },
  measureSamples: {
    display: "grid",
    gap: "0.25rem",
  },
  measureSample: {
    minWidth: 0,
    border: "1px dashed #827763",
    borderRadius: "0.25rem",
    color: "#625844",
    fontSize: "0.6875rem",
    padding: "0.25rem 0.375rem",
  },
  borderSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  borderSample: {
    minWidth: 0,
    minHeight: "2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#2e5aa7",
    borderRadius: "0.25rem",
    borderStyle: "solid",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 650,
  },
  shadowSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.5rem",
  },
  shadowSample: {
    minWidth: 0,
    minHeight: "3rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    background: "#ffffff",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 650,
  },
  opacitySamples: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  opacitySample: {
    minWidth: 0,
    minHeight: "2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.25rem",
    background: "#2e5aa7",
    color: "#ffffff",
    fontSize: "0.625rem",
    fontWeight: 700,
  },
  motionSamples: {
    display: "grid",
    gap: "0.25rem",
  },
  motionSample: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "1.5rem minmax(0, 1fr)",
    gap: "0.375rem",
    alignItems: "center",
    color: "#625844",
    fontSize: "0.6875rem",
  },
  motionDot: {
    width: "0.75rem",
    height: "0.75rem",
    borderRadius: "999px",
    background: "#2e5aa7",
  },
  effectSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  effectSample: {
    minWidth: 0,
    minHeight: "2.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    background: "#fbf5e8",
    color: "#17140f",
    fontSize: "0.625rem",
    fontWeight: 700,
  },
  breakpointSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: "0.25rem",
    alignItems: "end",
  },
  breakpointSample: {
    minWidth: 0,
    height: "1.75rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.25rem",
    background: "#ede3cf",
    color: "#625844",
    fontSize: "0.625rem",
    fontWeight: 700,
  },
  densitySamples: {
    display: "grid",
    gap: "0.25rem",
  },
  densitySample: {
    minWidth: 0,
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 650,
    paddingInline: "0.5rem",
  },
  semanticTextSamples: {
    display: "grid",
    gap: "0.375rem",
    fontSize: "0.875rem",
    fontWeight: 650,
  },
  statusSamples: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
  },
  statusSample: {
    borderStyle: "solid",
    borderWidth: "1px",
    borderRadius: "999px",
    fontSize: "0.75rem",
    fontWeight: 700,
    lineHeight: 1,
    padding: "0.375rem 0.5rem",
  },
  stateSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  stateSample: {
    minWidth: 0,
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 650,
    padding: "0.5rem",
  },
  focusSample: {
    minWidth: 0,
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 650,
    padding: "0.5rem",
  },
  systemSamples: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "0.375rem",
  },
  systemSample: {
    minWidth: 0,
    minHeight: "3rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #d9ccb2",
    borderRadius: "0.375rem",
    color: "#625844",
    fontSize: "0.6875rem",
    fontWeight: 700,
  },
  recipeChainList: {
    display: "grid",
    gap: "0.25rem",
  },
  recipeChain: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 0.8fr) auto minmax(0, 1fr)",
    gap: "0.375rem",
    alignItems: "center",
    border: "1px solid #ede3cf",
    borderRadius: "0.25rem",
    padding: "0.375rem",
  },
  recipeTokenName: {
    minWidth: 0,
    color: "#17140f",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.6875rem",
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  recipeArrow: {
    color: "#827763",
    fontSize: "0.6875rem",
  },
  recipeTokenValue: {
    minWidth: 0,
    color: "#254b8d",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.6875rem",
    overflowWrap: "anywhere",
  },
  rawDetails: {
    gridColumn: "1 / -1",
    minWidth: 0,
    borderTop: "1px solid #d9ccb2",
    paddingTop: "0.75rem",
  },
  rawSummary: {
    cursor: "pointer",
    color: "#17140f",
    fontSize: "1rem",
    fontWeight: 750,
    lineHeight: 1.2,
  },
  rawTokenGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
    gap: "1rem",
    alignItems: "start",
    marginTop: "0.875rem",
  },
  layerSection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
  },
  layerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.75rem",
    borderBottom: "1px solid #d9ccb2",
    paddingBottom: "0.5rem",
  },
  layerTitle: {
    margin: 0,
    fontSize: "1rem",
    fontWeight: 700,
  },
  layerCount: {
    color: "#625844",
    fontSize: "0.8125rem",
    whiteSpace: "nowrap",
  },
  groupStack: {
    display: "flex",
    flexDirection: "column",
    gap: "0.875rem",
  },
  groupSection: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  groupHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
  },
  groupTitle: {
    margin: 0,
    color: "#29251d",
    fontSize: "0.875rem",
    fontWeight: 650,
    overflowWrap: "anywhere",
  },
  groupCount: {
    border: "1px solid #d9ccb2",
    borderRadius: "999px",
    color: "#625844",
    fontSize: "0.75rem",
    lineHeight: 1,
    padding: "0.1875rem 0.4375rem",
  },
  tokenList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
  },
  tokenRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "3.75rem minmax(0, 1fr)",
    gap: "0.625rem",
    alignItems: "center",
    border: "1px solid #ede3cf",
    borderRadius: "0.375rem",
    padding: "0.5rem",
  },
  visualSample: {
    minWidth: 0,
    width: "3.25rem",
    height: "2.25rem",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #d9ccb2",
    borderRadius: "0.25rem",
    color: "#625844",
    fontSize: "0.625rem",
    fontWeight: 700,
    lineHeight: 1,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  tokenText: {
    minWidth: 0,
    display: "grid",
    gap: "0.25rem",
  },
  pathCode: {
    minWidth: 0,
    color: "#17140f",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.75rem",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  valueCode: {
    minWidth: 0,
    color: "#254b8d",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.75rem",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  variableText: {
    minWidth: 0,
    color: "#827763",
    fontSize: "0.6875rem",
    overflowWrap: "anywhere",
  },
} satisfies Record<string, CSSProperties>;
