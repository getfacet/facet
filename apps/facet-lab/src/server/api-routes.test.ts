import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_JSON_REQUEST_BYTES, type RunEvidenceV1 } from "../shared/run-contract.js";
import { DETERMINISTIC_MODEL } from "./deterministic-provider.js";
import { startFacetLab } from "./main.js";
import { createLabApiRoutes, type LabApiBackend, type LabApiRequest } from "./api-routes.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const IMPORTED_RUN_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "sk-secret-canary-value";
const UUID_PATTERN = /^[0-9a-f-]{36}$/iu;

function evidence(status: RunEvidenceV1["run"]["status"] = "complete"): RunEvidenceV1 {
  return {
    schemaVersion: 1,
    run: {
      runId: RUN_ID,
      sessionId: "33333333-3333-4333-8333-333333333333",
      visitorId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      status,
      mode: "deterministic",
      provider: "openai",
      model: "deterministic-fixture",
      scenarioId: "landing-marketing",
      prompt: "Build a page",
      constraint: null,
      viewport: "desktop",
      colorMode: "light",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      assetDigest: "sha256:assets",
      assetSource: "default",
      importedFromRunId: null,
    },
    assets: { digest: "sha256:assets", source: "default", theme: {} as never, patterns: [] },
    initialTree: { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } },
    finalTree: null,
    records: [
      {
        kind: "status",
        runId: RUN_ID,
        turnId: null,
        generation: 1,
        ordinal: 4,
        timestamp: "2026-01-01T00:00:01.000Z",
        source: "lab",
        truncated: false,
        overflow: false,
        data: { status: "complete" },
      },
    ],
    frames: [],
    checkpoints: [],
    viewCheckpoints: [],
    providerUsage: null,
    warnings: [],
    checks: [],
    visualEvaluations: [],
    artifacts: [
      {
        id: "shot-1",
        kind: "screenshot",
        mediaType: "image/png",
        bytes: 3,
        digest: "sha256:image",
        capture: { viewport: "desktop", colorMode: "light", stageVersion: 1, ordinal: 4 },
      },
    ],
  };
}

function fakeBackend(): LabApiBackend & { readonly calls: string[] } {
  const calls: string[] = [];
  const current = evidence();
  return {
    calls,
    getCatalog: () => ({ categories: [], assetDigest: "sha256:assets" }),
    getCapabilities: () => ({
      deterministic: true,
      providers: { openai: { available: true, models: ["allowed"] } },
      dataDirectory: "Facet Lab",
    }),
    getAssets: () => ({ source: "default", digest: "sha256:assets" }),
    selectDefaultAssets: () => ({ source: "default", digest: "sha256:assets" }),
    importAssets: () => ({ source: "custom", digest: "sha256:custom" }),
    createRun: (configuration) => {
      calls.push(`create:${configuration.scenarioId}`);
      return {
        runId: RUN_ID,
        sessionId: current.run.sessionId,
        visitorId: current.run.visitorId,
        generation: 1,
        status: "queued",
        streamUrl: `/stream?visitorId=${current.run.visitorId}`,
        evidenceUrl: `/api/runs/${RUN_ID}/evidence`,
      };
    },
    listRuns: () => [current],
    getRun: (runId) => (runId === RUN_ID ? current : undefined),
    cancelRun: (runId) => ({ found: runId === RUN_ID, changed: true }),
    exportRun: (runId) => (runId === RUN_ID ? '{"redacted":true}' : undefined),
    importRun: () => ({ runId: IMPORTED_RUN_ID, importedFromRunId: RUN_ID }),
    evaluateRun: () => ({ accepted: true, version: 1 }),
    captureRun: () => ({ accepted: true, conditions: 6 }),
    getArtifact: (runId, artifactId) =>
      runId !== RUN_ID
        ? undefined
        : artifactId === "shot-1"
          ? { mediaType: "image/png", data: new Uint8Array([1, 2, 3]), downloadName: "shot-1.png" }
          : artifactId === "unsafe-name"
            ? {
                mediaType: "image/png",
                data: new Uint8Array([1, 2, 3]),
                downloadName: 'shot.png"\r\nx-injected: yes',
              }
            : undefined,
    readEvidence: (runId) => (runId === RUN_ID ? current : undefined),
  };
}

