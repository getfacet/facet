import { closeSync, openSync, opendirSync, readSync } from "node:fs";
import { join } from "node:path";
import type { AssetDocuments, AssetsStore } from "./assets.js";

/** Directory entries enumerated before the whole directory fails closed. */
const MAX_DIRECTORY_ENTRIES = 4096;
/** Bytes accepted per file; the loader reads at most cap+1 to detect overflow. */
const MAX_FILE_BYTES = 1_048_576;
const MAX_ISSUES = 64;
const ISSUES_SUPPRESSED = "...further asset file issues suppressed";
const MAX_ISSUE_CHARS = 200;

function isControlChar(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Bound + strip control characters from operator-adjacent text (paths, file
 * names) before it enters an issue string. Never returns hostile bytes. */
function sanitizeIssueText(raw: string): string {
  let out = "";
  const limit = Math.min(raw.length, MAX_ISSUE_CHARS);
  for (let i = 0; i < limit; i += 1) {
    const ch = raw[i]!;
    out += isControlChar(ch.charCodeAt(0)) ? "?" : ch;
  }
  return raw.length > MAX_ISSUE_CHARS ? `${out}...` : out;
}

/**
 * A bounded, sanitized detail for a caught fs error. NEVER interpolates the raw
 * exception (a hostile throw value's `message`/`toString` could carry control
 * bytes, unbounded text, or throw again): only a short uppercase `code`
 * (ENOENT, EACCES, ...) is echoed, and only after a strict whitelist check.
 */
function fsErrorDetail(err: unknown): string {
  try {
    if (typeof err === "object" && err !== null && "code" in err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code)) return code;
    }
  } catch {
    return "unreadable error";
  }
  return "unreadable error";
}

type Discovery = { readonly ok: true; readonly names: readonly string[] } | { readonly ok: false };

/**
 * Durable, dependency-free reference `AssetsStore`: reads an operator's exact
 * optional `theme.json`, `patterns.json`, and `initial.tree.json` documents.
 * Documents are served RAW; `loadAssets` validates them. Recognized retired
 * Theme/Composition/Catalog files are reported, but never opened or
 * reinterpreted as current assets. All other files are ignored.
 *
 * Bounded on every axis (DC-007), because the directory is external input:
 *  - discovery enumerates at most 4096 entries with a streaming
 *    `opendirSync`/`readSync` walk; the 4097th entry is read ONLY to detect
 *    overflow, then enumeration stops, the handle closes, and the WHOLE raw
 *    directory fails closed (empty documents + a bounded issue) BEFORE any
 *    asset file is opened, decoded, or parsed — `loadAssets` then boots on the
 *    bundled defaults;
 *  - after discovery succeeds, at most the three exact current files are
 *    opened, in sorted filename order;
 *  - each file is bounded-read at most cap+1 = 1048577 bytes: exactly 1048576
 *    bytes are accepted, and the 1048577th byte rejects the file BEFORE UTF-8
 *    decode / `JSON.parse` — even when a pre-read size check saw exactly the
 *    cap (the file grew during the read);
 *  - an unreadable directory/file or bad JSON becomes an `issues` entry with a
 *    bounded, sanitized detail (raw exception values never flow into issues)
 *    and boot proceeds — the `FileStageStore` skip-and-log posture.
 *
 * Node-only (uses `node:fs`) — kept in its own module, behind
 * `@facet/runtime/node`, so browser bundles that import `MemoryAssets` don't
 * pull in `node:fs`.
 */
export class FileAssets implements AssetsStore {
  constructor(private readonly dir: string) {}

