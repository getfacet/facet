/**
 * /live-test Tier 2/3 (spec Decision 7, DC-004 + DC-009) — one REAL provider
 * turn per available key: boot `startQuickstart` with the reference
 * `createQuickstartAgent`, post a visit, and wait for a patch frame.
 *
 * LOOSE assertions only, by design: LLM output is nondeterministic, so the
 * test pins the machinery (a patch arrives, its tree passes `validateTree`,
 * the root is renderable, nothing crashes) and NEVER matches content.
 *
 * Key gating (DC-009):
 * - default: each provider's describe is skipped unless its key env var is set
 *   (the /live-test skill turns that skip into a FAIL when the diff touches
 *   packages/agent-stack/quickstart/ — SKIPPED = FAIL is a skill-level rule);
 * - `FACET_SMOKE_PROVIDERS=both` (Tier 3): a missing key is an explicit test
 *   FAILURE, not a skip — pre-merge must exercise both adapters.
 */
import { describe, expect, it } from "vitest";
import { validateTree } from "@facet/core";
import { createQuickstartAgent, resolveProvider } from "@facet/reference-agent";
import { MemorySink } from "@facet/runtime";
import { startQuickstart, type RunningQuickstart } from "../src/index.js";

const REQUIRE_BOTH = process.env["FACET_SMOKE_PROVIDERS"] === "both";

interface ProviderCase {
  readonly name: "openai" | "anthropic";
  readonly envVar: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
}

const PROVIDERS: readonly ProviderCase[] = [
  { name: "openai", envVar: "OPENAI_API_KEY" },
  { name: "anthropic", envVar: "ANTHROPIC_API_KEY" },
];

/** Parse a `\n\n`-delimited SSE block's `data:` line (adapted from
 * server.test.ts — no cross-package test imports). */
function parseData(block: string): unknown | undefined {
  for (const line of block.split("\n")) {
    if (line.startsWith("data: ")) return JSON.parse(line.slice(6));
  }
  return undefined;
}

/** Read the stream until a `patch` frame arrives (the config's testTimeout
 * bounds the wait), returning that frame's data. */
async function waitForPatch(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before a patch frame arrived");
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const data = parseData(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        if ((data as { kind?: string } | undefined)?.kind === "patch") return data;
      }
    }
  } finally {
    await reader.cancel();
  }
}

/** Boot on a random free port, retrying on collisions. */
async function boot(providerName: "openai" | "anthropic"): Promise<RunningQuickstart> {
  const provider = resolveProvider({ provider: providerName }, process.env);
  if (provider === null) throw new Error(`no provider resolved for ${providerName}`);
  const sink = new MemorySink();
  const agentId = `quickstart-smoke-${providerName}`;
  const agent = createQuickstartAgent({ provider, sink, agentId });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      return await startQuickstart({ port, agentId, agent, sink });
    } catch {
      // EADDRINUSE — try another port
    }
  }
  throw new Error("could not boot startQuickstart on a free port");
}

for (const { name, envVar } of PROVIDERS) {
  const key = process.env[envVar];
  const keyPresent = key !== undefined && key !== "";

  describe(`quickstart smoke — ${name}`, () => {
    if (!keyPresent) {
      if (REQUIRE_BOTH) {
        // Tier 3: both providers are REQUIRED — a missing key is a failure.
        it(`FAILS: FACET_SMOKE_PROVIDERS=both requires ${envVar}`, () => {
          throw new Error(
            `FACET_SMOKE_PROVIDERS=both demands a real turn against ${name}, ` +
              `but ${envVar} is not set — set it or drop the Tier-3 request.`,
          );
        });
      } else {
        // Tier 2 default: skip without the key. Whether a skip is acceptable
        // is the /live-test skill's call (SKIPPED = FAIL for quickstart-
        // touching diffs).
        it.skip(`skipped: ${envVar} not set`, () => {
          // unreachable
        });
      }
      return;
    }

    it(`one real visit turn yields a valid, renderable tree (${name})`, async () => {
      const running = await boot(name);
      try {
        const visitorId = `smoke-${name}`;
        const stream = await fetch(`${running.url}/stream?visitorId=${visitorId}`);
        expect(stream.status).toBe(200);
        const post = await fetch(`${running.url}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitor: { visitorId },
            event: { kind: "visit", visitor: { visitorId } },
          }),
        });
        expect(post.status).toBe(202);

        // Loose: a patch frame arrives within the config timeout…
        const patch = (await waitForPatch(stream)) as {
          patches?: readonly { path?: string; value?: unknown }[];
        };
        expect(Array.isArray(patch.patches)).toBe(true);

        // …and when it is the full-replace snapshot (the empty-stage render
        // path), its tree validates and has a renderable root. Any other patch
        // shape still counts — content/shape beyond validity is never pinned.
        const full = patch.patches?.find((p) => p.path === "");
        if (full !== undefined) {
          // validateTree is fail-safe (never throws); "passes" here means the
          // survivor is renderable — a root box with at least one child, i.e.
          // not the EMPTY_TREE fallback. Issues are tolerated (loose).
          const { tree } = validateTree(full.value);
          const root = tree.nodes[tree.root];
          expect(root).toBeDefined();
          expect(root?.type).toBe("box");
          expect(root?.type === "box" && root.children.length > 0).toBe(true);
        }
      } finally {
        await running.close();
      }
    });
  });
}
