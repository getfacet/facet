import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetDocuments, AssetsStore } from "./assets.js";

/**
 * Durable, dependency-free reference `AssetsStore`: reads an operator's asset
 * documents from a directory — `*.theme.json`, `*.stamp.json`,
 * `*.component.json` (all sorted for determinism), an optional `catalog.json`,
 * and an optional `initial.tree.json`. Documents are served RAW;
 * `loadAssets` validates them. An unreadable directory, or an unreadable/
 * unparseable file, becomes an `issues` entry and boot proceeds — never a throw
 * past a file (the `FileStageStore` skip-and-log posture).
 *
 * Node-only (uses `node:fs`) — kept in its own module, behind
 * `@facet/runtime/node`, so browser bundles that import `MemoryAssets` don't pull
 * in `node:fs`.
 */
export class FileAssets implements AssetsStore {
  constructor(private readonly dir: string) {}

  async load(_agentId: string): Promise<AssetDocuments> {
    const issues: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(this.dir).sort();
    } catch (err) {
      issues.push(`assets directory unreadable (${this.dir}): ${String(err)}`);
      return { themes: [], stamps: [], issues };
    }

    const themes = this.parseEach(
      entries.filter((f) => f.endsWith(".theme.json")),
      issues,
    );
    const stamps = this.parseEach(
      entries.filter((f) => f.endsWith(".stamp.json")),
      issues,
    );
    const componentDefinitions = this.parseEach(
      entries.filter((f) => f.endsWith(".component.json")),
      issues,
    );

    const docs: {
      themes: readonly unknown[];
      stamps: readonly unknown[];
      componentDefinitions?: readonly unknown[];
      catalog?: unknown;
      initialTree?: unknown;
      issues: readonly string[];
    } = { themes, stamps, issues };
    if (componentDefinitions.length > 0) docs.componentDefinitions = componentDefinitions;

    if (entries.includes("catalog.json")) {
      const catalog = this.parseFile("catalog.json", issues);
      if (catalog !== undefined) docs.catalog = catalog;
    }

    // A missing initial.tree.json is the normal case (no seed) — not an issue.
    // A present-but-unparseable one IS.
    if (entries.includes("initial.tree.json")) {
      const tree = this.parseFile("initial.tree.json", issues);
      if (tree !== undefined) docs.initialTree = tree;
    }

    return docs;
  }

  private parseEach(files: readonly string[], issues: string[]): unknown[] {
    const parsed: unknown[] = [];
    for (const file of files) {
      const value = this.parseFile(file, issues);
      if (value !== undefined) parsed.push(value);
    }
    return parsed;
  }

  private parseFile(file: string, issues: string[]): unknown {
    const path = join(this.dir, file);
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch (err) {
      issues.push(`asset file skipped (${file}): ${String(err)}`);
      return undefined;
    }
  }
}
