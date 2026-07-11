import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPOSITIONS, DEFAULT_THEME } from "@facet/assets";
import { loadAssets } from "./assets.js";
import { FileAssets } from "./file-assets.js";

// Legacy vocabulary is built at runtime so the removed tokens never appear as
// source literals (same idiom as theme.test.ts).
const legacy = ["st", "amp"].join("");
const legacyTitle = ["St", "amp"].join("");

/**
 * Instrumented `node:fs` seam (DC-007): every export delegates to the real
 * implementation by default, but records directory reads/closes and file opens,
 * and lets a test swap in a fake directory stream, a hostile throw value, or a
 * fake bounded-read source — so the suite can PROVE "zero opens" and "decode/
 * parse never called", not merely observe outcomes.
 */
const FAKE_FD = 0x7fffffff;

const fsSpy = vi.hoisted(() => ({
  openedPaths: [] as string[],
  dirReads: 0,
  dirCloses: 0,
  fakeEntries: undefined as readonly string[] | undefined,
  opendirError: undefined as unknown,
  openError: undefined as unknown,
  fakeRead: undefined as
    ((buffer: Uint8Array, offset: number, length: number) => number) | undefined,
  reset(): void {
    fsSpy.openedPaths = [];
    fsSpy.dirReads = 0;
    fsSpy.dirCloses = 0;
    fsSpy.fakeEntries = undefined;
    fsSpy.opendirError = undefined;
    fsSpy.openError = undefined;
    fsSpy.fakeRead = undefined;
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  const opendirSync = (path: Parameters<typeof actual.opendirSync>[0]): unknown => {
    if (fsSpy.opendirError !== undefined) throw fsSpy.opendirError;
    if (fsSpy.fakeEntries !== undefined) {
      const entries = fsSpy.fakeEntries;
      let at = 0;
      return {
        readSync: (): { name: string } | null => {
          fsSpy.dirReads += 1;
          const name = entries[at];
          at += 1;
          return name === undefined ? null : { name };
        },
        closeSync: (): void => {
          fsSpy.dirCloses += 1;
        },
      };
    }
    const dir = actual.opendirSync(path);
    return {
      readSync: (): unknown => {
        fsSpy.dirReads += 1;
        return dir.readSync();
      },
      closeSync: (): void => {
        fsSpy.dirCloses += 1;
        dir.closeSync();
      },
    };
  };

  const openSync = (
    path: Parameters<typeof actual.openSync>[0],
    flags: Parameters<typeof actual.openSync>[1],
  ): number => {
    fsSpy.openedPaths.push(String(path));
    if (fsSpy.openError !== undefined) throw fsSpy.openError;
    if (fsSpy.fakeRead !== undefined) return FAKE_FD;
    return actual.openSync(path, flags);
  };

  const readSync = (
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position: number | bigint | null,
  ): number => {
    if (fsSpy.fakeRead !== undefined && fd === FAKE_FD) {
      return fsSpy.fakeRead(buffer as Uint8Array, offset, length);
    }
    return actual.readSync(fd, buffer, offset, length, position);
  };

  const closeSync = (fd: number): void => {
    if (fd === FAKE_FD) return;
    actual.closeSync(fd);
  };

  return { ...actual, opendirSync, openSync, readSync, closeSync };
});

// --- Fixtures -------------------------------------------------------------------

const MAX_FILE_BYTES = 1_048_576;

function compositionDoc(name: string, value = "Go"): Record<string, unknown> {
  return {
    name,
    root: "r",
    nodes: {
      r: { id: "r", type: "box", children: ["t"] },
      t: { id: "t", type: "text", value },
    },
  };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  fsSpy.reset();
  vi.restoreAllMocks();
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "facet-file-assets-"));
  tempDirs.push(dir);
  return dir;
}

/** A padded-but-valid JSON theme document of exactly `bytes` bytes. */
function paddedThemeJson(name: string, bytes: number): string {
  const head = JSON.stringify({ name });
  return head + " ".repeat(bytes - head.length);
}

// --- Canonical suffix + bounded discovery ----------------------------------------

