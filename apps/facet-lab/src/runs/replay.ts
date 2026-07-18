import { foldPatchIntoStage, sanitizeView, type FacetTree, type ViewSnapshot } from "@facet/core";

import type {
  ColorMode,
  FrameDisposition,
  RunEvidenceV1,
  ViewportName,
} from "../shared/run-contract.js";

export type ReplayIssueCode =
  | "checkpoint-digest-mismatch"
  | "checkpoint-gap"
  | "checkpoint-tree-mismatch"
  | "final-tree-mismatch"
  | "frame-digest-mismatch"
  | "frame-order"
  | "initial-tree"
  | "patch-fold"
  | "stage-version-gap";

export interface ReplayIssue {
  readonly code: ReplayIssueCode;
  readonly ordinal: number | null;
  readonly message: string;
}

export interface ReplaySnapshot {
  readonly ordinal: number | null;
  readonly stageVersion: number;
  readonly disposition: "initial" | FrameDisposition;
  readonly tree: FacetTree;
  readonly says: readonly string[];
  readonly digest: string;
  readonly digestMatchesEvidence: boolean;
}

export interface ReplayViewCheckpoint {
  readonly ordinal: number;
  readonly viewport: ViewportName;
  readonly colorMode: ColorMode;
  readonly initialView: ViewSnapshot | null;
}

export interface ReplayResult {
  readonly providerFree: true;
  readonly runId: string;
  readonly snapshots: readonly ReplaySnapshot[];
  readonly viewCheckpoints: readonly ReplayViewCheckpoint[];
  readonly finalTree: FacetTree;
  readonly finalTreeMatchesEvidence: boolean | null;
  readonly issues: readonly ReplayIssue[];
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choose + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") return "null";
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function digestReplayTree(tree: FacetTree): string {
  return `sha256:${sha256(canonicalJson(tree))}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sameTree(left: FacetTree, right: FacetTree): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function issue(code: ReplayIssueCode, ordinal: number | null, message: string): ReplayIssue {
  return { code, ordinal, message };
}

/** Reconstruct recorded trees and view checkpoints without accepting a provider callback. */
export function replayRun(evidence: RunEvidenceV1): ReplayResult {
  const issues: ReplayIssue[] = [];
  const initialFold = foldPatchIntoStage(evidence.initialTree, []);
  for (const message of initialFold.issues) issues.push(issue("initial-tree", null, message));
  let tree = initialFold.tree;
  let stageVersion = 0;
  let previousOrdinal = -1;
  const initialDigest = digestReplayTree(tree);
  const snapshots: ReplaySnapshot[] = [
    {
      ordinal: null,
      stageVersion,
      disposition: "initial",
      tree,
      says: [],
      digest: initialDigest,
      digestMatchesEvidence: true,
    },
  ];

  const frames = [...evidence.frames].sort(
    (left, right) => left.ordinal - right.ordinal || left.stageVersion - right.stageVersion,
  );
  for (let index = 1; index < evidence.frames.length; index += 1) {
    const previous = evidence.frames[index - 1];
    const current = evidence.frames[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      (current.ordinal <= previous.ordinal || current.stageVersion < previous.stageVersion)
    ) {
      issues.push(
        issue(
          "frame-order",
          current.ordinal,
          "Recorded frame order is not monotonic; replay used ordinal/version order.",
        ),
      );
    }
  }
  for (const frame of frames) {
    if (frame.ordinal <= previousOrdinal) {
      issues.push(issue("frame-order", frame.ordinal, "Frame ordinals must increase."));
    }
    if (frame.stageVersion > stageVersion + 1) {
      issues.push(
        issue(
          "stage-version-gap",
          frame.ordinal,
          `Recorded stage version jumped from ${String(stageVersion)} to ${String(frame.stageVersion)}.`,
        ),
      );
    } else if (frame.stageVersion < stageVersion) {
      issues.push(issue("frame-order", frame.ordinal, "Recorded stage version moved backward."));
    }

    if (frame.disposition === "applied") {
      const folded = foldPatchIntoStage(tree, frame.patches);
      tree = folded.tree;
      for (const message of folded.issues) {
        issues.push(issue("patch-fold", frame.ordinal, message));
      }
    }
    stageVersion = Math.max(stageVersion, frame.stageVersion);
    previousOrdinal = Math.max(previousOrdinal, frame.ordinal);
    const digest = digestReplayTree(tree);
    const digestMatchesEvidence = digest === frame.postFoldTreeDigest;
    if (!digestMatchesEvidence) {
      issues.push(
        issue("frame-digest-mismatch", frame.ordinal, "Frame tree digest did not verify."),
      );
    }
    snapshots.push({
      ordinal: frame.ordinal,
      stageVersion: frame.stageVersion,
      disposition: frame.disposition,
      tree,
      says: [...frame.says],
      digest,
      digestMatchesEvidence,
    });
  }

  for (const checkpoint of evidence.checkpoints) {
    const snapshot = snapshots.find(
      (candidate) =>
        candidate.ordinal === checkpoint.ordinal &&
        candidate.stageVersion === checkpoint.stageVersion,
    );
    if (snapshot === undefined) {
      issues.push(
        issue("checkpoint-gap", checkpoint.ordinal, "Checkpoint has no matching replay frame."),
      );
      continue;
    }
    if (snapshot.digest !== checkpoint.treeDigest) {
      issues.push(
        issue(
          "checkpoint-digest-mismatch",
          checkpoint.ordinal,
          "Checkpoint tree digest did not verify.",
        ),
      );
    }
    if (!sameTree(snapshot.tree, checkpoint.tree)) {
      issues.push(
        issue(
          "checkpoint-tree-mismatch",
          checkpoint.ordinal,
          "Checkpoint tree differs from the replay fold.",
        ),
      );
    }
  }

  const finalTreeMatchesEvidence =
    evidence.finalTree === null ? null : sameTree(tree, evidence.finalTree);
  if (finalTreeMatchesEvidence === false) {
    issues.push(issue("final-tree-mismatch", null, "Final tree differs from the replay fold."));
  }
  const viewCheckpoints = evidence.viewCheckpoints.map((checkpoint) => ({
    ordinal: checkpoint.ordinal,
    viewport: checkpoint.viewport,
    colorMode: checkpoint.colorMode,
    initialView: sanitizeView(checkpoint.view) ?? null,
  }));

  return deepFreeze({
    providerFree: true,
    runId: evidence.run.runId,
    snapshots,
    viewCheckpoints,
    finalTree: tree,
    finalTreeMatchesEvidence,
    issues,
  });
}
