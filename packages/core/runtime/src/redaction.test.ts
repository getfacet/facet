import { describe, expect, it } from "vitest";
import {
  REDACTED_SENSITIVE_VALUE,
  redactSensitiveText,
  shouldRedactSensitiveField,
} from "./redaction.js";

describe("shouldRedactSensitiveField", () => {
  it.each([
    "password",
    "passcode",
    "clientSecret",
    "accessToken",
    "api_key",
    "api-key",
    "authorization",
    "bearer",
    "providerKey",
  ])("redacts sensitive field name %s", (name) => {
    expect(shouldRedactSensitiveField(name, "otherwise-safe")).toBe(true);
  });

  it("redacts key-looking string values independently of their field name", () => {
    expect(shouldRedactSensitiveField("note", "sk-abc_123")).toBe(true);
    expect(shouldRedactSensitiveField("note", "Bearer abc.123+/=")).toBe(true);
  });

  it("keeps ordinary values and still treats a sensitive name as sensitive", () => {
    expect(shouldRedactSensitiveField("email", "ada@example.com")).toBe(false);
    expect(shouldRedactSensitiveField("subscribed", true)).toBe(false);
    expect(shouldRedactSensitiveField("count", 3)).toBe(false);
    expect(shouldRedactSensitiveField("password", false)).toBe(true);
  });
});

describe("redactSensitiveText", () => {
  it("redacts keys, bearer tokens, and sensitive quoted field values", () => {
    const input =
      'send sk-abc123 and Bearer xyz.789 plus {"password": "hunter2"} and {"api_key":"topsecret"} but keep hello';
    const output = redactSensitiveText(input);

    expect(output).not.toContain("sk-abc123");
    expect(output).not.toContain("xyz.789");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("topsecret");
    expect(output).toContain(REDACTED_SENSITIVE_VALUE);
    expect(output).toContain("hello");
  });

  it("returns ordinary bounded text unchanged across repeated calls", () => {
    const input = "the visitor wants a pricing table";
    expect(redactSensitiveText(input)).toBe(input);
    expect(redactSensitiveText(input)).toBe(input);
  });

  it("bounds pathological input before applying the redaction regexes", () => {
    const hostile = `"${"token".repeat(40_000)}`;
    expect(() => redactSensitiveText(hostile)).not.toThrow();
    expect(redactSensitiveText("x".repeat(100_001))).toHaveLength(100_000);
  });
});