describe("FileAssets", () => {
  it("loads only bounded composition files", async () => {
    // Structural pin FIRST so this fails as an assertion while the loader still
    // materializes the whole directory: discovery must be the bounded
    // opendirSync/readSync walk, never a full readdirSync snapshot.
    const source = readFileSync(new URL("./file-assets.ts", import.meta.url), "utf8");
    expect(source.includes("opendirSync")).toBe(true);
    expect(source.includes("readdirSync")).toBe(false);

    const dir = makeTempDir();
    writeFileSync(join(dir, "a.composition.json"), JSON.stringify(compositionDoc("cta")));
    writeFileSync(
      join(dir, `b.${legacy}.json`),
      JSON.stringify(compositionDoc(`old${legacyTitle}`)),
    );
    writeFileSync(
      join(dir, ["c.comp", "onent.json"].join("")),
      JSON.stringify(compositionDoc("oldComponent")),
    );
    writeFileSync(join(dir, "d.theme.json"), JSON.stringify({ name: "midnight" }));

    const docs = await new FileAssets(dir).load("a");
    // Exactly one raw collection per canonical suffix; old suffixes never execute.
    expect(docs.compositions).toHaveLength(1);
    expect(docs.themes).toHaveLength(1);

    const loaded = await loadAssets(new FileAssets(dir), "a");
    const names = loaded.compositions.map((c) => c.name);
    expect(names).toContain("cta");
    expect(names).not.toContain(`old${legacyTitle}`);
    expect(names).not.toContain("oldComponent");
    expect(loaded.themes.map((t) => t.name)).toContain("midnight");
  });

  it("processes composition files in sorted filename order (first file wins a name)", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "z.composition.json"), JSON.stringify(compositionDoc("dup", "z-last")));
    writeFileSync(
      join(dir, "a.composition.json"),
      JSON.stringify(compositionDoc("dup", "a-first")),
    );

    const loaded = await loadAssets(new FileAssets(dir), "a");
    const dup = loaded.compositions.find((c) => c.name === "dup");
    const copy = dup?.nodes["t"] as { value?: string } | undefined;
    expect(copy?.value).toBe("a-first");
    expect(
      loaded.issues.some((i) => i.includes("duplicate composition name") && i.includes("dup")),
    ).toBe(true);
  });

  it("records an issue for an unparseable file, never throws, and boots", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "broken.theme.json"), "{ not json");
    writeFileSync(join(dir, "ok.theme.json"), JSON.stringify({ name: "midnight" }));
    const loaded = await loadAssets(new FileAssets(dir), "a");
    expect(loaded.themes.map((t) => t.name)).toContain("midnight");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });

  it("records an issue for an unreadable directory instead of throwing", async () => {
    const loaded = await loadAssets(new FileAssets(join(tmpdir(), "facet-nope-missing")), "a");
    // The backend failed, but the seeded default base layer still resolves.
    expect(loaded.themes.map((t) => t.name)).toEqual([DEFAULT_THEME.name]);
    for (const c of DEFAULT_COMPOSITIONS) {
      expect(loaded.compositions.map((x) => x.name)).toContain(c.name);
    }
    expect(loaded.issues.length).toBeGreaterThan(0);
  });

  // --- 4096/4097 directory enumeration bound -------------------------------------

  it("enumerates exactly 4096 entries plus one overflow probe and succeeds at the cap", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "keep.composition.json"), JSON.stringify(compositionDoc("kept")));
    const junk = Array.from({ length: 4095 }, (_, i) => `junk-${String(i).padStart(4, "0")}`);
    fsSpy.fakeEntries = [...junk, "keep.composition.json"];

    const docs = await new FileAssets(dir).load("a");

    // 4096 entry reads + 1 probe that returns null — never a 4098th read.
    expect(fsSpy.dirReads).toBe(4097);
    expect(fsSpy.dirCloses).toBe(1);
    expect(docs.compositions).toHaveLength(1);
    expect(docs.issues ?? []).toEqual([]);
  });

  it("stops at the 4097th entry, opens/decodes/parses nothing, and boot falls back to defaults", async () => {
    const dir = makeTempDir();
    // Real matching asset files exist — proving they are never opened on overflow.
    writeFileSync(join(dir, "aa.theme.json"), JSON.stringify({ name: "midnight" }));
    writeFileSync(join(dir, "bb.composition.json"), JSON.stringify(compositionDoc("cta")));
    fsSpy.fakeEntries = [
      "aa.theme.json",
      "bb.composition.json",
      ...Array.from({ length: 4095 }, (_, i) => `junk-${String(i).padStart(4, "0")}`),
    ];
    expect(fsSpy.fakeEntries).toHaveLength(4097);

    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");
    const store = new FileAssets(dir);
    const docs = await store.load("a");

    // The 4097th read detects overflow, then enumeration stops and the dir closes.
    expect(fsSpy.dirReads).toBe(4097);
    expect(fsSpy.dirCloses).toBe(1);
    // The whole raw directory fails closed BEFORE any asset open/decode/parse.
    expect(fsSpy.openedPaths).toEqual([]);
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(docs.themes).toEqual([]);
    expect(docs.compositions).toEqual([]);
    expect(docs.issues?.some((i) => i.includes("4096"))).toBe(true);

    // Boot continues safely: loadAssets over the overflowing store still seeds
    // the bundled defaults.
    const loaded = await loadAssets(store, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    for (const c of DEFAULT_COMPOSITIONS) {
      expect(loaded.compositions.map((x) => x.name)).toContain(c.name);
    }
    expect(loaded.issues.some((i) => i.includes("4096"))).toBe(true);
  });

  // --- 1024/1025 files per collection ----------------------------------------------

  it("opens at most 1024 sorted files per collection; the 1025th is never opened", async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 1025; i += 1) {
      const n = String(i).padStart(4, "0");
      writeFileSync(join(dir, `t${n}.theme.json`), JSON.stringify({ name: `theme_${n}` }));
      writeFileSync(
        join(dir, `c${n}.composition.json`),
        JSON.stringify(compositionDoc(`composition_${n}`)),
      );
    }
    fsSpy.openedPaths = [];

    const docs = await new FileAssets(dir).load("a");

    expect(docs.themes).toHaveLength(1024);
    expect(docs.compositions).toHaveLength(1024);
    // The lexicographically-last file of each collection is beyond the cap and
    // must never be opened.
    expect(fsSpy.openedPaths).not.toContain(join(dir, "t1024.theme.json"));
    expect(fsSpy.openedPaths).not.toContain(join(dir, "c1024.composition.json"));
    expect(fsSpy.openedPaths).toContain(join(dir, "t1023.theme.json"));
    expect(fsSpy.openedPaths).toContain(join(dir, "c1023.composition.json"));
    expect(fsSpy.openedPaths).toHaveLength(2048);
    expect(docs.issues?.filter((i) => i.includes("1024"))).toHaveLength(2);
  });

  // --- 1048576/1048577 per-file byte bound -----------------------------------------

  it("accepts a file of exactly 1048576 bytes", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "max.theme.json"), paddedThemeJson("maxok", MAX_FILE_BYTES));

    const docs = await new FileAssets(dir).load("a");
    expect(docs.themes).toEqual([{ name: "maxok" }]);
    expect(docs.issues ?? []).toEqual([]);
  });

  it("rejects a 1048577-byte file before UTF-8 decode or JSON.parse", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "over.theme.json"), paddedThemeJson("toobig", MAX_FILE_BYTES + 1));

    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");
    const docs = await new FileAssets(dir).load("a");

    expect(docs.themes).toEqual([]);
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(docs.issues?.some((i) => i.includes("1048576"))).toBe(true);
  });

  it("rejects an initially-1MiB file that grows during the read, before decode/parse", async () => {
    // The race DC-007 pins: a stat taken before the read reports exactly the
    // 1048576-byte cap, then the file grows by one byte mid-read. The loader
    // never trusts a pre-read size — it bounded-reads cap+1 bytes and must see
    // the 1048577th byte, reject, and never decode or parse.
    const dir = makeTempDir();
    fsSpy.fakeEntries = ["grow.theme.json"];
    let delivered = 0;
    const grownSize = MAX_FILE_BYTES + 1;
    fsSpy.fakeRead = (buffer, offset, length) => {
      const n = Math.min(length, grownSize - delivered, 65_536);
      if (n <= 0) return 0;
      buffer.fill(0x20, offset, offset + n);
      delivered += n;
      return n;
    };

    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");
    const docs = await new FileAssets(dir).load("a");

    // Consumed at most cap+1 bytes — just enough to detect the overflow.
    expect(delivered).toBe(MAX_FILE_BYTES + 1);
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(docs.themes).toEqual([]);
    expect(docs.issues?.some((i) => i.includes("1048576"))).toBe(true);
  });

  // --- hostile fs throw values -----------------------------------------------------

  it("never rethrows or leaks a hostile opendir throw value through issues", async () => {
    const sentinel = "SENTINEL_SECRET_XYZ";
    fsSpy.opendirError = {
      message: sentinel,
      toString(): string {
        throw new Error(sentinel);
      },
    };
    const store = new FileAssets(join(tmpdir(), "facet-hostile"));
    const docs = await store.load("a");
    expect(docs.themes).toEqual([]);
    expect(docs.compositions).toEqual([]);
    expect(docs.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(docs.issues)).not.toContain(sentinel);

    // Boot continues safely with the defaults.
    const loaded = await loadAssets(store, "a");
    expect(loaded.themes.map((t) => t.name)).toContain(DEFAULT_THEME.name);
    expect(JSON.stringify(loaded.issues)).not.toContain(sentinel);
  });

  it("never rethrows or leaks a hostile file-open throw value through issues", async () => {
    const sentinel = "SENTINEL_OPEN_ABC";
    const dir = makeTempDir();
    writeFileSync(join(dir, "a.theme.json"), JSON.stringify({ name: "midnight" }));
    fsSpy.openError = {
      message: sentinel,
      toString(): string {
        throw new Error(sentinel);
      },
    };

    const docs = await new FileAssets(dir).load("a");
    expect(docs.themes).toEqual([]);
    expect(docs.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(docs.issues)).not.toContain(sentinel);
  });
});