async function request(
  routes: ReturnType<typeof createLabApiRoutes>,
  method: string,
  target: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
) {
  const input: LabApiRequest = {
    method,
    target,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  return routes.handle(input);
}

async function streamText(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object" || !(Symbol.asyncIterator in body)) return "";
  let output = "";
  for await (const chunk of body as AsyncIterable<string>) output += chunk;
  return output;
}

describe("Lab API routes", () => {
  it("serves the complete bounded Lab API without exposing secrets", async () => {
    const backend = fakeBackend();
    const routes = createLabApiRoutes({ backend, heartbeatMs: 1 });

    const cases: readonly [string, string, unknown?, number?][] = [
      ["GET", "/api/catalog"],
      ["GET", "/api/capabilities"],
      ["GET", "/api/assets"],
      ["POST", "/api/assets/default", {}],
      ["POST", "/api/assets/import", { schemaVersion: 1, theme: {}, patterns: [] }],
      [
        "POST",
        "/api/runs",
        {
          mode: "deterministic",
          provider: "openai",
          model: "deterministic-fixture",
          scenarioId: "landing-marketing",
          prompt: "Build a page",
          constraint: null,
          viewport: "desktop",
          colorMode: "light",
        },
        201,
      ],
      ["GET", "/api/runs?limit=20&status=complete"],
      ["GET", `/api/runs/${RUN_ID}`],
      ["POST", `/api/runs/${RUN_ID}/cancel`, {}],
      ["GET", `/api/runs/${RUN_ID}/export`],
      ["POST", "/api/runs/import", { bundle: "{}" }, 201],
      ["POST", `/api/runs/${RUN_ID}/evaluations`, { kind: "recalculate" }],
      ["POST", `/api/runs/${RUN_ID}/captures`, {}],
      ["GET", `/api/runs/${RUN_ID}/artifacts/shot-1`],
    ];

    for (const [method, target, body, expectedStatus = 200] of cases) {
      const response = await request(routes, method, target, body);
      expect(response.status, `${method} ${target}`).toBe(expectedStatus);
      expect(JSON.stringify(response)).not.toContain(SECRET);
    }

    const stream = await request(routes, "GET", `/api/runs/${RUN_ID}/evidence?after=3`, undefined, {
      authorization: `Bearer ${SECRET}`,
      cookie: SECRET,
      "last-event-id": "3",
    });
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    const sse = await streamText(stream.body);
    expect(sse).toContain("id: 4");
    expect(sse).toContain("event: heartbeat");
    expect(sse).toContain("event: terminal");
    expect(sse).not.toContain(SECRET);

    for (const [method, target, body] of [
      ["POST", "/api/assets/default", { unknown: SECRET }],
      ["POST", "/api/runs", { prompt: SECRET }],
      ["POST", `/api/runs/${RUN_ID}/cancel`, { unknown: true }],
      ["POST", `/api/runs/${RUN_ID}/evaluations`, { kind: "execute", code: SECRET }],
      ["POST", `/api/runs/${RUN_ID}/captures`, { viewport: "raw" }],
    ] as const) {
      const rejected = await request(routes, method, target, body);
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected)).not.toContain(SECRET);
    }

    expect((await request(routes, "GET", "/api/runs/not-a-uuid")).status).toBe(400);
    expect((await request(routes, "GET", `/api/runs/${RUN_ID}/artifacts/..%2Fsecret`)).status).toBe(
      400,
    );
    expect((await request(routes, "DELETE", `/api/runs/${RUN_ID}`)).status).toBe(405);
    expect((await request(routes, "GET", "/api/unknown")).status).toBe(404);
    expect((await request(routes, "GET", "/api/catalog?secret=x")).status).toBe(400);
    expect((await request(routes, "POST", `/api/runs/${RUN_ID}/cancel?x=1`, {})).status).toBe(400);
    expect(
      (
        await request(routes, "POST", `/api/runs/${RUN_ID}/evaluations?x=1`, {
          kind: "recalculate",
        })
      ).status,
    ).toBe(400);
    expect((await request(routes, "POST", `/api/runs/${RUN_ID}/captures?x=1`, {})).status).toBe(
      400,
    );
    const unsafeDownload = await request(
      routes,
      "GET",
      `/api/runs/${RUN_ID}/artifacts/unsafe-name`,
    );
    expect(unsafeDownload.status).toBe(200);
    expect(unsafeDownload.headers["content-disposition"]).toBe("attachment");
    expect(JSON.stringify(unsafeDownload.headers)).not.toContain("x-injected");

    const malformed: LabApiRequest = {
      method: "POST",
      target: "/api/assets/default",
      headers: { authorization: SECRET },
      body: "{",
    };
    const malformedResponse = await routes.handle(malformed);
    expect(malformedResponse.status).toBe(400);
    expect(JSON.stringify(malformedResponse)).not.toContain(SECRET);
  });

  it("starts one loopback origin for API, static UI, and registered live runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "facet-lab-api-integration-"));
    const staticRoot = join(root, "static");
    const dataDirectory = join(root, "data");
    await mkdir(staticRoot);
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Facet Lab</title>");
    const running = await startFacetLab({
      port: 0,
      staticRoot,
      dataDirectory,
      environment: {
        OPENAI_API_KEY: SECRET,
        FACET_LAB_OPENAI_MODELS: "allowed",
      },
    });
    try {
      const page = await fetch(running.url);
      expect(page.status).toBe(200);

      const capabilities = await (await fetch(`${running.url}/api/capabilities`)).json();
      expect(capabilities).toMatchObject({ deterministic: { available: true } });
      expect(JSON.stringify(capabilities)).not.toContain(SECRET);

      const createdResponse = await fetch(`${running.url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "deterministic",
          provider: "openai",
          model: DETERMINISTIC_MODEL,
          scenarioId: "landing-marketing",
          prompt: "Build the integration run",
          constraint: null,
          viewport: "desktop",
          colorMode: "light",
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as {
        readonly runId: string;
        readonly visitorId: string;
      };
      expect(created.runId).toMatch(UUID_PATTERN);

      const evidence = await fetch(`${running.url}/api/runs/${created.runId}`);
      expect(evidence.status).toBe(200);
      expect(JSON.stringify(await evidence.json())).not.toContain(SECRET);

      const cancelled = await fetch(`${running.url}/api/runs/${created.runId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(cancelled.status).toBe(200);
      expect((await fetch(`${running.url}/stream?visitorId=${created.visitorId}`)).status).toBe(
        403,
      );

      const freeFormResponse = await fetch(`${running.url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "deterministic",
          provider: "openai",
          model: DETERMINISTIC_MODEL,
          scenarioId: "free-form",
          prompt: "Create a free-form page",
          constraint: null,
          viewport: "mobile",
          colorMode: "dark",
        }),
      });
      expect(freeFormResponse.status).toBe(201);
      const freeForm = (await freeFormResponse.json()) as { readonly runId: string };
      const freeFormCancel = await fetch(`${running.url}/api/runs/${freeForm.runId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(freeFormCancel.status).toBe(200);

      expect(
        (
          await fetch(`${running.url}/api/catalog`, {
            headers: { origin: "https://evil.example" },
          })
        ).status,
      ).toBe(403);

      const largeValue = "x".repeat(MAX_JSON_REQUEST_BYTES + 1);
      const boundedOrdinary = await fetch(`${running.url}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: largeValue }),
      });
      expect(boundedOrdinary.status).toBe(413);

      const boundedImport = await fetch(`${running.url}/api/assets/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, theme: { name: largeValue }, patterns: [] }),
      });
      expect(boundedImport.status).toBe(200);
      expect(await boundedImport.json()).toMatchObject({ accepted: false });
    } finally {
      await running.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
