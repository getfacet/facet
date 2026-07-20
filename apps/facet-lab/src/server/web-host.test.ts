import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request as createHttpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLabVisitorRegistry,
  startLabInnerServer,
  createLabWebHost,
  staticPathEscapesRoot,
} from "./web-host.js";

const closeTasks: Array<() => Promise<void>> = [];

function rawStatus(url: string, headers: Readonly<Record<string, string>>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest(url, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once("error", reject);
    request.end();
  });
}

afterEach(async () => {
  for (const close of closeTasks.splice(0).reverse()) await close();
});

describe("Facet Lab web host", () => {
  it("rejects parent and Windows cross-volume static paths on every host", () => {
    expect(staticPathEscapesRoot("../secret.txt")).toBe(true);
    expect(staticPathEscapesRoot(win32.relative("C:\\facet-lab", "D:\\secret.txt"))).toBe(true);
    expect(staticPathEscapesRoot("assets/app.js")).toBe(false);
  });

  it("rejects hostile origins hosts bodies and agent-channel access", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "facet-lab-web-host-"));
    closeTasks.push(() => rm(staticRoot, { recursive: true, force: true }));
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>Facet Lab test</title>");
    const outsideRoot = await mkdtemp(join(tmpdir(), "facet-lab-web-host-outside-"));
    closeTasks.push(() => rm(outsideRoot, { recursive: true, force: true }));
    await writeFile(join(outsideRoot, "secret.txt"), "must not be served");
    await mkdir(join(staticRoot, "assets"));
    await symlink(join(outsideRoot, "secret.txt"), join(staticRoot, "assets", "leak.txt"));

    const inner = await startLabInnerServer({
      agentId: "facet-lab-test",
      agent: () => [{ kind: "say", text: "hello from Lab" }],
    });
    closeTasks.push(() => inner.server.close());
    expect(inner.agentToken).toMatch(/^[a-f0-9]{64}$/u);

    const visitors = createLabVisitorRegistry();
    visitors.register("run-1");
    const host = createLabWebHost({
      host: "127.0.0.1",
      port: 0,
      innerBaseUrl: inner.baseUrl,
      staticRoot,
      visitors,
      maxBodyBytes: 128,
      apiHandler: ({ response }) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
      },
    });
    const listening = await host.listen();
    closeTasks.push(() => host.close());

    expect((await fetch(`${listening.baseUrl}/health`)).status).toBe(200);
    expect(await (await fetch(`${listening.baseUrl}/api/catalog`)).json()).toEqual({ ok: true });
    expect((await fetch(`${listening.baseUrl}/`)).status).toBe(200);
    expect((await fetch(`${listening.baseUrl}/assets/leak.txt`)).status).toBe(404);
    expect((await fetch(`${listening.baseUrl}/agent/stream`)).status).toBe(404);
    expect((await fetch(`${listening.baseUrl}/stream?visitorId=unknown`)).status).toBe(403);

    expect(await rawStatus(`${listening.baseUrl}/health`, { host: "evil.example" })).toBe(403);
    const hostileOrigin = await fetch(`${listening.baseUrl}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(hostileOrigin.status).toBe(403);
    const hostileApiOrigin = await fetch(`${listening.baseUrl}/api/catalog`, {
      headers: { origin: "https://evil.example" },
    });
    expect(hostileApiOrigin.status).toBe(403);

    const oversizedApi = await fetch(`${listening.baseUrl}/api/catalog`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(256) }),
    });
    expect(oversizedApi.status).toBe(413);

    const unregistered = await fetch(`${listening.baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "unknown" },
        event: { kind: "message", text: "no" },
      }),
    });
    expect(unregistered.status).toBe(403);

    const oversized = await fetch(`${listening.baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitor: { visitorId: "run-1" }, padding: "x".repeat(256) }),
    });
    expect(oversized.status).toBe(413);

    const streamResponse = await fetch(`${listening.baseUrl}/stream?visitorId=run-1`);
    expect(streamResponse.status).toBe(200);
    await streamResponse.body?.cancel();

    const accepted = await fetch(`${listening.baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitor: { visitorId: "run-1" },
        event: { kind: "message", text: "hello" },
      }),
    });
    expect(accepted.status).toBe(202);

    visitors.unregister("run-1");
    expect((await fetch(`${listening.baseUrl}/stream?visitorId=run-1`)).status).toBe(403);
    expect(() =>
      createLabWebHost({
        host: "0.0.0.0",
        port: 0,
        innerBaseUrl: inner.baseUrl,
        staticRoot,
        visitors,
      }),
    ).toThrow(/loopback/i);
  });
});
