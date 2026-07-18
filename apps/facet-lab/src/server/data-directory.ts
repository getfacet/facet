import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FACET_LAB_DATA_DIRECTORY_ENV = "FACET_LAB_DATA_DIR";

export interface FacetLabDataDirectory {
  readonly path: string;
  readonly source: "environment" | "platform";
}

export interface ResolveFacetLabDataDirectoryOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly repositoryRoot?: string;
  readonly workingDirectory?: string;
}

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function defaultDataDirectory(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Facet Lab");
  }

  if (platform === "win32") {
    const windowsBase = environment.LOCALAPPDATA?.trim() || environment.APPDATA?.trim();
    return windowsBase === undefined || windowsBase.length === 0
      ? join(homeDirectory, "AppData", "Local", "Facet Lab")
      : join(windowsBase, "Facet Lab");
  }

  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  return xdgDataHome === undefined || xdgDataHome.length === 0
    ? join(homeDirectory, ".local", "share", "facet-lab")
    : join(xdgDataHome, "facet-lab");
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

/**
 * Resolves symlinked existing ancestors without requiring the final directory
 * to exist. This keeps a symlink outside the checkout from pointing writes
 * back into repository source.
 */
function canonicalizePotentialPath(inputPath: string): string {
  let cursor = resolve(inputPath);
  const missingSegments: string[] = [];

  for (;;) {
    try {
      return join(realpathSync.native(cursor), ...missingSegments);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(inputPath);
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent.length === 0 ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

/** Resolves, but never creates, Facet Lab's external application-data directory. */
export function resolveFacetLabDataDirectory(
  options: ResolveFacetLabDataDirectoryOptions = {},
): FacetLabDataDirectory {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const repositoryRoot = canonicalizePotentialPath(
    options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
  );
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const configuredDirectory = environment[FACET_LAB_DATA_DIRECTORY_ENV]?.trim();
  const hasConfiguredDirectory =
    configuredDirectory !== undefined && configuredDirectory.length > 0;
  const source = hasConfiguredDirectory ? "environment" : "platform";
  const unresolvedDirectory = hasConfiguredDirectory
    ? resolve(workingDirectory, configuredDirectory)
    : defaultDataDirectory(platform, environment, homeDirectory);
  const dataDirectory = resolve(unresolvedDirectory);
  const canonicalDataDirectory = canonicalizePotentialPath(dataDirectory);

  if (isInsideOrEqual(repositoryRoot, canonicalDataDirectory)) {
    throw new Error(
      "Facet Lab data directory must be outside the repository checkout; refusing to write source state",
    );
  }

  return Object.freeze({ path: dataDirectory, source });
}
