import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_THEME } from "@facet/assets";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_EVIDENCE_BUNDLE_BYTES, type RunEvidenceV1 } from "../shared/run-contract.js";
import { computeAssetDigest } from "./asset-snapshot.js";
import { exportEvidenceBundle } from "./evidence-bundle.js";
import { createEvidenceStore } from "./evidence-store.js";

const temporaryDirectories: string[] = [];
const ASSET_DIGEST = computeAssetDigest(DEFAULT_THEME, [])!;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "facet-lab-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeEvidence(runId: string, prompt: string, createdAt: string): RunEvidenceV1 {
  const tree = {
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  } as const;
  return {
    schemaVersion: 1,
    run: {
      runId,
      sessionId: "22222222-2222-4222-8222-222222222222",
      visitorId: `visitor-${runId.slice(0, 4)}`,
      generation: 1,
      status: "complete",
      createdAt,
      startedAt: createdAt,
      completedAt: createdAt,
      mode: "deterministic",
      provider: "openai",
      model: "fixture-v1",
      scenarioId: "free-form",
      prompt,
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      assetDigest: ASSET_DIGEST,
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: {
      digest: ASSET_DIGEST,
      source: "default",
      theme: DEFAULT_THEME,
      patterns: [],
    },
    initialTree: tree,
    finalTree: tree,
    records: [],
    frames: [],
    checkpoints: [],
    viewCheckpoints: [],
    providerUsage: null,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [],
  };
}

describe("atomic evidence store", () => {
  it("atomically round-trips redacted replay evidence", async () => {
    const directory = await temporaryDirectory();
    const store = createEvidenceStore({
      dataDirectory: { path: directory, source: "environment" },
      retainedRuns: 2,
    });
    const first = makeEvidence(
      "11111111-1111-4111-8111-111111111111",
      "first",
      "2026-07-19T00:00:00.000Z",
    );

    const firstSave = await store.save(first, []);
    if (!firstSave.accepted) throw new Error(firstSave.error.message);
    expect(firstSave.accepted).toBe(true);
    await Promise.all([
      store.save({ ...first, run: { ...first.run, prompt: "concurrent-first" } }, []),
      store.save({ ...first, run: { ...first.run, prompt: "concurrent-second" } }, []),
    ]);
    expect((await store.get(first.run.runId))?.run.prompt).toBe("concurrent-second");

    const rejected = await store.save({ ...first, schemaVersion: 2 }, []);
    expect(rejected.accepted).toBe(false);
    expect((await store.get(first.run.runId))?.run.prompt).toBe("concurrent-second");

    const exported = exportEvidenceBundle(first, []);
    if (!exported.ok) throw new Error(exported.error.message);
    const imported = await store.importBundle(exported.json);
    if (!imported.accepted) throw new Error(imported.error.message);
    expect(imported.accepted).toBe(true);
    expect(imported.evidence.run.importedFromRunId).toBe(first.run.runId);
    expect(imported.evidence.run.runId).not.toBe(first.run.runId);

    const beforeCorruptImport = await store.list();
    expect((await store.importBundle('{"schemaVersion":')).accepted).toBe(false);
    expect(await store.list()).toEqual(beforeCorruptImport);
    const unsupported = JSON.parse(exported.json) as Record<string, unknown>;
    unsupported.schemaVersion = 2;
    expect((await store.importBundle(JSON.stringify(unsupported))).accepted).toBe(false);
    expect(await store.list()).toEqual(beforeCorruptImport);
    expect((await store.importBundle(new Uint8Array(MAX_EVIDENCE_BUNDLE_BYTES + 1))).accepted).toBe(
      false,
    );
    expect(await store.list()).toEqual(beforeCorruptImport);

    const second = makeEvidence(
      "33333333-3333-4333-8333-333333333333",
      "second",
      "2026-07-20T00:00:00.000Z",
    );
    const third = makeEvidence(
      "44444444-4444-4444-8444-444444444444",
      "third",
      "2026-07-21T00:00:00.000Z",
    );
    await store.save(second, []);
    await store.save(third, []);
    const retained = await store.list();
    expect(retained).toHaveLength(2);
    expect(retained.map(({ run }) => run.runId)).toEqual([third.run.runId, second.run.runId]);

    const files = await readdir(join(directory, "runs"));
    expect(files.every((file) => file.endsWith(".json"))).toBe(true);
    expect(files.some((file) => file.includes(".tmp-"))).toBe(false);
  });
});
