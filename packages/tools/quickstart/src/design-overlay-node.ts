import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Message } from "esbuild";

import {
  QUICKSTART_DESIGN_OVERLAY_KEYS,
  resolveQuickstartDesignOverlay,
  type QuickstartResolvedDesign,
} from "./design-overlay.js";
import { buildQuickstartDesignPageBundle } from "./design-page-bundle.js";

export interface LoadQuickstartDesignOverlayOptions {
  readonly designPath: string;
  readonly resolveFromDirectory?: string;
  readonly temporaryParentDirectory?: string;
  readonly pageMountModulePath?: string;
  readonly minify?: boolean;
}

export interface LoadedQuickstartDesignOverlay {
  readonly overlayPath: string;
  readonly design: QuickstartResolvedDesign;
  readonly pageBundlePath: string;
  cleanup(): Promise<void>;
}

export class QuickstartDesignOverlayLoadError extends Error {
  readonly code = "quickstart_design_overlay_load_failed";

  constructor(detail: string) {
    super(detail);
    this.name = "QuickstartDesignOverlayLoadError";
  }
}

const NODE_OVERLAY_BASENAME = "overlay.mjs";
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, "../../..");

type OverlayModule = Readonly<Record<string, unknown>>;

function resolveInputPath(path: string, fromDirectory: string): string {
  return isAbsolute(path) ? path : resolve(fromDirectory, path);
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

async function resolveTemporaryParentDirectory(
  path: string | undefined,
  fromDirectory: string,
): Promise<string> {
  if (path !== undefined) return resolveInputPath(path, fromDirectory);
  try {
    return await realpath(tmpdir());
  } catch {
    return tmpdir();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return "unknown failure";
}

function designError(overlayPath: string, detail: string): QuickstartDesignOverlayLoadError {
  return new QuickstartDesignOverlayLoadError(
    `Invalid quickstart design module "${overlayPath}": ${detail}`,
  );
}

async function assertOverlayFile(overlayPath: string): Promise<void> {
  let info;
  try {
    info = await stat(overlayPath);
  } catch (error) {
    throw designError(overlayPath, `file not found or unreadable: ${failureDetail(error)}`);
  }
  if (!info.isFile()) {
    throw designError(overlayPath, "expected a local design module file.");
  }
}

function hasOwn(value: OverlayModule, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isEmptyPlainOverlay(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function overlayFromModule(
  module: OverlayModule,
):
  | { readonly ok: true; readonly overlay: unknown }
  | { readonly ok: false; readonly detail: string } {
  if (hasOwn(module, "default") && module["default"] !== undefined) {
    const overlay = module["default"];
    if (isEmptyPlainOverlay(overlay)) {
      return { ok: false, detail: "the default export must declare at least one design field." };
    }
    return { ok: true, overlay };
  }

  const overlay: Record<string, unknown> = {};
  for (const key of QUICKSTART_DESIGN_OVERLAY_KEYS) {
    if (hasOwn(module, key) && module[key] !== undefined) {
      overlay[key] = module[key];
    }
  }
  if (Object.keys(overlay).length === 0) {
    return {
      ok: false,
      detail: "export a non-empty default design module or named design fields.",
    };
  }
  return { ok: true, overlay: Object.freeze(overlay) };
}

function validationDetail(
  error: ReturnType<typeof resolveQuickstartDesignOverlay> extends infer Result
    ? Result extends { readonly ok: false; readonly error: infer ErrorType }
      ? ErrorType
      : never
    : never,
): string {
  const at = error.at.length === 0 ? "" : ` at ${error.at}`;
  return `${error.code}${at}: ${error.detail}`;
}

async function importOverlayModule(
  overlayPath: string,
  resolveFromDirectory: string,
  temporaryParentDirectory: string,
): Promise<OverlayModule> {
  await mkdir(temporaryParentDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    join(temporaryParentDirectory, "facet-quickstart-design-node-"),
  );
  const bundledPath = join(temporaryDirectory, NODE_OVERLAY_BASENAME);

  try {
    await build({
      absWorkingDir: resolveFromDirectory,
      bundle: true,
      define: { "process.env.NODE_ENV": '"production"' },
      entryPoints: [overlayPath],
      format: "esm",
      jsx: "automatic",
      logLevel: "silent",
      nodePaths: nodePaths(resolveFromDirectory),
      outfile: bundledPath,
      platform: "node",
      target: ["node20"],
    });
    const bundledSource = await readFile(bundledPath, "utf8");
    const imported = await import(
      `data:text/javascript;base64,${Buffer.from(bundledSource).toString("base64")}`
    );
    if (!isRecord(imported)) {
      throw new Error("overlay module did not evaluate to an export namespace.");
    }
    return imported;
  } catch (error) {
    throw designError(overlayPath, `could not import module: ${failureDetail(error)}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function loadQuickstartDesignOverlay(
  options: LoadQuickstartDesignOverlayOptions,
): Promise<LoadedQuickstartDesignOverlay> {
  const resolveFromDirectory = resolve(options.resolveFromDirectory ?? process.cwd());
  const overlayPath = resolveInputPath(options.designPath, resolveFromDirectory);
  const temporaryParentDirectory = await resolveTemporaryParentDirectory(
    options.temporaryParentDirectory,
    resolveFromDirectory,
  );

  await assertOverlayFile(overlayPath);
  const module = await importOverlayModule(
    overlayPath,
    resolveFromDirectory,
    temporaryParentDirectory,
  );
  const selected = overlayFromModule(module);
  if (!selected.ok) {
    throw designError(overlayPath, selected.detail);
  }

  const resolved = resolveQuickstartDesignOverlay(selected.overlay);
  if (!resolved.ok) {
    throw designError(overlayPath, validationDetail(resolved.error));
  }

  const pageBundle = await buildQuickstartDesignPageBundle({
    overlayModulePath: overlayPath,
    ...(options.pageMountModulePath === undefined
      ? {}
      : { pageMountModulePath: options.pageMountModulePath }),
    resolveFromDirectory,
    temporaryParentDirectory,
    resolvedDesign: resolved.design,
    ...(options.minify === undefined ? {} : { minify: options.minify }),
  });

  return Object.freeze({
    overlayPath,
    design: resolved.design,
    pageBundlePath: pageBundle.bundlePath,
    cleanup: () => pageBundle.cleanup(),
  });
}
