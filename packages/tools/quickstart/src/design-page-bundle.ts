import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Message } from "esbuild";

import type {
  QuickstartDesignExample,
  QuickstartDesignOverlay,
  QuickstartResolvedDesign,
} from "./design-overlay.js";
import { QUICKSTART_DESIGN_OVERLAY_KEYS } from "./design-overlay.js";

export interface QuickstartDesignPageMountOptions {
  readonly overlay: QuickstartDesignOverlay;
}

export type QuickstartDesignPageMount = (options: QuickstartDesignPageMountOptions) => void;

export interface BuildQuickstartDesignPageBundleOptions {
  readonly overlayModulePath: string;
  readonly pageMountModulePath?: string;
  readonly resolveFromDirectory?: string;
  readonly temporaryParentDirectory?: string;
  readonly resolvedDesign: QuickstartResolvedDesign;
  readonly minify?: boolean;
}

export interface QuickstartDesignPageBundle {
  readonly bundlePath: string;
  readonly generatedEntryPath: string;
  readonly temporaryDirectory: string;
  cleanup(): Promise<void>;
}

export class QuickstartDesignPageBundleError extends Error {
  readonly code = "quickstart_design_page_bundle_failed";

  constructor(detail: string) {
    super(`Failed to build quickstart design page bundle: ${detail}`);
    this.name = "QuickstartDesignPageBundleError";
  }
}

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, "../../..");
const GENERATED_ENTRY_BASENAME = "design-entry.tsx";
const BUNDLE_BASENAME = "app.js";
function resolveInputPath(path: string, fromDirectory: string): string {
  return isAbsolute(path) ? path : resolve(fromDirectory, path);
}

function defaultPageMountModulePath(): string {
  const candidates = [
    fileURLToPath(new URL("./page/main.tsx", import.meta.url)),
    fileURLToPath(new URL("./page/main.js", import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? "";
}

function importSpecifier(fromDirectory: string, targetPath: string): string {
  if (isAbsolute(targetPath)) {
    return targetPath.replaceAll(sep, "/");
  }
  const relativePath = relative(fromDirectory, targetPath).replaceAll(sep, "/");
  if (relativePath === "") return "./";
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function escapedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function examplesFromResolvedDesign(
  examples: QuickstartResolvedDesign["examples"],
): readonly QuickstartDesignExample[] {
  return examples.map((example) =>
    Object.freeze({
      id: example.id,
      kind: example.kind,
      label: example.label,
      markup: example.markup,
      ...(example.description === undefined ? {} : { description: example.description }),
      tags: example.tags,
      data: example.data,
    }),
  );
}

function resolvedOverlayDataSource(design: QuickstartResolvedDesign): string {
  const customTags = new Set(design.customRegistryTags);
  const customComponents = design.catalog.components.filter((component) =>
    customTags.has(component.tag),
  );
  return escapedJson({
    theme: design.theme,
    themeExtensions: design.themeExtensions,
    components: customComponents,
    examples: examplesFromResolvedDesign(design.examples),
    notes: design.notes,
  });
}

function generatedEntrySource(
  entryDirectory: string,
  overlayModulePath: string,
  pageMountModulePath: string,
  resolvedDesign: QuickstartResolvedDesign,
): string {
  const overlayImport = JSON.stringify(importSpecifier(entryDirectory, overlayModulePath));
  const pageMountImport = JSON.stringify(importSpecifier(entryDirectory, pageMountModulePath));
  const namedOverlayProperties = QUICKSTART_DESIGN_OVERLAY_KEYS.map(
    (key) => `  ${key}: overlayModule.${key},`,
  ).join("\n");
  const overlaySource = `{
  ...${resolvedOverlayDataSource(resolvedDesign)},
  registry: (overlayModule.default ?? {
${namedOverlayProperties}
  }).registry,
}`;

  return `import * as overlayModule from ${overlayImport};

const overlay = ${overlaySource};

const globalScope = globalThis as { __FACET_QUICKSTART_DISABLE_AUTOMOUNT__?: boolean };
globalScope.__FACET_QUICKSTART_DISABLE_AUTOMOUNT__ = true;

void import(${pageMountImport}).then(
  (pageModule: { readonly mountQuickstartDesignPage?: unknown }) => {
    const mountQuickstartDesignPage = pageModule.mountQuickstartDesignPage;
    if (typeof mountQuickstartDesignPage !== "function") {
      throw new Error("Facet quickstart page mount module does not export mountQuickstartDesignPage.");
    }
    mountQuickstartDesignPage({ overlay });
  },
);
`;
}

function nodePaths(resolveFromDirectory: string): string[] {
  const candidates = [
    join(resolveFromDirectory, "node_modules"),
    join(PACKAGE_ROOT, "node_modules"),
    join(REPO_ROOT, "node_modules"),
  ];
  const paths: string[] = [];
  for (const candidate of candidates) {
    if (existsSync(candidate) && !paths.includes(candidate)) {
      paths.push(candidate);
    }
  }
  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstBuildMessage(error: unknown): Message | undefined {
  if (!isRecord(error) || !Array.isArray(error["errors"])) return undefined;
  const first = error["errors"][0];
  if (!isRecord(first) || typeof first["text"] !== "string") return undefined;
  return first as unknown as Message;
}

function failureDetail(error: unknown): string {
  const first = firstBuildMessage(error);
  if (first !== undefined) {
    const location = first.location;
    if (location !== null && location !== undefined) {
      return `${first.text} (${location.file}:${String(location.line)}:${String(location.column)})`;
    }
    return first.text;
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "unknown esbuild failure";
}

export async function buildQuickstartDesignPageBundle(
  options: BuildQuickstartDesignPageBundleOptions,
): Promise<QuickstartDesignPageBundle> {
  const resolveFromDirectory = resolve(options.resolveFromDirectory ?? process.cwd());
  const temporaryParentDirectory = resolveInputPath(
    options.temporaryParentDirectory ?? tmpdir(),
    resolveFromDirectory,
  );
  await mkdir(temporaryParentDirectory, { recursive: true });

  const temporaryDirectory = await mkdtemp(
    join(temporaryParentDirectory, "facet-quickstart-design-bundle-"),
  );
  const generatedEntryPath = join(temporaryDirectory, GENERATED_ENTRY_BASENAME);
  const bundlePath = join(temporaryDirectory, BUNDLE_BASENAME);
  const overlayModulePath = resolveInputPath(options.overlayModulePath, resolveFromDirectory);
  const pageMountModulePath = resolveInputPath(
    options.pageMountModulePath ?? defaultPageMountModulePath(),
    PACKAGE_ROOT,
  );

  try {
    await writeFile(
      generatedEntryPath,
      generatedEntrySource(
        dirname(generatedEntryPath),
        overlayModulePath,
        pageMountModulePath,
        options.resolvedDesign,
      ),
    );
    await build({
      absWorkingDir: dirname(generatedEntryPath),
      bundle: true,
      define: { "process.env.NODE_ENV": '"production"' },
      entryPoints: [generatedEntryPath],
      format: "iife",
      jsx: "automatic",
      logLevel: "silent",
      minify: options.minify ?? true,
      nodePaths: nodePaths(resolveFromDirectory),
      outfile: bundlePath,
      platform: "browser",
      target: ["es2022"],
    });
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new QuickstartDesignPageBundleError(failureDetail(error));
  }

  let cleaned = false;
  return Object.freeze({
    bundlePath,
    generatedEntryPath,
    temporaryDirectory,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(temporaryDirectory, { recursive: true, force: true });
    },
  });
}
