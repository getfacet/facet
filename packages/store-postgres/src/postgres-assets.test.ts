import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { FacetTree } from "@facet/core";
import { loadAssets, MemoryAssets, type AssetDocuments, type AssetsStore } from "@facet/runtime";
import { FileAssets } from "@facet/runtime/node";
import { PostgresAssets as BarrelPostgresAssets } from "./index.js";
import { PostgresAssets } from "./postgres-assets.js";

interface Call {
  readonly text: string;
  readonly values: readonly unknown[];
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

function roundTripPool(): Pool {
  const rows = new Map<
    string,
    { themes: unknown; stamps: unknown; initial_tree: unknown | null }
  >();
  return {
    query: (text: string, values: readonly unknown[] = []) => {
      if (/insert into facet_assets/i.test(text)) {
        rows.set(String(values[0]), {
          themes: JSON.parse(String(values[1])) as unknown,
          stamps: JSON.parse(String(values[2])) as unknown,
          initial_tree: values[3] === null ? null : (JSON.parse(String(values[3])) as unknown),
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

const validTheme = {
  name: "midnight",
  description: "a dark theme",
  color: { bg: "#111111", fg: "#eeeeee" },
};

const validStamp = {
  name: "cta",
  description: "a call to action",
  root: "s-root",
  nodes: {
    "s-root": { id: "s-root", type: "box", children: ["s-label"] },
    "s-label": { id: "s-label", type: "text", value: "Go" },
  },
};

const invalidStamp = {
  name: "broken",
  root: "missing",
  nodes: { x: { id: "x", type: "text", value: "orphan" } },
};

const seedTree: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["h"] },
    h: { id: "h", type: "text", value: "Welcome" },
  },
};

describe("PostgresAssets", () => {
  it("is exported through the package barrel and implements AssetsStore", () => {
    expect(BarrelPostgresAssets).toBe(PostgresAssets);

    const { pool } = fakePool();
    const postgresAssets: AssetsStore = new PostgresAssets(pool);
    const memoryAssets: AssetsStore = new MemoryAssets({ themes: [], stamps: [] });
    const fileAssets: AssetsStore = new FileAssets("/tmp/facet-assets-unused");

    expect(postgresAssets).toBeInstanceOf(PostgresAssets);
    expect(memoryAssets).toBeInstanceOf(MemoryAssets);
    expect(fileAssets).toBeInstanceOf(FileAssets);
  });

  it("load returns raw persisted documents without validating them", async () => {
    const malformedTheme = { name: "hostile", color: { bg: "url(http://evil)" } };
    const { pool } = fakePool([
      { themes: [validTheme, malformedTheme], stamps: [validStamp], initial_tree: seedTree },
    ]);

    await expect(new PostgresAssets(pool).load("agent")).resolves.toEqual({
      themes: [validTheme, malformedTheme],
      stamps: [validStamp],
      initialTree: seedTree,
    });
  });

  it("load normalizes missing rows and null jsonb columns", async () => {
    const { pool: emptyPool } = fakePool([]);
    await expect(new PostgresAssets(emptyPool).load("missing")).resolves.toEqual({
      themes: [],
      stamps: [],
    });

    const { pool: nullPool } = fakePool([{ themes: null, stamps: null, initial_tree: null }]);
    await expect(new PostgresAssets(nullPool).load("agent")).resolves.toEqual({
      themes: [],
      stamps: [],
    });
  });

  it("loadAssets still resolves defaults for an agent with no Postgres asset row", async () => {
    const { pool } = fakePool([]);
    const loaded = await loadAssets(new PostgresAssets(pool), "agent");

    expect(loaded.themes.length).toBeGreaterThan(0);
    expect(loaded.stamps.length).toBeGreaterThan(0);
    expect(loaded.issues).toEqual([]);
  });

  it("putAssets upserts docs and a later load returns them", async () => {
    const store = new PostgresAssets(roundTripPool());
    const docs: AssetDocuments = {
      themes: [validTheme],
      stamps: [validStamp],
      initialTree: seedTree,
    };

    await store.putAssets("agent", docs);

    await expect(store.load("agent")).resolves.toEqual(docs);
  });

  it("loadAssets drops malformed raw docs from PostgresAssets without throwing", async () => {
    const { pool } = fakePool([
      { themes: [validTheme], stamps: [invalidStamp], initial_tree: null },
    ]);
    const loaded = await loadAssets(new PostgresAssets(pool), "agent");

    expect(loaded.themes.map((theme) => theme.name)).toContain("midnight");
    expect(loaded.stamps.map((stamp) => stamp.name)).not.toContain("broken");
    expect(loaded.stamps.length).toBeGreaterThan(0);
    expect(loaded.issues.some((issue) => issue.includes("stamp document skipped"))).toBe(true);
  });

  it("loadAssets swallows Postgres load failures and falls back to defaults", async () => {
    const loaded = await loadAssets(
      new PostgresAssets(rejectingPool(new Error("db down"))),
      "agent",
    );

    expect(loaded.themes.length).toBeGreaterThan(0);
    expect(loaded.issues).toContain("assets load failed: db down");
  });
});
