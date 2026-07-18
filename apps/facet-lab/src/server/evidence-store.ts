import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_RETAINED_RUNS,
  MAX_EVIDENCE_BUNDLE_BYTES,
  MAX_RETAINED_RUNS,
  MIN_RETAINED_RUNS,
  type RunEvidenceV1,
} from "../shared/run-contract.js";
import type { FacetLabDataDirectory } from "./data-directory.js";
import {
  decodeEvidenceBundle,
  exportEvidenceBundle,
  importEvidenceBundle,
  type EvidenceArtifact,
  type EvidenceBundleError,
} from "./evidence-bundle.js";

export interface EvidenceStoreOptions {
  readonly dataDirectory: FacetLabDataDirectory | string;
  readonly retainedRuns?: number;
  readonly canaries?: readonly string[];
}

export type EvidenceStoreWriteResult =
  | {
      readonly accepted: true;
      readonly evidence: RunEvidenceV1;
      readonly artifacts: readonly EvidenceArtifact[];
    }
  | { readonly accepted: false; readonly error: EvidenceBundleError };

export interface EvidenceStore {
  readonly directory: string;
  save(
    candidate: unknown,
    artifacts: readonly EvidenceArtifact[],
  ): Promise<EvidenceStoreWriteResult>;
  get(runId: string): Promise<RunEvidenceV1 | undefined>;
  getArtifact(runId: string, artifactId: string): Promise<EvidenceArtifact | undefined>;
  list(): Promise<readonly RunEvidenceV1[]>;
  exportBundle(runId: string): Promise<string | undefined>;
  importBundle(input: string | Uint8Array): Promise<EvidenceStoreWriteResult>;
}

const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function storeFailure(error: EvidenceBundleError): EvidenceStoreWriteResult {
  return { accepted: false, error };
}

function invalidStoreInput(message: string): EvidenceStoreWriteResult {
  return {
    accepted: false,
    error: { code: "invalid-evidence", message },
  };
}

function fileNameForRun(runId: string): string | undefined {
  return RUN_ID_PATTERN.test(runId) ? `${runId}.json` : undefined;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function compareNewestFirst(left: RunEvidenceV1, right: RunEvidenceV1): number {
  const byCreatedAt = right.run.createdAt.localeCompare(left.run.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : right.run.runId.localeCompare(left.run.runId);
}

/** One serialized mutation lane makes write call order equal durable commit order. */
function createMutationLane(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createEvidenceStore(options: EvidenceStoreOptions): EvidenceStore {
  const retainedRuns = options.retainedRuns ?? DEFAULT_RETAINED_RUNS;
  if (
    !Number.isSafeInteger(retainedRuns) ||
    retainedRuns < MIN_RETAINED_RUNS ||
    retainedRuns > MAX_RETAINED_RUNS
  ) {
    throw new Error(
      `Facet Lab retained runs must be between ${String(MIN_RETAINED_RUNS)} and ${String(MAX_RETAINED_RUNS)}`,
    );
  }
  const root =
    typeof options.dataDirectory === "string" ? options.dataDirectory : options.dataDirectory.path;
  const runsDirectory = join(root, "runs");
  const mutate = createMutationLane();
  const canaries = options.canaries ?? [];

  const readBundle = async (
    runId: string,
  ): Promise<ReturnType<typeof decodeEvidenceBundle> | undefined> => {
    const fileName = fileNameForRun(runId);
    if (fileName === undefined) return undefined;
    const path = join(runsDirectory, fileName);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > MAX_EVIDENCE_BUNDLE_BYTES) return undefined;
      const bytes = await readFile(path);
      const decoded = decodeEvidenceBundle(bytes, { canaries });
      return decoded.ok ? decoded : undefined;
    } catch (error: unknown) {
      if (isMissing(error)) return undefined;
      return undefined;
    }
  };

  const list = async (): Promise<readonly RunEvidenceV1[]> => {
    let fileNames: readonly string[];
    try {
      fileNames = await readdir(runsDirectory);
    } catch (error: unknown) {
      if (isMissing(error)) return [];
      throw error;
    }
    const candidates = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map((fileName) => readBundle(fileName.slice(0, -".json".length))),
    );
    return candidates
      .flatMap((candidate) => (candidate?.ok === true ? [candidate.evidence] : []))
      .sort(compareNewestFirst);
  };

  const enforceRetention = async (): Promise<void> => {
    const retained = await list();
    const stale = retained.slice(retainedRuns);
    await Promise.all(
      stale.map(({ run }) => rm(join(runsDirectory, `${run.runId}.json`), { force: true })),
    );
  };

  const save = async (
    candidate: unknown,
    artifacts: readonly EvidenceArtifact[],
  ): Promise<EvidenceStoreWriteResult> => {
    const exported = exportEvidenceBundle(candidate, artifacts, { canaries });
    if (!exported.ok) return storeFailure(exported.error);
    const fileName = fileNameForRun(exported.evidence.run.runId);
    if (fileName === undefined) return invalidStoreInput("Evidence run identity is invalid.");

    return mutate(async () => {
      const finalPath = join(runsDirectory, fileName);
      const temporaryPath = join(
        runsDirectory,
        `.${exported.evidence.run.runId}.tmp-${randomUUID()}`,
      );
      try {
        await mkdir(runsDirectory, { recursive: true, mode: 0o700 });
        const handle = await open(temporaryPath, "wx", 0o600);
        try {
          await handle.writeFile(exported.json, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, finalPath);
      } catch {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        return invalidStoreInput("Evidence could not be stored atomically.");
      }
      await enforceRetention().catch(() => undefined);
      return {
        accepted: true,
        evidence: exported.evidence,
        artifacts: exported.artifacts,
      };
    });
  };

  return {
    directory: runsDirectory,
    save,
    async get(runId) {
      const decoded = await readBundle(runId);
      return decoded?.ok === true ? decoded.evidence : undefined;
    },
    async getArtifact(runId, artifactId) {
      const decoded = await readBundle(runId);
      if (decoded?.ok !== true) return undefined;
      const artifact = decoded.artifacts.find(({ id }) => id === artifactId);
      return artifact === undefined
        ? undefined
        : { id: artifact.id, data: new Uint8Array(artifact.data) };
    },
    list,
    async exportBundle(runId) {
      const decoded = await readBundle(runId);
      if (decoded?.ok !== true) return undefined;
      const exported = exportEvidenceBundle(decoded.evidence, decoded.artifacts, { canaries });
      return exported.ok ? exported.json : undefined;
    },
    async importBundle(input) {
      const imported = importEvidenceBundle(input, { canaries });
      if (!imported.ok) return storeFailure(imported.error);
      return save(imported.evidence, imported.artifacts);
    },
  };
}
