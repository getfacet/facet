import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bridge } from "./bridge.js";
import type { ClientEvent, FacetAgent, FacetSession } from "@facet/core";

/**
 * These tests exercise the SPAWN driver's cross-visitor concurrency cap against a
 * STUB brain (a tiny Node script) instead of a real `claude`/`codex` CLI. We
 * mock `@facet/agent-client` so `createBridge` never dials a Facet server: the
 * mock just captures the `agent` function the bridge hands it, which the test
 * then invokes directly for a batch of concurrent visitors. Each stub brain
 * records its start/end wall-clock times (and its arrival in a shared log) into a
 * temp dir, so the test can measure the real overlap the cap allowed.
 */

const hoisted = vi.hoisted(() => ({ agent: undefined as FacetAgent | undefined }));

vi.mock("@facet/agent-client", () => ({
  connectAgent: (opts: { agent: FacetAgent }) => {
    hoisted.agent = opts.agent;
    return { close: (): void => {} };
  },
}));

// Import AFTER vi.mock so the bridge binds to the stubbed transport.
const { createBridge } = await import("./bridge.js");

let bridgePortSeq = 5410;
const openBridges: Bridge[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const b of openBridges) b.close();
  openBridges.length = 0;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
  hoisted.agent = undefined;
});

/**
 * Write a stub brain: a Node CommonJS script that appends its FACET_EVENT token
 * to `starts.log` the instant it runs (arrival order), then behaves by token:
 * - `failTokens`: exit non-zero immediately (no json).
 * - `hangTokens`: spawn a DETACHED grandchild that inherits our stdout/stderr and
 *   outlives a SIGKILL — it holds the pipe open, so the bridge's `close` can't
 *   fire and the ONLY thing that settles this turn is the timeout's `finish()`.
 *   Then hang far past any `brainTimeoutMs`, waiting to be killed.
 * - otherwise: sleep `sleepMs` and write `<token>.json` with {start,end}.
 */
function writeStub(
  dir: string,
  sleepMs: number,
  opts: { failTokens?: readonly string[]; hangTokens?: readonly string[] } = {},
): string {
  const script = `
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const dir = ${JSON.stringify(dir)};
const failTokens = ${JSON.stringify([...(opts.failTokens ?? [])])};
const hangTokens = ${JSON.stringify([...(opts.hangTokens ?? [])])};
const token = process.env.FACET_EVENT ?? "?";
const start = Date.now();
fs.appendFileSync(path.join(dir, "starts.log"), token + "\\n");
if (failTokens.includes(token)) {
  process.exit(1);
} else if (hangTokens.includes(token)) {
  cp.spawn(process.execPath, ["-e", "setTimeout(function(){}, 4000)"], {
    stdio: "inherit",
    detached: true,
  }).unref();
  setTimeout(() => {}, 30000); // hang until the bridge SIGKILLs us
} else {
  setTimeout(() => {
    const end = Date.now();
    fs.writeFileSync(path.join(dir, token + ".json"), JSON.stringify({ token, start, end }));
    process.exit(0);
  }, ${String(sleepMs)});
}
`;
  const scriptPath = join(dir, "brain.cjs");
  writeFileSync(scriptPath, script);
  return scriptPath;
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "facet-spawn-"));
  tempDirs.push(dir);
  return dir;
}

function spawnBridge(opts: {
  dir: string;
  sleepMs: number;
  maxConcurrent?: number;
  brainTimeoutMs?: number;
  failTokens?: readonly string[];
  hangTokens?: readonly string[];
}): FacetAgent {
  const scriptPath = writeStub(opts.dir, opts.sleepMs, {
    ...(opts.failTokens !== undefined ? { failTokens: opts.failTokens } : {}),
    ...(opts.hangTokens !== undefined ? { hangTokens: opts.hangTokens } : {}),
  });
  const bridge = createBridge({
    mode: "spawn",
    method: "oneshot", // no --resume session-id parsing; irrelevant to the cap
    command: process.execPath,
    commandArgs: [scriptPath],
    bridgePort: (bridgePortSeq += 1),
    ...(opts.maxConcurrent !== undefined ? { maxConcurrent: opts.maxConcurrent } : {}),
    ...(opts.brainTimeoutMs !== undefined ? { brainTimeoutMs: opts.brainTimeoutMs } : {}),
  } as Parameters<typeof createBridge>[0]);
  openBridges.push(bridge);
  return hoisted.agent!;
}

const visit = (visitorId: string): ClientEvent => ({ kind: "visit", visitor: { visitorId } });
const message = (visitorId: string, text: string): [ClientEvent, FacetSession] => [
  { kind: "message", text },
  sessionFor(visitorId),
];

