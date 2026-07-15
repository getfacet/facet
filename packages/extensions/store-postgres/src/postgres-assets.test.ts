import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { FacetCatalog, FacetTree } from "@facet/core";
import { loadAssets, MemoryAssets, type AssetDocuments, type AssetsStore } from "@facet/runtime";
import { FileAssets } from "@facet/runtime/node";
import { PostgresAssets as BarrelPostgresAssets } from "./index.js";
import { PostgresAssets } from "./postgres-assets.js";

// Built at runtime so the legacy token never appears as a source literal
// (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");

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
    {
      themes: unknown;
      compositions: unknown;
      catalog: unknown | null;
      initial_tree: unknown | null;
    }
  >();
  return {
    query: (text: string, values: readonly unknown[] = []) => {
      if (/insert into facet_assets/i.test(text)) {
        rows.set(String(values[0]), {
          themes: JSON.parse(String(values[1])) as unknown,
          compositions: JSON.parse(String(values[2])) as unknown,
          catalog: values[3] === null ? null : (JSON.parse(String(values[3])) as unknown),
          initial_tree: values[4] === null ? null : (JSON.parse(String(values[4])) as unknown),
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

const validTheme = {
  name: "midnight",
  description: "a dark theme",
  color: { bg: "#111111", fg: "#eeeeee" },
};

const validComposition = {
  name: "cta",
  metadata: { description: "a call to action" },
  root: "s-root",
  nodes: {
    "s-root": { id: "s-root", type: "box", children: ["s-label"] },
    "s-label": { id: "s-label", type: "text", value: "Go" },
  },
};

const invalidComposition = {
  name: "broken",
  metadata: { description: "a broken reference dataset" },
  root: "missing",
  nodes: { x: { id: "x", type: "text", value: "orphan" } },
};

const legacySlotsField = ["sl", "ots"].join("");
const legacyReferenceField = ["u", "se"].join("");
const legacyTemplateComposition = {
  name: "legacy-template",
  description: "An obsolete template",
  [legacySlotsField]: { label: "Default" },
  root: "copy",
  nodes: { copy: { id: "copy", type: "text", value: "Default" } },
};
const legacyReferenceComposition = {
  name: "legacy-reference",
  metadata: { description: "An obsolete nested reference" },
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["ref"] },
    ref: { [legacyReferenceField]: "legacy-template" },
  },
};

const customCatalog: FacetCatalog = {
  name: "operator",
  theme: { active: "midnight", switchPolicy: "locked", allowed: ["midnight"] },
  bricks: [{ type: "box" }],
  compositions: { mode: "allow", names: ["cta"] },
  policy: {
    editBeforeAppend: true,
    compactScreens: true,
    maxScreenSections: 4,
  },
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
    const memoryAssets: AssetsStore = new MemoryAssets({ themes: [], compositions: [] });
    const fileAssets: AssetsStore = new FileAssets("/tmp/facet-assets-unused");

    expect(postgresAssets).toBeInstanceOf(PostgresAssets);
    expect(memoryAssets).toBeInstanceOf(MemoryAssets);
    expect(fileAssets).toBeInstanceOf(FileAssets);
  });

  it("load returns raw persisted composition documents without validating them", async () => {
    const malformedTheme = { name: "hostile", color: { bg: "url(http://evil)" } };
    const { pool } = fakePool([
      {
        themes: [validTheme, malformedTheme],
        compositions: [validComposition],
        initial_tree: seedTree,
      },
    ]);

    await expect(new PostgresAssets(pool).load("agent")).resolves.toEqual({
      themes: [validTheme, malformedTheme],
      compositions: [validComposition],
      initialTree: seedTree,
    });
  });

  it("load returns raw persisted catalog documents without validating them", async () => {
    const malformedCatalog = {
      name: "bad name",
      theme: { switchPolicy: "sometimes" },
      bricks: [{ type: "script" }],
    };
    const { pool } = fakePool([
      {
        themes: [validTheme],
        compositions: [validComposition],
        catalog: malformedCatalog,
        initial_tree: seedTree,
      },
    ]);

    await expect(new PostgresAssets(pool).load("agent")).resolves.toEqual({
      themes: [validTheme],
      compositions: [validComposition],
      catalog: malformedCatalog,
      initialTree: seedTree,
    });
  });

  it("load normalizes missing rows and null jsonb columns to canonical composition defaults", async () => {
    const { pool: emptyPool } = fakePool([]);
    await expect(new PostgresAssets(emptyPool).load("missing")).resolves.toEqual({
      themes: [],
      compositions: [],
    });

    const { pool: nullPool } = fakePool([{ themes: null, compositions: null, initial_tree: null }]);
    await expect(new PostgresAssets(nullPool).load("agent")).resolves.toEqual({
      themes: [],
      compositions: [],
    });
  });

  it("load reports non-array theme and composition jsonb columns to runtime validation", async () => {
    const { pool } = fakePool([
      { themes: { not: "an array" }, compositions: "not an array", initial_tree: null },
    ]);

    const docs = await new PostgresAssets(pool).load("agent");

    expect(docs.themes).toEqual([]);
    expect(docs.compositions).toEqual([]);
    expect(docs.issues).toEqual([
      "postgres assets `themes` was not an array — ignored",
      "postgres assets `compositions` was not an array — ignored",
    ]);

    const loaded = await loadAssets(new PostgresAssets(pool), "agent");
    expect(loaded.issues.some((issue) => issue.includes("postgres assets `themes`"))).toBe(true);
    expect(loaded.issues.some((issue) => issue.includes("postgres assets `compositions`"))).toBe(
      true,
    );
  });

  it("loadAssets defaults nullable Postgres catalog rows through runtime validation", async () => {
    const { pool } = fakePool([
      { themes: [validTheme], compositions: [validComposition], catalog: null, initial_tree: null },
    ]);
    const loaded = await loadAssets(new PostgresAssets(pool), "agent");

    expect(loaded.catalog.name).toBe("default");
    expect(loaded.catalog.theme.switchPolicy).toBe("locked");
    expect(loaded.issues.some((issue) => issue.includes("catalog"))).toBe(false);
  });

  it("putAssets upserts catalog docs and a later load returns them", async () => {
    const store = new PostgresAssets(roundTripPool());
    const docs: AssetDocuments = {
      themes: [validTheme],
      compositions: [validComposition],
      catalog: customCatalog,
      initialTree: seedTree,
    };
    const replacement: AssetDocuments = {
      themes: [],
      compositions: [],
    };

    await store.putAssets("agent", docs);
    await expect(store.load("agent")).resolves.toEqual(docs);

    await store.putAssets("agent", replacement);
    await expect(store.load("agent")).resolves.toEqual(replacement);
  });

  it("loadAssets still resolves defaults for an agent with no Postgres asset row", async () => {
    const { pool } = fakePool([]);
    const loaded = await loadAssets(new PostgresAssets(pool), "agent");

    expect(loaded.themes.length).toBeGreaterThan(0);
    expect(loaded.compositions.length).toBeGreaterThan(0);
    expect(loaded.issues).toEqual([]);
  });

  it("putAssets round-trips composition docs and a later load returns the replacement", async () => {
    const store = new PostgresAssets(roundTripPool());
    const docs: AssetDocuments = {
      themes: [validTheme],
      compositions: [validComposition],
      initialTree: seedTree,
    };
    const replacement: AssetDocuments = {
      themes: [{ ...validTheme, name: "dawn", color: { bg: "#ffffff", fg: "#111111" } }],
      compositions: [],
    };

    await store.putAssets("agent", docs);
    await store.putAssets("agent", replacement);

    await expect(store.load("agent")).resolves.toEqual(replacement);
  });

  it("round-trips concrete and legacy shapes raw while loadAssets keeps only the native document", async () => {
    const store = new PostgresAssets(roundTripPool());
    const docs: AssetDocuments = {
      themes: [validTheme],
      compositions: [validComposition, legacyTemplateComposition, legacyReferenceComposition],
      catalog: customCatalog,
      initialTree: seedTree,
    };

    await store.putAssets("agent", docs);
    await expect(store.load("agent")).resolves.toEqual(docs);

    const loaded = await loadAssets(store, "agent");
    const names = loaded.compositions.map((composition) => composition.name);
    expect(names).toContain("cta");
    expect(names).not.toContain("legacy-template");
    expect(names).not.toContain("legacy-reference");
    expect(loaded.compositions.find((composition) => composition.name === "cta")).toMatchObject(
      validComposition,
    );
    expect(loaded.catalog).toEqual(customCatalog);
    expect(loaded.issues.some((issue) => issue.includes("composition document skipped"))).toBe(
      true,
    );
  });

  it("keeps composition assets isolated by agent id", async () => {
    const store = new PostgresAssets(roundTripPool());
    const agentA: AssetDocuments = { themes: [validTheme], compositions: [] };
    const agentB: AssetDocuments = {
      themes: [],
      compositions: [validComposition],
      initialTree: seedTree,
    };

    await store.putAssets("agent-a", agentA);
    await store.putAssets("agent-b", agentB);

    await expect(store.load("agent-a")).resolves.toEqual(agentA);
    await expect(store.load("agent-b")).resolves.toEqual(agentB);
    await expect(store.load("agent-c")).resolves.toEqual({ themes: [], compositions: [] });
  });

  it("putAssets emits an agent_id upsert that replaces compositions and never mentions the legacy field", async () => {
    const { pool, calls } = fakePool();
    await new PostgresAssets(pool).putAssets("agent", {
      themes: [],
      compositions: [],
      catalog: customCatalog,
    });

    const call = calls[0];
    expect(call?.values).toEqual(["agent", "[]", "[]", JSON.stringify(customCatalog), null]);
    const sql = normalizeSql(call?.text ?? "");
    expect(sql).toContain("catalog");
    expect(sql).toContain("on conflict (agent_id)");
    expect(sql).toContain("do update set");
    expect(sql).toContain("themes = excluded.themes");
    expect(sql).toContain("compositions = excluded.compositions");
    expect(sql).toContain("catalog = excluded.catalog");
    expect(sql).toContain("initial_tree = excluded.initial_tree");
    expect(sql).toContain("updated_at = now()");
    expect(sql).not.toContain(legacy);
  });

  it("load queries only composition columns and returns no legacy field", async () => {
    const { pool, calls } = fakePool([
      { themes: [validTheme], compositions: [validComposition], initial_tree: null },
    ]);
    const docs = await new PostgresAssets(pool).load("agent");

    const sql = normalizeSql(calls[0]?.text ?? "");
    expect(sql).toContain("compositions");
    expect(sql).not.toContain(legacy);
    expect(`${legacy}s` in docs).toBe(false);
    expect(docs.compositions).toEqual([validComposition]);
  });

  it("loadAssets drops malformed raw composition docs from PostgresAssets without throwing", async () => {
    const { pool } = fakePool([
      { themes: [validTheme], compositions: [invalidComposition], initial_tree: null },
    ]);
    const loaded = await loadAssets(new PostgresAssets(pool), "agent");

    expect(loaded.themes.map((theme) => theme.name)).toContain("midnight");
    expect(loaded.compositions.map((composition) => composition.name)).not.toContain("broken");
    expect(loaded.compositions.length).toBeGreaterThan(0);
    expect(loaded.issues.some((issue) => issue.includes("composition document skipped"))).toBe(
      true,
    );
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
