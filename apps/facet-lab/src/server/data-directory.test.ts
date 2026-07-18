import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveFacetLabDataDirectory } from "./data-directory.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("resolveFacetLabDataDirectory", () => {
  it("rejects an invalid bundle transactionally and freezes a run snapshot", async () => {
    const testRoot = await mkdtemp(join(tmpdir(), "facet-lab-data-directory-"));
    temporaryDirectories.push(testRoot);

    const repositoryRoot = join(testRoot, "checkout");
    const homeDirectory = join(testRoot, "home");
    await Promise.all([mkdir(repositoryRoot), mkdir(homeDirectory)]);

    const defaultDirectory = resolveFacetLabDataDirectory({
      environment: {},
      homeDirectory,
      platform: "darwin",
      repositoryRoot,
      workingDirectory: repositoryRoot,
    });

    expect(defaultDirectory).toEqual({
      path: join(homeDirectory, "Library", "Application Support", "Facet Lab"),
      source: "platform",
    });
    await expect(access(defaultDirectory.path)).rejects.toThrow();

    const externalDirectory = join(testRoot, "facet-lab-data");
    expect(
      resolveFacetLabDataDirectory({
        environment: { FACET_LAB_DATA_DIR: externalDirectory },
        homeDirectory,
        platform: "darwin",
        repositoryRoot,
        workingDirectory: repositoryRoot,
      }),
    ).toEqual({ path: externalDirectory, source: "environment" });

    const xdgDirectory = join(testRoot, "xdg-data");
    expect(
      resolveFacetLabDataDirectory({
        environment: { XDG_DATA_HOME: xdgDirectory },
        homeDirectory,
        platform: "linux",
        repositoryRoot,
        workingDirectory: repositoryRoot,
      }),
    ).toEqual({ path: join(xdgDirectory, "facet-lab"), source: "platform" });

    const localAppData = join(testRoot, "local-app-data");
    expect(
      resolveFacetLabDataDirectory({
        environment: { LOCALAPPDATA: localAppData },
        homeDirectory,
        platform: "win32",
        repositoryRoot,
        workingDirectory: repositoryRoot,
      }),
    ).toEqual({ path: join(localAppData, "Facet Lab"), source: "platform" });

    expect(() =>
      resolveFacetLabDataDirectory({
        environment: { FACET_LAB_DATA_DIR: "./apps/facet-lab/data" },
        homeDirectory,
        platform: "darwin",
        repositoryRoot,
        workingDirectory: repositoryRoot,
      }),
    ).toThrow(/repository checkout/i);

    const repositoryLink = join(testRoot, "checkout-link");
    await symlink(repositoryRoot, repositoryLink);
    expect(() =>
      resolveFacetLabDataDirectory({
        environment: { FACET_LAB_DATA_DIR: join(repositoryLink, "data") },
        homeDirectory,
        platform: "darwin",
        repositoryRoot,
        workingDirectory: testRoot,
      }),
    ).toThrow(/repository checkout/i);
  });
});