function sessionFor(visitorId: string): FacetSession {
  return {
    agentId: "live",
    visitor: { visitorId },
    stage: { root: "root", nodes: { root: { id: "root", type: "box", children: [] } } },
  };
}

interface Span {
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

function readSpan(dir: string, token: string): Span {
  return JSON.parse(readFileSync(join(dir, `${token}.json`), "utf8")) as Span;
}

function readStarts(dir: string): string[] {
  return readFileSync(join(dir, "starts.log"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

/** Max number of spans overlapping at any instant (end-before-start at ties). */
function maxOverlap(spans: readonly Span[]): number {
  const points = spans.flatMap((s) => [
    { t: s.start, delta: 1 },
    { t: s.end, delta: -1 },
  ]);
  points.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let active = 0;
  let max = 0;
  for (const p of points) {
    active += p.delta;
    max = Math.max(max, active);
  }
  return max;
}

describe("createSpawnAgent concurrency cap", () => {
  it("never runs more than maxConcurrent brains at once", async () => {
    const dir = makeTempDir();
    const agent = spawnBridge({ dir, sleepMs: 100, maxConcurrent: 2 });

    // Five distinct visitors arrive together; each would otherwise spawn its own
    // brain immediately (per-visitor serialization only orders a SINGLE visitor).
    const runs = Array.from({ length: 5 }, (_, i) =>
      Promise.resolve(agent(visit(`v${String(i)}`), sessionFor(`v${String(i)}`))),
    );
    await Promise.all(runs);

    // Token N is assigned to visitor N-1 (FIFO admission), so all five completed.
    const spans = [1, 2, 3, 4, 5].map((n) => readSpan(dir, String(n)));
    expect(spans).toHaveLength(5);
    expect(maxOverlap(spans)).toBeLessThanOrEqual(2);

    // FIFO under the cap: no later arrival jumps ahead of the 2-wide window.
    const starts = readStarts(dir);
    expect(new Set(starts.slice(0, 2))).toEqual(new Set(["1", "2"]));
    expect(new Set(starts.slice(0, 4))).toEqual(new Set(["1", "2", "3", "4"]));
    expect(new Set(starts)).toEqual(new Set(["1", "2", "3", "4", "5"]));
  }, 15000);

  it("keeps a single visitor's events ordered under the cap", async () => {
    const dir = makeTempDir();
    const agent = spawnBridge({ dir, sleepMs: 80, maxConcurrent: 2 });

    // Two events for the SAME visitor: the per-visitor serial queue must run them
    // one-at-a-time even though the cap has spare slots.
    const [first] = message("v0", "one");
    const [second] = message("v0", "two");
    await Promise.all([
      Promise.resolve(agent(first, sessionFor("v0"))),
      Promise.resolve(agent(second, sessionFor("v0"))),
    ]);

    const a = readSpan(dir, "1");
    const b = readSpan(dir, "2");
    expect(a.end).toBeLessThanOrEqual(b.start); // no overlap → no reorder
  }, 15000);

  it("frees a slot when a brain exits non-zero so the next queued turn runs", async () => {
    const dir = makeTempDir();
    // Cap of 1 and the first brain (token "1") exits non-zero: the second visitor
    // can only run if the crashed brain's slot was released.
    const agent = spawnBridge({ dir, sleepMs: 60, maxConcurrent: 1, failTokens: ["1"] });

    await Promise.all([
      Promise.resolve(agent(visit("v0"), sessionFor("v0"))),
      Promise.resolve(agent(visit("v1"), sessionFor("v1"))),
    ]);

    expect(existsSync(join(dir, "1.json"))).toBe(false); // crashed before writing
    expect(existsSync(join(dir, "2.json"))).toBe(true); // next queued turn ran
  }, 15000);

  it("frees a slot promptly when a brain times out, even if `close` never fires", async () => {
    const dir = makeTempDir();
    // Cap 1; the first brain (token "1") hangs AND leaks a stdio-inheriting
    // grandchild, so the child's `close` event is withheld for seconds. Only the
    // timeout callback settling `runOne` can free the slot for the second visitor.
    const agent = spawnBridge({
      dir,
      sleepMs: 30,
      maxConcurrent: 1,
      brainTimeoutMs: 250,
      hangTokens: ["1"],
    });

    const t0 = Date.now();
    await Promise.all([
      Promise.resolve(agent(visit("v0"), sessionFor("v0"))),
      Promise.resolve(agent(visit("v1"), sessionFor("v1"))),
    ]);
    const elapsed = Date.now() - t0;

    // With the fix the queued turn runs ~right after the 250ms timeout. Without
    // it, the leaked pipe delays `close` (the grandchild lives 4s), so this would
    // not complete until then — the 2000ms bound is the regression guard.
    expect(existsSync(join(dir, "2.json"))).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  }, 15000);
});
