import { describe, expect, it } from "vitest";

import {
  CHARS_PER_TOKEN_DEFAULT,
  CHARS_PER_TOKEN_MAX,
  CHARS_PER_TOKEN_MIN,
  createTokenEstimator,
  estimateTurnChars,
} from "./estimate.js";
import type { ToolSpec, TurnMessage } from "../provider.js";

const TOOL_A: ToolSpec = {
  name: "say",
  description: "Say a chat line to the visitor.",
  parameters: { type: "object", properties: { text: { type: "string" } } },
};

const TOOL_B: ToolSpec = {
  name: "append_node",
  description: "Append a node to the stage tree.",
  parameters: { type: "object", properties: { parentId: { type: "string" } } },
};

describe("createTokenEstimator", () => {
  it("estimates tokens at the default calibration (ceil, >= 0)", () => {
    const estimator = createTokenEstimator();
    expect(estimator.charsPerToken()).toBe(CHARS_PER_TOKEN_DEFAULT);
    // 10 chars / 4 chars-per-token = 2.5 -> ceil 3
    expect(estimator.estimateTokens(10)).toBe(3);
    expect(estimator.estimateTokens(0)).toBe(0);
    expect(estimator.estimateTokens(-5)).toBe(0);
    expect(estimator.estimateTokens(Number.NaN)).toBe(0);
    expect(estimator.estimateTokens(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("honors a provided initial chars-per-token, clamped into range", () => {
    expect(createTokenEstimator(3).charsPerToken()).toBe(3);
    expect(createTokenEstimator(0.1).charsPerToken()).toBe(CHARS_PER_TOKEN_MIN);
    expect(createTokenEstimator(1000).charsPerToken()).toBe(CHARS_PER_TOKEN_MAX);
    // invalid initial falls back to default
    expect(createTokenEstimator(Number.NaN).charsPerToken()).toBe(CHARS_PER_TOKEN_DEFAULT);
  });

  it("converges toward the observed chars/token ratio over multiple observations", () => {
    const estimator = createTokenEstimator();
    const before = estimator.charsPerToken();
    expect(before).toBe(4);
    // Observed ratio is 3 chars/token (3000 chars -> 1000 input tokens).
    estimator.calibrate(3000, 1000);
    const afterOne = estimator.charsPerToken();
    // First observation nudges below the default toward 3, but not all the way.
    expect(afterOne).toBeLessThan(before);
    expect(afterOne).toBeGreaterThan(3);
    for (let i = 0; i < 30; i += 1) estimator.calibrate(3000, 1000);
    const afterMany = estimator.charsPerToken();
    expect(afterMany).toBeCloseTo(3, 1);
    expect(afterMany).toBeLessThan(afterOne);
  });

  it("clamps calibration to the [1.5, 6] range", () => {
    // Each sample is clamped into the band before it accumulates, so a stream
    // of out-of-band ratios converges to (but never crosses) the clamp edge —
    // it stays within the band rather than overshooting.
    const high = createTokenEstimator();
    for (let i = 0; i < 50; i += 1) high.calibrate(1000, 10); // ratio 100
    expect(high.charsPerToken()).toBeLessThanOrEqual(CHARS_PER_TOKEN_MAX);
    expect(high.charsPerToken()).toBeCloseTo(CHARS_PER_TOKEN_MAX, 1);

    const low = createTokenEstimator();
    for (let i = 0; i < 50; i += 1) low.calibrate(100, 1000); // ratio 0.1
    expect(low.charsPerToken()).toBeGreaterThanOrEqual(CHARS_PER_TOKEN_MIN);
    expect(low.charsPerToken()).toBeCloseTo(CHARS_PER_TOKEN_MIN, 1);
  });

  it("clamps each sample so one anomalous provider report cannot pin the mean", () => {
    const estimator = createTokenEstimator();
    // Wildly inflated samples — the exact failure mode of an under-counted
    // cached prefix: 60000 observed chars against only 100 reported tokens
    // (ratio 600). Without a per-sample clamp these would dominate the sum and
    // pin the mean at the upper clamp edge indefinitely.
    for (let i = 0; i < 5; i += 1) estimator.calibrate(60000, 100);
    expect(estimator.charsPerToken()).toBeLessThanOrEqual(CHARS_PER_TOKEN_MAX);

    // A handful of NORMAL samples (ratio 3) now pull the mean back inside the
    // band — only possible because the inflated samples were clamped to the
    // band edge per-sample rather than summed raw.
    for (let i = 0; i < 5; i += 1) estimator.calibrate(3000, 1000);
    const after = estimator.charsPerToken();
    expect(after).toBeLessThan(CHARS_PER_TOKEN_MAX);
    expect(after).toBeGreaterThanOrEqual(CHARS_PER_TOKEN_MIN);
  });

  it("ignores invalid usage observations (estimate-only calibration)", () => {
    const estimator = createTokenEstimator();
    const baseline = estimator.charsPerToken();
    estimator.calibrate(3000, undefined);
    estimator.calibrate(3000, 0);
    estimator.calibrate(3000, -10);
    estimator.calibrate(3000, Number.NaN);
    estimator.calibrate(0, 1000);
    estimator.calibrate(-5, 1000);
    estimator.calibrate(Number.POSITIVE_INFINITY, 1000);
    expect(estimator.charsPerToken()).toBe(baseline);
  });
});

describe("estimateTurnChars", () => {
  const system = "You are a Facet agent.";
  const messages: readonly TurnMessage[] = [
    { role: "user", content: "hello there" },
    { role: "assistant", content: "hi, how can I help?" },
  ];

  it("counts system, messages, and every tool schema", () => {
    const withoutTools = estimateTurnChars(system, messages, []);
    const withOneTool = estimateTurnChars(system, messages, [TOOL_A]);
    const withTwoTools = estimateTurnChars(system, messages, [TOOL_A, TOOL_B]);

    // System text and messages are included.
    expect(withoutTools).toBeGreaterThan(system.length);
    // Adding a tool strictly increases the estimate (tools are counted).
    expect(withOneTool).toBeGreaterThan(withoutTools);
    expect(withTwoTools).toBeGreaterThan(withOneTool);
    // The increase from a tool is at least its serialized size.
    expect(withOneTool - withoutTools).toBeGreaterThanOrEqual(JSON.stringify(TOOL_A).length);
  });

  it("survives an unserializable tool spec via a fixed fallback length", () => {
    const circular: Record<string, unknown> = { type: "object" };
    circular["self"] = circular;
    const badTool = {
      name: "bad",
      description: "circular params",
      parameters: circular,
    } as unknown as ToolSpec;

    const value = estimateTurnChars(system, messages, [badTool]);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(estimateTurnChars(system, messages, []));
  });
});
