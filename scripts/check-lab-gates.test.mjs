import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { planLabGate, runLabGate } from "./check-lab-gates.mjs";

test("fails closed for deterministic and required-key Lab tiers", () => {
  const root = mkdtempSync(join(tmpdir(), "facet-lab-gate-test-"));
  const environment = { FACET_LAB_GATE_ROOT: root };
  const calls = [];
  const deterministic = runLabGate({
    mode: "deterministic",
    environment,
    execute(command, options) {
      calls.push({ command, options });
      return 9;
    },
  });
  assert.equal(deterministic.verdict, "FAIL");
  assert.equal(deterministic.reason, "command-failed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].command, ["pnpm", "--filter", "@facet/lab", "test:e2e:deterministic"]);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(calls[0].options.env.ANTHROPIC_API_KEY, undefined);
  assert.notEqual(
    calls[0].options.env.FACET_LAB_DATA_DIR,
    calls[0].options.env.FACET_LAB_ARTIFACTS_DIR,
  );
  assert.ok(calls[0].options.env.FACET_LAB_DATA_DIR.startsWith(root));
  assert.ok(calls[0].options.env.FACET_LAB_ARTIFACTS_DIR.startsWith(root));

  const required = runLabGate({ mode: "required-provider", environment });
  assert.equal(required.verdict, "FAIL");
  assert.equal(required.reason, "required-provider-key-missing");
  assert.equal(calls.length, 1, "a missing required key must fail before spawning a test");

  const present = runLabGate({
    mode: "required-provider",
    environment: { ...environment, OPENAI_API_KEY: "present-for-test" },
    execute(_command, options) {
      assert.equal(options.env.FACET_LAB_LIVE_REQUIRED, "1");
      return 0;
    },
  });
  assert.equal(present.verdict, "PASS");
});

test("keeps an absent optional visual key as an explicit non-blocking skip", () => {
  const plan = planLabGate("optional-visual", {});
  assert.equal(plan.disposition, "skip");
  assert.equal(plan.reason, "optional-visual-key-missing");
  const result = runLabGate({ mode: "optional-visual", environment: {} });
  assert.equal(result.verdict, "SKIP");

  const capturedWithoutJudge = runLabGate({
    mode: "optional-visual",
    environment: { OPENAI_API_KEY: "present-for-test" },
    execute() {
      return 0;
    },
  });
  assert.equal(capturedWithoutJudge.verdict, "SKIP");
  assert.equal(capturedWithoutJudge.reason, "visual-judge-unavailable");
});
