import { createHash } from "node:crypto";

import type { Browser } from "playwright";

import { CAPTURE_MATRIX, type CaptureCondition } from "../evaluation/capture-matrix.js";
import {
  MAX_EVIDENCE_BUNDLE_BYTES,
  type ArtifactManifestEntryV1,
  type RunEvidenceV1,
} from "../shared/run-contract.js";
import {
  exportEvidenceBundle,
  type EvidenceArtifact,
  type EvidenceBundleErrorCode,
} from "./evidence-bundle.js";
import type { EvidenceStore } from "./evidence-store.js";

export interface ScreenshotCaptureRequest {
  readonly url: string;
  readonly condition: CaptureCondition;
}

export interface ScreenshotDriver {
  capture(request: ScreenshotCaptureRequest): Promise<Uint8Array>;
}

export type ScreenshotOutcomeReason =
  | "browser-unavailable"
  | "bundle-bound"
  | "capture-failed"
  | "invalid-replay-url"
  | "persistence-failed";

export interface ScreenshotOutcome {
  readonly condition: CaptureCondition;
  readonly status: "available" | "unavailable" | "failed";
  readonly artifactId: string | null;
  readonly reason: ScreenshotOutcomeReason | null;
}

export interface ScreenshotCaptureInput {
  readonly evidence: RunEvidenceV1;
  readonly existingArtifacts: readonly EvidenceArtifact[];
  readonly evaluationId: string;
  readonly stageVersion: number | null;
  readonly ordinal: number;
}

export interface ScreenshotCaptureResult {
  readonly outcomes: readonly ScreenshotOutcome[];
  readonly persisted: boolean;
  readonly evidence: RunEvidenceV1;
  readonly artifacts: readonly EvidenceArtifact[];
}

export interface CreateScreenshotServiceOptions {
  readonly driver?: ScreenshotDriver;
  readonly store: Pick<EvidenceStore, "save">;
  readonly replayUrlForRun: (runId: string) => string;
}

export interface ScreenshotService {
  capture(input: ScreenshotCaptureInput): Promise<ScreenshotCaptureResult>;
}

function outcome(
  condition: CaptureCondition,
  status: ScreenshotOutcome["status"],
  artifactId: string | null,
  reason: ScreenshotOutcomeReason | null,
): ScreenshotOutcome {
  return Object.freeze({ condition, status, artifactId, reason });
}

function unavailableResult(input: ScreenshotCaptureInput): ScreenshotCaptureResult {
  return Object.freeze({
    outcomes: Object.freeze(
      CAPTURE_MATRIX.map((condition) =>
        outcome(condition, "unavailable", null, "browser-unavailable"),
      ),
    ),
    persisted: false,
    evidence: input.evidence,
    artifacts: input.existingArtifacts,
  });
}

function validReplayUrl(value: string, runId: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0 &&
      url.search.length === 0 &&
      url.pathname === `/replay/${runId}`
    );
  } catch {
    return false;
  }
}

function persistenceFailure(
  input: ScreenshotCaptureInput,
  outcomes: readonly ScreenshotOutcome[],
): ScreenshotCaptureResult {
  return Object.freeze({
    outcomes: Object.freeze(
      outcomes.map((item) =>
        item.status === "available"
          ? outcome(item.condition, "failed", null, "persistence-failed")
          : item,
      ),
    ),
    persisted: false,
    evidence: input.evidence,
    artifacts: input.existingArtifacts,
  });
}

function artifactId(evaluationId: string, condition: CaptureCondition): string | undefined {
  const id = `${evaluationId}-${condition.id}`;
  return evaluationId.trim() === evaluationId && evaluationId.length > 0 && id.length <= 200
    ? id
    : undefined;
}

