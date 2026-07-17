import { describe, expect, it } from "vitest";
import type { FacetTree } from "@facet/core";
import { loadAssets, MemoryAssets, type AssetDocuments, type AssetsStore } from "@facet/runtime";
import type { Pool } from "pg";
import { PostgresAssets as BarrelPostgresAssets } from "./index.js";
import { PostgresAssets } from "./postgres-assets.js";

interface Call {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface StoredRow {
  theme: unknown | null;
  theme_present: boolean;
  patterns: unknown | null;
  patterns_present: boolean;
  initial_tree: unknown | null;
  initial_tree_present: boolean;
}

function fakePool(rows: readonly unknown[] = []): { pool: Pool; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    query: (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      return Promise.resolve({ rows });
    },
  } as unknown as Pool;
  return { pool, calls };
}

function rejectingPool(error: Error): Pool {
  return {
    query: () => Promise.reject(error),
  } as unknown as Pool;
}

function parseJsonParameter(value: unknown): unknown | null {
  return value === null ? null : (JSON.parse(String(value)) as unknown);
}

function roundTripPool(): Pool {
  const rows = new Map<string, StoredRow>();
  return {
    query: (text: string, values: readonly unknown[] = []) => {
      if (/insert into facet_assets/i.test(text)) {
        rows.set(String(values[0]), {
          theme: parseJsonParameter(values[1]),
          theme_present: values[1] !== null,
          patterns: parseJsonParameter(values[2]),
          patterns_present: values[2] !== null,
          initial_tree: parseJsonParameter(values[3]),
          initial_tree_present: values[3] !== null,
        });
        return Promise.resolve({ rows: [] });
      }
      if (/from facet_assets/i.test(text)) {
        const row = rows.get(String(values[0]));
        return Promise.resolve({ rows: row === undefined ? [] : [row] });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

const rawTheme = {
  name: "midnight",
  description: "operator-owned Theme",
  tokens: { intentionally: "raw at this boundary" },
};

const rawPattern = {
  name: "cta",
  description: "A call to action",
  useWhen: "The page needs one primary action.",
  root: "root",
  nodes: { root: { id: "root", type: "text", value: "Go" } },
};

const seedTree: FacetTree = {
  root: "root",
  nodes: { root: { id: "root", type: "text", value: "Welcome" } },
};

describe("PostgresAssets", () => {
  it("is exported through the package barrel and implements AssetsStore", () => {
    expect(BarrelPostgresAssets).toBe(PostgresAssets);
    const postgresAssets: AssetsStore = new PostgresAssets(fakePool().pool);
    const memoryAssets: AssetsStore = new MemoryAssets({});

    expect(postgresAssets).toBeInstanceOf(PostgresAssets);
    expect(memoryAssets).toBeInstanceOf(MemoryAssets);
  });

  it("persists singular Theme and exact Patterns only", async () => {
    const { pool, calls } = fakePool();
    const docs: AssetDocuments = {
      theme: rawTheme,
      patterns: [rawPattern],
      initialTree: seedTree,
    };

    await new PostgresAssets(pool).putAssets("agent", docs);

    const call = calls[0];
    expect(call?.values).toEqual([
      "agent",
      JSON.stringify(rawTheme),
      JSON.stringify([rawPattern]),
      JSON.stringify(seedTree),
    ]);
    const sql = normalizeSql(call?.text ?? "");
    expect(sql).toContain("insert into facet_assets (agent_id, theme, patterns, initial_tree");
    expect(sql).toContain("on conflict (agent_id)");
    expect(sql).toContain("theme = excluded.theme");
    expect(sql).toContain("patterns = excluded.patterns");
    expect(sql).toContain("initial_tree = excluded.initial_tree");
    expect(sql).toContain("updated_at = now()");
    for (const retired of [
      ["theme", "s"].join(""),
      ["composition", "s"].join(""),
      ["catalog"].join(""),
    ]) {
      expect(sql).not.toMatch(new RegExp(`\\b${retired}\\b`));
    }
  });

  it("keeps SQL NULL absence distinct from JSONB null and explicit none", async () => {
    await expect(new PostgresAssets(fakePool([]).pool).load("missing")).resolves.toEqual({});

    const absent = fakePool([
      {
        theme: null,
        theme_present: false,
        patterns: null,
        patterns_present: false,
        initial_tree: null,
        initial_tree_present: false,
      },
    ]);
    await expect(new PostgresAssets(absent.pool).load("agent")).resolves.toEqual({});

    const malformed = fakePool([
      {
        theme: null,
        theme_present: true,
        patterns: null,
        patterns_present: true,
        initial_tree: null,
        initial_tree_present: true,
      },
    ]);
    await expect(new PostgresAssets(malformed.pool).load("agent")).resolves.toEqual({
      theme: null,
      patterns: null,
      initialTree: null,
    });

    const explicitNone = fakePool([
      {
        theme: rawTheme,
        theme_present: true,
        patterns: [],
        patterns_present: true,
        initial_tree: seedTree,
        initial_tree_present: true,
      },
    ]);
    await expect(new PostgresAssets(explicitNone.pool).load("agent")).resolves.toEqual({
      theme: rawTheme,
      patterns: [],
      initialTree: seedTree,
    });

    const selectSql = normalizeSql(explicitNone.calls[0]?.text ?? "");
    expect(selectSql).toContain("theme is not null as theme_present");
    expect(selectSql).toContain("patterns is not null as patterns_present");
    expect(selectSql).toContain("initial_tree is not null as initial_tree_present");
  });

  it("round-trips omission, malformed presence, explicit none, and replacements", async () => {
    const store = new PostgresAssets(roundTripPool());

    await store.putAssets("absent", {});
    await expect(store.load("absent")).resolves.toEqual({});

    await store.putAssets("malformed", { theme: null, patterns: null, initialTree: null });
    await expect(store.load("malformed")).resolves.toEqual({
      theme: null,
      patterns: null,
      initialTree: null,
    });

    await store.putAssets("agent", { theme: rawTheme, patterns: [rawPattern] });
    await expect(store.load("agent")).resolves.toEqual({
      theme: rawTheme,
      patterns: [rawPattern],
    });

    await store.putAssets("agent", { patterns: [] });
    await expect(store.load("agent")).resolves.toEqual({ patterns: [] });
  });

  it("lets runtime distinguish default Patterns, explicit none, and malformed input", async () => {
    const defaults = await loadAssets(new PostgresAssets(fakePool([]).pool), "agent");
    expect(defaults.patterns.length).toBeGreaterThan(0);

    const none = await loadAssets(
      new PostgresAssets(
        fakePool([
          {
            theme: null,
            theme_present: false,
            patterns: [],
            patterns_present: true,
            initial_tree: null,
            initial_tree_present: false,
          },
        ]).pool,
      ),
      "agent",
    );
    expect(none.patterns).toEqual([]);

    const malformed = await loadAssets(
      new PostgresAssets(
        fakePool([
          {
            theme: null,
            theme_present: false,
            patterns: null,
            patterns_present: true,
            initial_tree: null,
            initial_tree_present: false,
          },
        ]).pool,
      ),
      "agent",
    );
    expect(malformed.patterns).toEqual([]);
    expect(malformed.issues.some((issue) => issue.includes("patterns"))).toBe(true);
  });

  it("lets runtime fall back when the Postgres read fails", async () => {
    const loaded = await loadAssets(
      new PostgresAssets(rejectingPool(new Error("db down"))),
      "agent",
    );

    expect(loaded.theme.name).toBe("default");
    expect(loaded.issues).toContain("assets load failed: db down");
  });
});
