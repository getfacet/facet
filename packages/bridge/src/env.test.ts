import { afterEach, describe, expect, it } from "vitest";
import { safeEnv } from "./env.js";

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
