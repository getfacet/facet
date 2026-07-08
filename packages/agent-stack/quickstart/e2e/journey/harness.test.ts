/**
 * WU-2 (Decision B) — the journey harness: shared server boot/teardown +
 * provider-keyed bin smoke. Runs ONLY under the e2e vitest config
 * (the root glob never touches `e2e/`).
 *
 * DC-005 (bin result reported): `runBinSmoke()` RUNS the built bin and REPORTS a
 * `{ ok, detail }` result — the assertion is that it reports a result with a
 * boolean `ok`, a non-empty `detail`, and captured stderr, NOT that `ok===true`.
 * In the dev monorepo the documented `@facet/* → src/*.ts` resolution gap makes
 * `ok:false` with the error in `detail`; the recorded owner-run tier is where a
 * published bundle would be green. Needs `pnpm --filter @facet/quickstart build`
 * first (spawns the built `dist/cli.js`).
 *
 * DC-006 (no-orphan teardown): every `bootJourney` is paired with `.close()` in
 * a `finally`; after `close()` the bound port is free again (a raw listener
 * binds it), proving no orphaned server keeps the port.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createStubAgent } from "@facet/reference-agent";
import { bootJourney, resolveJourneyProvider, runBinSmoke } from "./harness.js";

/** Occupy a loopback port so a boot attempt on it collides (EADDRINUSE). */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    release: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error !== undefined ? reject(error) : resolve())),
      ),
  };
}

/** True if a raw server can bind `port` — i.e. nothing is listening there. */
async function portIsFree(port: number): Promise<boolean> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return true;
  } catch {
    return false;
  }
}

describe("journey harness", () => {
  const releasers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const release of releasers.splice(0)) await release().catch(() => {});
  });

  it("journey harness imports provider from reference-agent", () => {
    const source = readFileSync(new URL("./harness.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@facet/reference-agent"');
    expect(source).not.toMatch(
      /import\s*\{[^}]*resolveProvider[^}]*\}\s*from "\.\.\/\.\.\/src\/index\.js"/s,
    );
  });

  it("bin smoke runs the provider-backed cli and reports a result", async () => {
    const result = await runBinSmoke();
    // DC-005: RUNS + REPORTS a result — NOT ok===true (dev-monorepo resolution
    // gap is expected ok:false with the error surfaced in detail/stderr).
    expect(typeof result.ok).toBe("boolean");
    expect(result.detail).toBeTruthy();
    expect(typeof result.stderr).toBe("string"); // stderr captured
  });

  it("bootJourney(...).close() frees the port", async () => {
    const running = await bootJourney({ agent: createStubAgent(), agentId: "journey-test" });
    let port: number;
    try {
      port = Number(new URL(running.url).port);
      const health = await fetch(`${running.url}/health`);
      expect(health.status).toBe(200);
    } finally {
      await running.close();
    }
    // DC-006 no-orphan: the port is free again once closed.
    expect(await portIsFree(port)).toBe(true);
  });

  it("boot retries on a port collision (EADDRINUSE) and still comes up", async () => {
    const occupied = await occupyPort();
    releasers.push(occupied.release);
    // First candidate is the occupied port (⇒ EADDRINUSE); the harness must
    // retry and still come up.
    const running = await bootJourney({
      agent: createStubAgent(),
      agentId: "journey-retry",
      candidatePorts: [occupied.port, occupied.port, occupied.port],
    });
    try {
      expect(Number(new URL(running.url).port)).not.toBe(occupied.port);
      const health = await fetch(`${running.url}/health`);
      expect(health.status).toBe(200);
    } finally {
      await running.close();
    }
  });

  it("resolveJourneyProvider(env) returns null with no keys", () => {
    expect(resolveJourneyProvider({})).toBeNull();
  });
});
