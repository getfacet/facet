import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import { MAX_EVIDENCE_BUNDLE_BYTES, MAX_EVIDENCE_DEPTH } from "./run-contract.js";
import { redactForCapture, redactForExport } from "./redaction.js";

function nest(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe("recursive evidence redaction", () => {
  it("rejects oversized evidence and redacts secret canaries", () => {
    const openAiCanary = "sk-facet-canary-0123456789abcdef";
    const anthropicCanary = "sk-ant-facet-canary-0123456789abcdef";
    const input = {
      authorization: `Bearer ${openAiCanary}`,
      nested: {
        apiKey: anthropicCanary,
        safe: `provider said ${openAiCanary} while running`,
        headers: { "x-api-key": anthropicCanary },
      },
      records: [
        { cookie: `session=${openAiCanary}` },
        { stack: `Error\n at provider (${anthropicCanary})` },
      ],
    };

    const captured = redactForCapture(input, {
      canaries: [openAiCanary, anthropicCanary],
    });
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.error.message);

    const exported = redactForExport(captured.value, {
      canaries: [openAiCanary, anthropicCanary],
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.error.message);

    const serialized = JSON.stringify(exported.value);
    expect(serialized).not.toContain(openAiCanary);
    expect(serialized).not.toContain(anthropicCanary);
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("x-api-key");
    expect(serialized).not.toContain("Error\\n at provider");
    expect(serialized).toContain("[REDACTED]");
    expect(input.nested.apiKey).toBe(anthropicCanary);

    expect(
      redactForExport({ safe: "value" }, { maxBytes: MAX_EVIDENCE_BUNDLE_BYTES - 1 }),
    ).toMatchObject({ ok: true });
    expect(
      redactForExport({ safe: "value" }, { artifactBytes: MAX_EVIDENCE_BUNDLE_BYTES }),
    ).toMatchObject({ ok: false, error: { code: "too-large" } });
  });

  it("is detached and idempotent across capture and export passes", () => {
    const input = {
      safe: { label: "kept" },
      secret: "do-not-keep",
      notes: "Authorization: Bearer abcdefghijklmnop",
    };
    const first = redactForCapture(input);
    if (!first.ok) throw new Error(first.error.message);
    const second = redactForExport(first.value);
    if (!second.ok) throw new Error(second.error.message);

    expect(second.value).toEqual(first.value);
    expect(first.value).not.toBe(input);
    expect(input.secret).toBe("do-not-keep");

    const theme = redactForExport(DEFAULT_THEME);
    expect(theme.ok).toBe(true);
    if (!theme.ok) throw new Error(theme.error.message);
    expect(theme.value).toEqual(DEFAULT_THEME);
  });

  it("fails closed for cycles, excessive depth, and non-JSON values", () => {
    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;

    expect(redactForCapture(cyclic)).toMatchObject({
      ok: false,
      error: { code: "cyclic" },
    });
    expect(redactForCapture(nest(MAX_EVIDENCE_DEPTH + 2))).toMatchObject({
      ok: false,
      error: { code: "too-deep" },
    });
    expect(redactForCapture({ value: 1n })).toMatchObject({
      ok: false,
      error: { code: "non-json" },
    });

    let getterInvoked = false;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return "secret";
      },
    });
    Object.defineProperty(accessorArray, "length", { value: 1 });
    expect(redactForCapture(accessorArray)).toMatchObject({
      ok: false,
      error: { code: "non-json" },
    });
    expect(getterInvoked).toBe(false);
  });

  it("redacts common secret shapes without caller-provided canaries", () => {
    const result = redactForCapture({
      message: "token sk-test-abcdefghijklmnopqrstuvwxyz123456",
      aws: "AKIAABCDEFGHIJKLMNOP",
      password: "hunter2",
    });
    if (!result.ok) throw new Error(result.error.message);
    const serialized = JSON.stringify(result.value);

    expect(serialized).not.toContain("sk-test-");
    expect(serialized).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(serialized).not.toContain("hunter2");
  });
});
