import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PATTERNS } from "@facet/assets";
import { loadAssets } from "./assets.js";
import { FileAssets } from "./file-assets.js";

/**
 * Instrumented `node:fs` seam: every export delegates to the real
 * implementation by default, while tests can prove bounded discovery, zero
 * retired-file opens, pre-decode byte rejection, and hostile-error sanitation.
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

const MAX_FILE_BYTES = 1_048_576;
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

function paddedJson(value: unknown, bytes: number): string {
  const head = JSON.stringify(value);
  return head + " ".repeat(bytes - head.length);
}

describe("FileAssets", () => {
  it("loads only theme patterns and initial tree files", async () => {
    const source = readFileSync(new URL("./file-assets.ts", import.meta.url), "utf8");
    expect(source.includes("opendirSync")).toBe(true);
    expect(source.includes("readdirSync")).toBe(false);

    const dir = makeTempDir();
    const theme = { name: "brand" };
    const patterns = [{ name: "hero" }];
    const initialTree = { root: null, nodes: {} };
    writeFileSync(join(dir, "theme.json"), JSON.stringify(theme));
    writeFileSync(join(dir, "patterns.json"), JSON.stringify(patterns));
    writeFileSync(join(dir, "initial.tree.json"), JSON.stringify(initialTree));
    writeFileSync(join(dir, "old.theme.json"), JSON.stringify({ name: "retired" }));
    writeFileSync(join(dir, "old.composition.json"), JSON.stringify({ name: "retired" }));
    writeFileSync(join(dir, "catalog.json"), JSON.stringify({ theme: "retired" }));
    writeFileSync(join(dir, "other.json"), JSON.stringify({ ignored: true }));

    const docs = await new FileAssets(dir).load("a");

    expect(docs).toMatchObject({ theme, patterns, initialTree });
    expect(fsSpy.openedPaths).toEqual([
      join(dir, "initial.tree.json"),
      join(dir, "patterns.json"),
      join(dir, "theme.json"),
    ]);
    expect(docs.issues).toHaveLength(3);
    expect(docs.issues?.every((issue) => issue.includes("retired"))).toBe(true);
  });

  it("distinguishes an absent patterns file from an explicit empty list", async () => {
    const absentDir = makeTempDir();
    const absentRaw = await new FileAssets(absentDir).load("a");
    expect(absentRaw).not.toHaveProperty("patterns");
    const absentLoaded = await loadAssets(new FileAssets(absentDir), "a");
    expect(absentLoaded.patterns).toEqual(DEFAULT_PATTERNS);

    const emptyDir = makeTempDir();
    writeFileSync(join(emptyDir, "patterns.json"), "[]");
    const emptyRaw = await new FileAssets(emptyDir).load("a");
    expect(emptyRaw.patterns).toEqual([]);
    const emptyLoaded = await loadAssets(new FileAssets(emptyDir), "a");
    expect(emptyLoaded.patterns).toEqual([]);
  });

  it("reports retired files without opening or interpreting them", async () => {
    const dir = makeTempDir();
    const retired = ["brand.theme.json", "card.composition.json", "catalog.json"];
    for (const file of retired) writeFileSync(join(dir, file), "{ not json");

    const docs = await new FileAssets(dir).load("a");

    expect(fsSpy.openedPaths).toEqual([]);
    expect(docs).not.toHaveProperty("theme");
    expect(docs).not.toHaveProperty("patterns");
    expect(docs.issues).toHaveLength(retired.length);
    for (const file of retired) {
      expect(docs.issues?.some((issue) => issue.includes(file))).toBe(true);
    }
  });

  it("records invalid current JSON and continues with the remaining exact files", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "theme.json"), "{ not json");
    writeFileSync(join(dir, "patterns.json"), "[]");

    const docs = await new FileAssets(dir).load("a");

    expect(docs).not.toHaveProperty("theme");
    expect(docs.patterns).toEqual([]);
    expect(docs.issues?.some((issue) => issue.includes("theme.json"))).toBe(true);
  });

  it("enumerates exactly 4096 entries plus one null probe at the cap", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "brand" }));
    fsSpy.fakeEntries = [
      ...Array.from({ length: 4095 }, (_, index) => `junk-${String(index)}`),
      "theme.json",
    ];

    const docs = await new FileAssets(dir).load("a");

    expect(fsSpy.dirReads).toBe(4097);
    expect(fsSpy.dirCloses).toBe(1);
    expect(docs.theme).toEqual({ name: "brand" });
    expect(docs.issues).toEqual([]);
  });

  it("fails an overflowing directory closed before any open decode or parse", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "brand" }));
    fsSpy.fakeEntries = [
      "theme.json",
      ...Array.from({ length: 4096 }, (_, index) => `junk-${String(index)}`),
    ];
    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");

    const docs = await new FileAssets(dir).load("a");

    expect(fsSpy.dirReads).toBe(4097);
    expect(fsSpy.dirCloses).toBe(1);
    expect(fsSpy.openedPaths).toEqual([]);
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(docs).not.toHaveProperty("theme");
    expect(docs.issues?.some((issue) => issue.includes("4096"))).toBe(true);
  });

  it("accepts an exact 1048576-byte current file", async () => {
    const dir = makeTempDir();
    const theme = { name: "max" };
    writeFileSync(join(dir, "theme.json"), paddedJson(theme, MAX_FILE_BYTES));

    const docs = await new FileAssets(dir).load("a");

    expect(docs.theme).toEqual(theme);
    expect(docs.issues).toEqual([]);
  });

  it("rejects a 1048577-byte file before UTF-8 decode or JSON.parse", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "patterns.json"), paddedJson([], MAX_FILE_BYTES + 1));
    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");

    const docs = await new FileAssets(dir).load("a");

    expect(docs).not.toHaveProperty("patterns");
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
    expect(docs.issues?.some((issue) => issue.includes("1048576"))).toBe(true);
  });

  it("detects a file that grows past the byte cap during its bounded read", async () => {
    const dir = makeTempDir();
    fsSpy.fakeEntries = ["theme.json"];
    let delivered = 0;
    const grownSize = MAX_FILE_BYTES + 1;
    fsSpy.fakeRead = (buffer, offset, length) => {
      const count = Math.min(length, grownSize - delivered, 65_536);
      if (count <= 0) return 0;
      buffer.fill(0x20, offset, offset + count);
      delivered += count;
      return count;
    };
    const decodeSpy = vi.spyOn(TextDecoder.prototype, "decode");
    const parseSpy = vi.spyOn(JSON, "parse");

    const docs = await new FileAssets(dir).load("a");

    expect(delivered).toBe(MAX_FILE_BYTES + 1);
    expect(docs).not.toHaveProperty("theme");
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("bounds and sanitizes retired-file issue text", async () => {
    const dir = makeTempDir();
    fsSpy.fakeEntries = Array.from(
      { length: 70 },
      (_, index) => `retired-${String(index)}\n.theme.json`,
    );

    const docs = await new FileAssets(dir).load("a");

    expect(docs.issues?.length).toBeLessThanOrEqual(64);
    expect(docs.issues?.at(-1)).toContain("suppressed");
    expect(JSON.stringify(docs.issues)).not.toContain("\\n");
    expect(fsSpy.openedPaths).toEqual([]);

    const loaded = await loadAssets(new FileAssets(dir), "a");
    expect(loaded.issues).toHaveLength(64);
    expect(loaded.issues.at(-1)).toContain("suppressed");
  });

  it("never rethrows or leaks a hostile directory error", async () => {
    const sentinel = "SENTINEL_DIRECTORY_SECRET";
    fsSpy.opendirError = {
      message: sentinel,
      toString(): string {
        throw new Error(sentinel);
      },
    };

    const docs = await new FileAssets(join(tmpdir(), "facet-hostile")).load("a");

    expect(docs).not.toHaveProperty("theme");
    expect(docs).not.toHaveProperty("patterns");
    expect(docs.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(docs.issues)).not.toContain(sentinel);
  });

  it("never rethrows or leaks a hostile current-file open error", async () => {
    const sentinel = "SENTINEL_OPEN_SECRET";
    const dir = makeTempDir();
    writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "brand" }));
    fsSpy.openError = {
      message: sentinel,
      toString(): string {
        throw new Error(sentinel);
      },
    };

    const docs = await new FileAssets(dir).load("a");

    expect(docs).not.toHaveProperty("theme");
    expect(docs.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(docs.issues)).not.toContain(sentinel);
  });
});