  async load(_agentId: string): Promise<AssetDocuments> {
    const issues: string[] = [];
    const pushIssue = (issue: string): void => {
      if (issues.length >= MAX_ISSUES) {
        if (issues[issues.length - 1] !== ISSUES_SUPPRESSED) issues.push(ISSUES_SUPPRESSED);
        return;
      }
      issues.push(sanitizeIssueText(issue));
    };

    const discovery = this.discoverEntries(pushIssue);
    if (!discovery.ok) {
      // Fail the whole raw directory closed: no asset file is opened, decoded,
      // or parsed past a discovery failure; loadAssets boots on the defaults.
      return { issues };
    }
    const names = [...discovery.names].sort();

    for (const name of names) {
      if (this.isRetiredAssetFile(name)) {
        pushIssue(`retired asset file ignored (${name})`);
      }
    }

    const docs: {
      theme?: unknown;
      patterns?: unknown;
      initialTree?: unknown;
      issues: readonly string[];
    } = { issues };
    const currentFiles = ["initial.tree.json", "patterns.json", "theme.json"] as const;
    for (const file of currentFiles) {
      if (!names.includes(file)) continue;
      const value = this.parseFile(file, pushIssue);
      if (value === undefined) continue;
      if (file === "theme.json") docs.theme = value;
      else if (file === "patterns.json") docs.patterns = value;
      else docs.initialTree = value;
    }

    return docs;
  }

  private isRetiredAssetFile(name: string): boolean {
    return (
      name === "catalog.json" || name.endsWith(".theme.json") || name.endsWith(".composition.json")
    );
  }

  /** Streaming bounded enumeration: at most `MAX_DIRECTORY_ENTRIES` entries are
   * kept, and exactly one extra entry may be read — solely to detect overflow. */
  private discoverEntries(pushIssue: (issue: string) => void): Discovery {
    let dir: ReturnType<typeof opendirSync>;
    try {
      dir = opendirSync(this.dir);
    } catch (err) {
      pushIssue(`assets directory unreadable (${this.dir}): ${fsErrorDetail(err)}`);
      return { ok: false };
    }
    try {
      const names: string[] = [];
      for (let read = 0; read < MAX_DIRECTORY_ENTRIES; read += 1) {
        const entry = dir.readSync();
        if (entry === null) return { ok: true, names };
        const name: unknown = entry.name;
        if (typeof name === "string") names.push(name);
      }
      // Entry cap+1: read once more ONLY to learn whether anything remains.
      if (dir.readSync() !== null) {
        pushIssue(
          `assets directory exceeded the ${String(MAX_DIRECTORY_ENTRIES)}-entry cap — all asset files ignored`,
        );
        return { ok: false };
      }
      return { ok: true, names };
    } catch (err) {
      pushIssue(`assets directory enumeration failed: ${fsErrorDetail(err)}`);
      return { ok: false };
    } finally {
      try {
        dir.closeSync();
      } catch {
        // Already closed or a hostile handle — nothing safe left to do.
      }
    }
  }

  /** Bounded read + decode + parse for one file; any failure is an issue with a
   * sanitized detail, never a throw and never a raw exception echo. */
  private parseFile(file: string, pushIssue: (issue: string) => void): unknown {
    const text = this.readBounded(file, pushIssue);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A SyntaxError message can embed file content — never interpolate it.
      pushIssue(`asset file skipped (${file}): invalid JSON`);
      return undefined;
    }
  }

  /**
   * Reads at most `MAX_FILE_BYTES + 1` bytes. Exactly `MAX_FILE_BYTES` bytes are
   * accepted; seeing byte cap+1 rejects the file BEFORE UTF-8 decode — the size
   * gate cannot be raced by a file that grows between a stat and the read,
   * because no pre-read size is ever trusted.
   */
  private readBounded(file: string, pushIssue: (issue: string) => void): string | undefined {
    const path = join(this.dir, file);
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch (err) {
      pushIssue(`asset file skipped (${file}): ${fsErrorDetail(err)}`);
      return undefined;
    }
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let total = 0;
    try {
      while (total < buffer.length) {
        const read = readSync(fd, buffer, total, buffer.length - total, null);
        if (!Number.isSafeInteger(read) || read <= 0) break;
        total += read;
      }
    } catch (err) {
      pushIssue(`asset file skipped (${file}): ${fsErrorDetail(err)}`);
      return undefined;
    } finally {
      try {
        closeSync(fd);
      } catch {
        // Nothing safe left to do for a close failure.
      }
    }
    if (total > MAX_FILE_BYTES) {
      pushIssue(`asset file skipped (${file}): larger than the ${String(MAX_FILE_BYTES)}-byte cap`);
      return undefined;
    }
    return new TextDecoder().decode(buffer.subarray(0, total));
  }
}
