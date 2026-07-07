import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionFilePath } from "./session-file.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "facet-session-file-"));
}

describe("sessionFilePath", () => {
  it("keeps a hostile visitorId inside dir with no separators in the filename", () => {
    const dir = tempDir();
    for (const visitorId of ["../../evil", "a/b", "café-№1-🎉"]) {
      const file = sessionFilePath(dir, "agent", visitorId, "json");
      const name = basename(file);
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).not.toContain("..");
      // Resolves strictly inside the store directory — no traversal escape.
      expect(resolve(file).startsWith(resolve(dir) + sep)).toBe(true);
    }
  });

  it("maps distinct (agent, visitor) pairs to distinct files", () => {
    const dir = tempDir();
    const files = new Set([
      sessionFilePath(dir, "a", "v", "json"),
      sessionFilePath(dir, "a", "v2", "json"),
      sessionFilePath(dir, "a2", "v", "json"),
    ]);
    expect(files.size).toBe(3);
  });

  it("honors the requested extension", () => {
    const dir = tempDir();
    expect(sessionFilePath(dir, "a", "v", "json").endsWith(".json")).toBe(true);
    expect(sessionFilePath(dir, "a", "v", "jsonl").endsWith(".jsonl")).toBe(true);
  });
});