function digest(data: Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function manifestEntry(
  id: string,
  data: Uint8Array,
  condition: CaptureCondition,
  stageVersion: number | null,
  ordinal: number,
): ArtifactManifestEntryV1 {
  return {
    id,
    kind: "screenshot",
    mediaType: "image/png",
    bytes: data.byteLength,
    digest: digest(data),
    capture: {
      viewport: condition.viewport,
      colorMode: condition.colorMode,
      stageVersion,
      ordinal,
    },
  };
}

function boundFailure(code: EvidenceBundleErrorCode): ScreenshotOutcomeReason {
  return code === "too-large" || code === "artifact-mismatch" ? "bundle-bound" : "capture-failed";
}

/** Adapt an already-launched Playwright browser; browser installation/launch stays in WU-28. */
export function createPlaywrightScreenshotDriver(browser: Browser): ScreenshotDriver {
  return Object.freeze({
    async capture({ url, condition }: ScreenshotCaptureRequest): Promise<Uint8Array> {
      const page = await browser.newPage({
        viewport: { width: condition.width, height: condition.height },
        colorScheme: condition.colorMode,
      });
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        const runId = new URL(url).pathname.split("/").at(-1);
        const selector = `[data-replay-run-id="${runId ?? ""}"] [data-replay-viewport="${condition.viewport}"][data-replay-color-mode="${condition.colorMode}"]`;
        await page.locator(selector).waitFor({ state: "visible" });
        return new Uint8Array(await page.screenshot({ type: "png", fullPage: true }));
      } finally {
        await page.close();
      }
    },
  });
}

export function createScreenshotService(
  options: CreateScreenshotServiceOptions,
): ScreenshotService {
  return Object.freeze({
    async capture(input: ScreenshotCaptureInput): Promise<ScreenshotCaptureResult> {
      if (options.driver === undefined) return unavailableResult(input);

      let replayUrl: string;
      try {
        replayUrl = options.replayUrlForRun(input.evidence.run.runId);
      } catch {
        replayUrl = "";
      }
      if (!validReplayUrl(replayUrl, input.evidence.run.runId)) {
        return Object.freeze({
          outcomes: Object.freeze(
            CAPTURE_MATRIX.map((condition) =>
              outcome(condition, "failed", null, "invalid-replay-url"),
            ),
          ),
          persisted: false,
          evidence: input.evidence,
          artifacts: input.existingArtifacts,
        });
      }

      let evidence = input.evidence;
      let artifacts = [...input.existingArtifacts];
      const outcomes: ScreenshotOutcome[] = [];
      for (let index = 0; index < CAPTURE_MATRIX.length; index += 1) {
        const condition = CAPTURE_MATRIX[index];
        if (condition === undefined) continue;
        const id = artifactId(input.evaluationId, condition);
        if (id === undefined) {
          outcomes.push(outcome(condition, "failed", null, "capture-failed"));
          continue;
        }
        try {
          const captureUrl = new URL(replayUrl);
          captureUrl.searchParams.set("capture", "1");
          captureUrl.searchParams.set("viewport", condition.viewport);
          captureUrl.searchParams.set("colorMode", condition.colorMode);
          const captured = await options.driver.capture({ url: captureUrl.href, condition });
          if (captured.byteLength === 0 || captured.byteLength >= MAX_EVIDENCE_BUNDLE_BYTES) {
            outcomes.push(outcome(condition, "failed", null, "bundle-bound"));
            continue;
          }
          const data = new Uint8Array(captured);
          const artifact = Object.freeze({ id, data });
          const candidate: RunEvidenceV1 = {
            ...evidence,
            artifacts: [
              ...evidence.artifacts,
              manifestEntry(id, data, condition, input.stageVersion, input.ordinal + index),
            ],
          };
          const bounded = exportEvidenceBundle(candidate, [...artifacts, artifact]);
          if (!bounded.ok) {
            outcomes.push(outcome(condition, "failed", null, boundFailure(bounded.error.code)));
            continue;
          }
          evidence = bounded.evidence;
          artifacts = [...bounded.artifacts];
          outcomes.push(outcome(condition, "available", id, null));
        } catch {
          outcomes.push(outcome(condition, "failed", null, "capture-failed"));
        }
      }

      if (!outcomes.some(({ status }) => status === "available")) {
        return Object.freeze({
          outcomes: Object.freeze(outcomes),
          persisted: false,
          evidence: input.evidence,
          artifacts: input.existingArtifacts,
        });
      }
      let stored: Awaited<ReturnType<EvidenceStore["save"]>>;
      try {
        stored = await options.store.save(evidence, artifacts);
      } catch {
        return persistenceFailure(input, outcomes);
      }
      if (!stored.accepted) {
        return persistenceFailure(input, outcomes);
      }
      return Object.freeze({
        outcomes: Object.freeze(outcomes),
        persisted: true,
        evidence: stored.evidence,
        artifacts: stored.artifacts,
      });
    },
  });
}
