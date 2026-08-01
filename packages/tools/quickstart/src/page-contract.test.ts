import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function pageSource(): string {
  return readFileSync("packages/tools/quickstart/src/page/main.tsx", "utf8");
}

describe("quickstart page transport contract", () => {
  it("routes visitor messages through SseTransport's ordered queue", () => {
    const source = pageSource();

    expect(source).not.toContain('fetch("/message"');
    expect(source).toContain(".sendMessage({");
    expect(source).toContain("const [initialPending, setInitialPending]");
    expect(source).toContain("validateVisitorText(draft)");
    expect(source).toContain("globalThis.crypto");
    expect(source).not.toContain("typeof crypto.randomUUID");
    expect(source).toContain("disabled={facet.pending || initialPending}");
  });
});
