import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { assertLoopbackBind, inspectLabRequest, readBoundedBody } from "./http-security.js";

describe("Facet Lab HTTP security", () => {
  it("rejects hostile origins hosts bodies and agent-channel access", async () => {
    expect(() => assertLoopbackBind("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackBind("::1")).not.toThrow();
    expect(() => assertLoopbackBind("localhost")).toThrow(/numeric loopback/i);
    expect(() => assertLoopbackBind("0.0.0.0")).toThrow(/loopback/i);

    const accepted = inspectLabRequest(
      {
        method: "POST",
        target: "/event",
        host: "127.0.0.1:5293",
        origin: "http://127.0.0.1:5293",
        contentLength: "12",
      },
      { authority: "127.0.0.1:5293", maxBodyBytes: 64 },
    );
    expect(accepted).toMatchObject({ ok: true, pathname: "/event" });

    expect(
      inspectLabRequest(
        { method: "GET", target: "/health", host: "evil.example" },
        { authority: "127.0.0.1:5293", maxBodyBytes: 64 },
      ),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      inspectLabRequest(
        {
          method: "GET",
          target: "/stream?visitorId=run-1",
          host: "127.0.0.1:5293",
          origin: "https://evil.example",
        },
        { authority: "127.0.0.1:5293", maxBodyBytes: 64 },
      ),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      inspectLabRequest(
        { method: "GET", target: "/agent/stream", host: "127.0.0.1:5293" },
        { authority: "127.0.0.1:5293", maxBodyBytes: 64 },
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      inspectLabRequest(
        {
          method: "POST",
          target: "/event",
          host: "127.0.0.1:5293",
          contentLength: "65",
        },
        { authority: "127.0.0.1:5293", maxBodyBytes: 64 },
      ),
    ).toMatchObject({ ok: false, status: 413 });

    await expect(readBoundedBody(Readable.from(["a".repeat(65)]), 64)).rejects.toMatchObject({
      status: 413,
    });
  });
});
