import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProviderName, RunEvidenceV1 } from "../src/shared/run-contract.js";
import { bootLabHarness, requestJson, waitForEvidence, type LabHarness } from "./lab-harness.js";

type GateDisposition = "run" | "fail" | "skip";

interface LiveGatePolicy {
  readonly disposition: GateDisposition;
  readonly reason: string | null;
}

const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const LIVE_REQUIRED = process.env.FACET_LAB_LIVE_REQUIRED === "1";
const OPTIONAL_VISUAL = process.env.FACET_LAB_OPTIONAL_VISUAL === "1";

function liveGatePolicy(input: {
  readonly required: boolean;
  readonly optionalVisual: boolean;
  readonly hasProviderKey: boolean;
}): LiveGatePolicy {
  if (input.required && !input.hasProviderKey) {
    return { disposition: "fail", reason: "required-provider-key-missing" };
  }
  if (input.optionalVisual && !input.hasProviderKey) {
    return { disposition: "skip", reason: "optional-visual-key-missing" };
  }
  return { disposition: "run", reason: null };
}

function postJson<T>(harness: LabHarness, path: string, body: unknown): Promise<T> {
  return requestJson<T>(harness, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let activeHarness: LabHarness | undefined;

afterEach(async () => {
  await activeHarness?.close();
  activeHarness = undefined;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stopReasons(evidence: RunEvidenceV1): readonly string[] {
  return evidence.records.flatMap(({ data }) =>
    isRecord(data) && data["kind"] === "stop" && typeof data["reason"] === "string"
      ? [data["reason"]]
      : [],
  );
}

function messageTurnOutcomes(evidence: RunEvidenceV1): readonly string[] {
  const messageTurns = new Set(
    evidence.records.flatMap(({ kind, data, turnId }) => {
      if (kind !== "ui-in" || turnId === null || !isRecord(data)) return [];
      const event = data["event"];
      return isRecord(event) && event["kind"] === "message" ? [turnId] : [];
    }),
  );
  return evidence.records.flatMap(({ data, turnId }) =>
    turnId !== null &&
    messageTurns.has(turnId) &&
    isRecord(data) &&
    data["kind"] === "stop" &&
    typeof data["reason"] === "string"
      ? [data["reason"]]
      : [],
  );
}

async function runLiveProvider(
  provider: ProviderName,
  key: string,
  options: {
    readonly screenshotMode?: "real" | "unavailable";
    readonly exerciseInteractions?: boolean;
  } = {},
): Promise<{ readonly harness: LabHarness; readonly evidence: RunEvidenceV1 }> {
  const screenshotMode = options.screenshotMode ?? "unavailable";
  const exerciseInteractions = options.exerciseInteractions ?? true;
  const gatePaths = {
    ...(process.env.FACET_LAB_DATA_DIR === undefined
      ? {}
      : { FACET_LAB_DATA_DIR: process.env.FACET_LAB_DATA_DIR }),
    ...(process.env.FACET_LAB_ARTIFACTS_DIR === undefined
      ? {}
      : { FACET_LAB_ARTIFACTS_DIR: process.env.FACET_LAB_ARTIFACTS_DIR }),
  };
  const environment =
    provider === "openai"
      ? { ...gatePaths, OPENAI_API_KEY: key }
      : { ...gatePaths, ANTHROPIC_API_KEY: key };
  const harness = await bootLabHarness({ environment, screenshotMode });
  activeHarness = harness;
  const page = await harness.newPage();
  await page.goto(`${harness.url}/generate`, { waitUntil: "networkidle" });
  await page.locator("#generate-mode").selectOption("provider");
  await page.locator("#generate-provider").selectOption(provider);
  await page.getByRole("button", { name: "Start new run" }).click();
  const stage = page.getByLabel("Live Facet stage");
  await stage.waitFor();
  const runId = await stage.getAttribute("data-run-id");
  if (runId === null) throw new Error(`${provider} run did not expose a run id`);
  const initial = await waitForEvidence(
    harness,
    runId,
    (candidate) =>
      candidate.frames.some(({ patches }) => patches.length > 0) &&
      stopReasons(candidate).includes("complete"),
    120_000,
  );
  expect((await stage.innerText()).trim().length).toBeGreaterThan(0);
  const initialPatchFrames = initial.frames.filter(({ patches }) => patches.length > 0).length;
  if (exerciseInteractions) {
    const initialStops = stopReasons(initial).length;
    const action = stage.locator('[role="button"]').first();
    await action.waitFor({ state: "visible" });
    await action.click();
    const interacted = await waitForEvidence(
      harness,
      runId,
      (candidate) => stopReasons(candidate).length > initialStops,
      120_000,
    );
    expect(messageTurnOutcomes(interacted).length).toBe(0);
    const interactionStops = stopReasons(interacted).length;

    await page
      .locator("#generate-follow-up")
      .fill("Update the page after this UI-IN follow-up while preserving valid Facet contracts.");
    await page.getByRole("button", { name: "Send follow-up through UI-IN" }).click();
    const followedUp = await waitForEvidence(
      harness,
      runId,
      (candidate) =>
        messageTurnOutcomes(candidate).length > 0 &&
        stopReasons(candidate).length > interactionStops,
      120_000,
    );
    expect(messageTurnOutcomes(followedUp).at(-1)).toBe("complete");
    expect(followedUp.frames.filter(({ patches }) => patches.length > 0).length).toBeGreaterThan(
      initialPatchFrames,
    );
  }
  await page.getByRole("button", { name: "Cancel run" }).click();
  const terminal = await waitForEvidence(
    harness,
    runId,
    ({ run }) => run.status === "cancelled",
    30_000,
  );
  await page.close();

  const recalculated = await postJson<{ readonly accepted: boolean }>(
    harness,
    `/api/runs/${runId}/evaluations`,
    { kind: "recalculate" },
  );
  expect(recalculated.accepted).toBe(true);
  const evidence = await waitForEvidence(harness, runId, ({ checks }) => checks.length > 0);
  expect(evidence.run.provider).toBe(provider);
  expect(evidence.run.mode).toBe("provider");
  expect(evidence.finalTree).not.toBeNull();
  expect(evidence.frames.length).toBeGreaterThanOrEqual(exerciseInteractions ? 2 : 1);
  expect(evidence.records.every(({ runId: correlated }) => correlated === runId)).toBe(true);
  expect(JSON.stringify(terminal)).not.toContain(key);
  expect(JSON.stringify(evidence)).not.toContain(key);
  return { harness, evidence };
}

describe("Facet Lab live provider and optional visual policy", () => {
  it("distinguishes required-key FAIL, optional-visual SKIP, and configured RUN", () => {
    expect(
      liveGatePolicy({ required: true, optionalVisual: false, hasProviderKey: false }),
    ).toEqual({
      disposition: "fail",
      reason: "required-provider-key-missing",
    });
    expect(
      liveGatePolicy({ required: false, optionalVisual: true, hasProviderKey: false }),
    ).toEqual({
      disposition: "skip",
      reason: "optional-visual-key-missing",
    });
    expect(liveGatePolicy({ required: true, optionalVisual: false, hasProviderKey: true })).toEqual(
      {
        disposition: "run",
        reason: null,
      },
    );
  });

  it("fails closed inside the required command if its provider environment is stripped", () => {
    const hasProviderKey = OPENAI_KEY !== undefined || ANTHROPIC_KEY !== undefined;
    const policy = liveGatePolicy({
      required: LIVE_REQUIRED,
      optionalVisual: OPTIONAL_VISUAL,
      hasProviderKey,
    });
    if (LIVE_REQUIRED) expect(policy.disposition).toBe("run");
    if (OPTIONAL_VISUAL && !hasProviderKey) expect(policy.disposition).toBe("skip");
  });

  it.skipIf(OPENAI_KEY === undefined || OPTIONAL_VISUAL)(
    "runs OpenAI through asset reads, live patches, correlated evidence, and contract evaluation",
    async () => {
      await runLiveProvider("openai", OPENAI_KEY ?? "");
    },
    240_000,
  );

  it.skipIf(ANTHROPIC_KEY === undefined || OPTIONAL_VISUAL)(
    "runs Anthropic through asset reads, live patches, correlated evidence, and contract evaluation",
    async () => {
      await runLiveProvider("anthropic", ANTHROPIC_KEY ?? "");
    },
    240_000,
  );

  it.skipIf(!OPTIONAL_VISUAL || (OPENAI_KEY === undefined && ANTHROPIC_KEY === undefined))(
    "keeps optional visual unavailability advisory and separate from the blocking verdict",
    async () => {
      const provider = OPENAI_KEY !== undefined ? "openai" : "anthropic";
      const key = OPENAI_KEY ?? ANTHROPIC_KEY ?? "";
      const { harness, evidence } = await runLiveProvider(provider, key, {
        screenshotMode: "real",
        exerciseInteractions: false,
      });
      const captured = await postJson<{ readonly persisted: boolean }>(
        harness,
        `/api/runs/${evidence.run.runId}/captures`,
        {},
      );
      expect(captured.persisted).toBe(true);
      const withArtifacts = await waitForEvidence(
        harness,
        evidence.run.runId,
        ({ artifacts }) => artifacts.filter(({ kind }) => kind === "screenshot").length === 6,
      );
      await mkdir(harness.artifactDirectory, { recursive: true, mode: 0o700 });
      for (const artifact of withArtifacts.artifacts.filter(({ kind }) => kind === "screenshot")) {
        const response = await fetch(
          `${harness.url}/api/runs/${evidence.run.runId}/artifacts/${artifact.id}`,
        );
        expect(response.ok).toBe(true);
        await writeFile(
          join(harness.artifactDirectory, `${artifact.id}.png`),
          new Uint8Array(await response.arrayBuffer()),
        );
      }
      const checks = structuredClone(evidence.checks);
      const appended = await postJson<{ readonly accepted: boolean }>(
        harness,
        `/api/runs/${evidence.run.runId}/evaluations`,
        {
          kind: "advisory",
          record: {
            id: "optional-visual-unavailable",
            evaluator: "vision",
            status: "unavailable",
            reason: "judge-unavailable",
            artifactIds: [],
            createdAt: new Date().toISOString(),
          },
        },
      );
      expect(appended.accepted).toBe(true);
      const updated = await waitForEvidence(
        harness,
        evidence.run.runId,
        ({ visualEvaluations }) => visualEvaluations.length === 1,
      );
      expect(updated.visualEvaluations[0]?.status).toBe("unavailable");
      expect(updated.visualEvaluations[0]?.verdict).toBeNull();
      expect(updated.checks).toEqual(checks);
    },
    240_000,
  );
});
