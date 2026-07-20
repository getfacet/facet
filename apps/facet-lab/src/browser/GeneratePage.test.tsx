// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GeneratePage } from "./GeneratePage.js";
import { SettingsPage } from "./SettingsPage.js";
import type { LabCapabilities } from "./run-config.js";

const OPENAI_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
] as const;

const CAPABILITIES: LabCapabilities = {
  deterministic: {
    mode: "deterministic",
    provider: "openai",
    available: true,
    models: ["facet-lab-deterministic-v1"],
    defaultModel: "facet-lab-deterministic-v1",
  },
  providers: {
    openai: {
      provider: "openai",
      available: true,
      models: OPENAI_MODELS,
      defaultModel: OPENAI_MODELS[0],
    },
    anthropic: {
      provider: "anthropic",
      available: false,
      models: ["claude-test"],
      defaultModel: "claude-test",
    },
  },
};

afterEach(cleanup);

describe("Generate provider controls", () => {
  it("offers every configured real model without an execution-mode choice", async () => {
    render(<GeneratePage capabilities={CAPABILITIES} />);

    await waitFor(() => expect(screen.getByLabelText("Model")).toBeTruthy());
    expect(screen.queryByLabelText("Execution")).toBeNull();
    expect(screen.queryByText("Deterministic fixture")).toBeNull();
    expect(screen.queryByText("Advanced asset settings")).toBeNull();

    const modelSelect = screen.getByLabelText("Model");
    expect(
      within(modelSelect)
        .getAllByRole("option")
        .map(({ textContent }) => textContent),
    ).toEqual(OPENAI_MODELS);
    expect((modelSelect as HTMLSelectElement).value).toBe("gpt-5.6-sol");
  });

  it("does not expose the internal deterministic fixture in settings", () => {
    render(<SettingsPage capabilities={CAPABILITIES} />);

    expect(screen.queryByText("Deterministic fixture")).toBeNull();
    expect(screen.getByText("openai")).toBeTruthy();
  });
});
