import { afterEach, describe, expect, it } from "vitest";
import { parseBridgePort, safeEnv } from "./env.js";
import { BRIDGE_DEFAULTS } from "./defaults.js";

const added: string[] = [];
const set = (key: string, value: string): void => {
  added.push(key);
  process.env[key] = value;
};
afterEach(() => {
  for (const key of added) delete process.env[key];
  added.length = 0;
});

describe("safeEnv", () => {
  it("includes allowlisted keys but withholds secrets", () => {
    set("HOME", "/home/facet");
    set("ANTHROPIC_API_KEY", "sk-should-not-leak");
    set("AWS_SECRET_ACCESS_KEY", "aws-should-not-leak");
    const env = safeEnv();
    expect(env["HOME"]).toBe("/home/facet");
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
  });

  it("lets `extra` add and override", () => {
    const env = safeEnv({ PATH: "/custom/bin", FACET_EVENT: "42" });
    expect(env["PATH"]).toBe("/custom/bin");
    expect(env["FACET_EVENT"]).toBe("42");
  });
});

describe("parseBridgePort", () => {
  it("passes undefined through", () => {
    expect(parseBridgePort(undefined)).toBeUndefined();
  });

  it("parses a valid port", () => {
    expect(parseBridgePort("5292")).toBe(5292);
  });

  it.each(["abc", "-1", "0", "1.5", "70000"])(
    "throws on invalid value %j (naming the offender)",
    (value) => {
      expect(() => parseBridgePort(value)).toThrow(value);
    },
  );
});

describe("BRIDGE_DEFAULTS", () => {
  it("pins the single-source defaults so cli/bridge cannot drift", () => {
    expect(BRIDGE_DEFAULTS).toEqual({
      serverUrl: "http://localhost:5291",
      agentId: "live",
      bridgePort: 5292,
    });
  });
});
