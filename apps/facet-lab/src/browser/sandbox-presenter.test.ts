import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME } from "@facet/assets";

import { createSandboxSession } from "../sandbox/sandbox-session.js";
import {
  createSandboxEditor,
  projectSettings,
  SANDBOX_CONTROL_LABELS,
} from "./sandbox-presenter.js";
import type { LabCapabilities } from "./run-config.js";

const CAPABILITIES: LabCapabilities = {
  deterministic: {
    mode: "deterministic",
    provider: "openai",
    available: true,
    models: ["facet-deterministic"],
    defaultModel: "facet-deterministic",
  },
  providers: {
    openai: {
      provider: "openai",
      available: true,
      models: ["gpt-safe"],
      defaultModel: "gpt-safe",
    },
    anthropic: {
      provider: "anthropic",
      available: false,
      models: ["claude-safe"],
      defaultModel: "claude-safe",
    },
  },
};

const SAFE_TREE = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["message"] },
    message: { id: "message", type: "text", value: "Trusted clone" },
  },
} as const;

describe("sandbox presenter", () => {
  it("keeps invalid edits isolated and provider settings secret-free", () => {
    const created = createSandboxSession({
      id: "browser-sandbox",
      theme: DEFAULT_THEME,
      tree: SAFE_TREE,
      source: { kind: "clone", runId: "run-source", revision: 7 },
    });
    if (!created.ok) throw new Error("expected safe sandbox session");
    const editor = createSandboxEditor(created.session);

    const invalid = editor.applyPatches(0, "{");
    expect(invalid).toMatchObject({
      status: "rejected",
      diagnostic: {
        code: "malformed-json",
        target: "patches",
        message: expect.stringMatching(/malformed/iu),
      },
      snapshot: {
        revision: 0,
        source: { kind: "clone", runId: "run-source", revision: 7 },
      },
    });
    expect(invalid.snapshot.previewTree.nodes["message"]).toMatchObject({
      value: "Trusted clone",
    });
    expect(invalid.snapshot.originalTree.nodes["message"]).toMatchObject({
      value: "Trusted clone",
    });

    const settings = projectSettings(CAPABILITIES, {
      dataDirectory: "Configured external data directory",
      retention: 500,
      bounds: { maxHistory: 100, screenshotConditions: 6 },
      apiKey: "secret-canary",
      absolutePath: "/private/facet-lab/data",
    });
    expect(settings).toMatchObject({
      providers: [
        { provider: "openai", available: true, models: ["gpt-safe"] },
        { provider: "anthropic", available: false, models: ["claude-safe"] },
      ],
      dataDirectory: { status: "available", label: "Configured external data directory" },
      retention: { status: "available", value: 500 },
      bounds: [
        { id: "maxHistory", status: "available", value: 100 },
        { id: "screenshotConditions", status: "available", value: 6 },
      ],
    });
    expect(JSON.stringify(settings)).not.toMatch(/secret-canary|\/private\/facet-lab|apiKey/iu);
  });

  it("applies patches with CAS while preserving the original and keeping view separate", () => {
    const created = createSandboxSession({
      id: "cas-sandbox",
      theme: DEFAULT_THEME,
      tree: SAFE_TREE,
      source: { kind: "clone", runId: "immutable-run", revision: 9 },
    });
    if (!created.ok) throw new Error("expected safe sandbox session");
    const editor = createSandboxEditor(created.session);

    const applied = editor.applyPatches(
      0,
      '[{"op":"replace","path":"/nodes/message/value","value":"Sandbox only"}]',
    );
    expect(applied).toMatchObject({ status: "applied", snapshot: { revision: 1 } });
    expect(applied.snapshot.previewTree.nodes["message"]).toMatchObject({ value: "Sandbox only" });
    expect(applied.snapshot.originalTree.nodes["message"]).toMatchObject({
      value: "Trusted clone",
    });
    expect(SAFE_TREE.nodes.message.value).toBe("Trusted clone");

    const conflict = editor.applyPatches(
      0,
      '[{"op":"replace","path":"/nodes/message/value","value":"Racing edit"}]',
    );
    expect(conflict).toMatchObject({
      status: "rejected",
      diagnostic: { code: "conflict", target: "patches" },
      snapshot: { revision: 1 },
    });
    expect(conflict.snapshot.previewTree.nodes["message"]).toMatchObject({ value: "Sandbox only" });

    const beforeView = conflict.snapshot.previewTree;
    const view = editor.checkpointView(1, '{"screen":"details","viewport":"narrow"}');
    expect(view).toMatchObject({
      status: "applied",
      snapshot: { revision: 2, view: { screen: "details", viewport: "narrow" } },
    });
    expect(view.snapshot.previewTree).toEqual(beforeView);
    expect(view.snapshot.previewTree).not.toHaveProperty("view");
  });

  it("marks absent safe settings metadata unavailable and names every editor control", () => {
    const settings = projectSettings(CAPABILITIES);
    expect(settings.dataDirectory).toEqual({ status: "unavailable", label: "Unavailable" });
    expect(settings.retention).toEqual({ status: "unavailable", value: null });
    expect(settings.bounds.every(({ status }) => status === "unavailable")).toBe(true);
    expect(new Set(Object.values(SANDBOX_CONTROL_LABELS)).size).toBe(
      Object.values(SANDBOX_CONTROL_LABELS).length,
    );
    expect(Object.values(SANDBOX_CONTROL_LABELS).every((label) => label.length > 0)).toBe(true);
  });

  it("keeps production browser modules away from Node, server, and provider secrets", async () => {
    const source = (
      await Promise.all(
        ["SandboxPage.tsx", "SettingsPage.tsx", "sandbox-presenter.ts"].map((file) =>
          readFile(new URL(file, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");
    expect(source).not.toMatch(/node:|\.\.\/server\/|@facet\/reference-agent|@facet\/server/u);
    expect(source).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|secret-canary/iu);
  });
});
