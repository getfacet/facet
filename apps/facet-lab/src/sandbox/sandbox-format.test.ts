import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import {
  MAX_SANDBOX_DOCUMENT_BYTES,
  parseSandboxPatches,
  parseSandboxTree,
  validateSandboxPatches,
  validateSandboxTree,
} from "./sandbox-format.js";

const SAFE_TREE = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["message"] },
    message: { id: "message", type: "text", value: "Trusted" },
  },
} as const;

describe("sandbox format boundary", () => {
  it("preserves the last safe clone under prohibited and racing edits", () => {
    expect(parseSandboxTree(JSON.stringify(SAFE_TREE), DEFAULT_THEME)).toMatchObject({
      ok: true,
      value: SAFE_TREE,
    });
    expect(
      parseSandboxPatches('[{"op":"replace","path":"/nodes/message/value","value":"Next"}]'),
    ).toMatchObject({ ok: true });

    expect(parseSandboxTree("{", DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "malformed-json" },
    });

    const cyclic: Record<string, unknown> = { ...SAFE_TREE };
    cyclic["cycle"] = cyclic;
    expect(validateSandboxTree(cyclic, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "cyclic" },
    });

    let deep: unknown = "leaf";
    for (let index = 0; index < 40; index += 1) deep = { next: deep };
    expect(validateSandboxTree(deep, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "too-deep" },
    });

    const oversized = `{"padding":"${"x".repeat(MAX_SANDBOX_DOCUMENT_BYTES)}"}`;
    expect(parseSandboxTree(oversized, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });

    const rawHtml = structuredClone(SAFE_TREE) as {
      nodes: { message: { value: string } };
    };
    rawHtml.nodes.message.value = "<script>steal()</script>";
    const htmlResult = validateSandboxTree(rawHtml, DEFAULT_THEME);
    expect(htmlResult).toMatchObject({
      ok: false,
      error: { code: "prohibited-content" },
    });
    expect(JSON.stringify(htmlResult)).not.toContain("steal");

    const rawJavascript = structuredClone(SAFE_TREE) as {
      nodes: { message: { value: string } };
    };
    rawJavascript.nodes.message.value = "fetch('/private')";
    expect(validateSandboxTree(rawJavascript, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "prohibited-content" },
    });

    const rawCss = structuredClone(SAFE_TREE) as {
      nodes: { message: { value: string } };
    };
    rawCss.nodes.message.value = "position: absolute;";
    expect(validateSandboxTree(rawCss, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "prohibited-content" },
    });

    const openStyle = structuredClone(SAFE_TREE) as {
      nodes: { message: { style?: Record<string, string> } };
    };
    openStyle.nodes.message.style = { position: "absolute" };
    expect(validateSandboxTree(openStyle, DEFAULT_THEME)).toMatchObject({
      ok: false,
      error: { code: "invalid-tree" },
    });

    expect(
      validateSandboxPatches([
        { op: "add", path: "/nodes/message/fetch", value: "https://example.test" },
      ]),
    ).toMatchObject({ ok: false, error: { code: "prohibited-content" } });
    expect(validateSandboxPatches([{ op: "execute", path: "", value: "alert(1)" }])).toMatchObject({
      ok: false,
      error: { code: "invalid-patch" },
    });
  });
});
