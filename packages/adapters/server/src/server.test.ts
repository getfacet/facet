import { afterEach, describe, expect, it } from "vitest";
import type { FacetToolSession } from "@facet/core";
import {
  agentEvent,
  eventReader,
  postEvent,
  readFrames,
  start,
  textValues,
} from "./server.test-support.js";

const UPDATED = `<Facet entry="home"><Screen name="home"><Text value="Updated" /></Screen></Facet>`;

let active: { readonly close: () => Promise<void> } | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
});

describe("createFacetServer", () => {
  it("answers health and rejects streams without a session key", async () => {
    const { server, base } = await start();
    active = server;

    await expect(fetch(`${base}/health`).then((res) => res.text())).resolves.toBe("ok agent=local");
    await expect(fetch(`${base}/stream`).then((res) => res.status)).resolves.toBe(400);
    const legacy = await fetch(`${base}/stream?visitorId=s1`);
    const legacyStatus = legacy.status;
    await legacy.body?.cancel();
    expect(legacyStatus).toBe(400);
  });

  it("rehydrates from the host-bootstrapped session as one stage-rooted patch", async () => {
    const { server, base } = await start();
    active = server;

    const frames = await readFrames(await fetch(`${base}/stream?sessionKey=s1`), 1);

    expect(frames[0]?.data.kind).toBe("patch");
    if (frames[0]?.data.kind !== "patch") throw new Error("expected patch frame");
    expect(frames[0].data.stageRevision).toBe(0);
    expect(frames[0].data.ops).toHaveLength(1);
    expect(frames[0].data.ops[0]).toMatchObject({ op: "replace", path: "" });
    const operation = frames[0].data.ops[0];
    if (operation?.op !== "replace") throw new Error("expected replace");
    const stage = operation.value;
    expect(textValues((stage as { readonly document: unknown }).document as never)).toEqual([
      "Ready",
    ]);
  });

  it("streams runtime outbox frames in seq order with authoritative patch revisions", async () => {
    const { server, base } = await start({
      agent: {
        run: async ({ session }: { readonly session: FacetToolSession }) => {
          await session.applyAuthorMutation(UPDATED);
          return { text: "done" };
        },
      },
    });
    active = server;
    const stream = await fetch(`${base}/stream?sessionKey=s1`);
    const reader = eventReader(stream);

    await reader.next(); // initial rehydrate
    const response = await postEvent(base, "s1", agentEvent());
    expect(response.status).toBe(202);

    const patch = await reader.next();
    const conversation = await reader.next();
    await reader.close();

    expect(patch?.id).toMatch(/:\d+$/u);
    expect(conversation?.id).toMatch(/:\d+$/u);
    expect(patch?.data.kind).toBe("patch");
    expect(conversation?.data.kind).toBe("conversation");
    if (patch?.data.kind !== "patch") throw new Error("expected patch frame");
    if (conversation?.data.kind !== "conversation") throw new Error("expected conversation frame");
    expect(patch.data.stageRevision).toBe(1);
    expect(patch.data.ops[0]).toMatchObject({ op: "replace", path: "/document" });
    expect(conversation.data.messageId).toBe("event1:assistant");
    expect(conversation.data.text).toBe("done");
  });

  it("consumes the browser lastEventId query cursor on reconnect", async () => {
    const { server, base } = await start({
      agent: {
        run: async ({ session }: { readonly session: FacetToolSession }) => {
          await session.applyAuthorMutation(UPDATED);
          return { text: "done" };
        },
      },
    });
    active = server;
    const stream = await fetch(`${base}/stream?sessionKey=s1`);
    const reader = eventReader(stream);

    await reader.next(); // initial rehydrate
    const response = await postEvent(base, "s1", agentEvent());
    expect(response.status).toBe(202);
    const patch = await reader.next();
    await reader.close();
    if (patch?.id === undefined) {
      throw new Error("expected patch cursor");
    }

    const resumed = eventReader(
      await fetch(`${base}/stream?sessionKey=s1&lastEventId=${encodeURIComponent(patch.id)}`),
    );
    const replayed = await resumed.next();
    await resumed.close();

    expect(replayed?.data.kind).toBe("conversation");
    if (replayed?.data.kind !== "conversation") throw new Error("expected conversation");
    expect(replayed.data.text).toBe("done");
  });

  it("rejects ambiguous browser resume cursors before opening SSE", async () => {
    const { server, base } = await start();
    active = server;

    await expect(
      fetch(`${base}/stream?sessionKey=s1&lastEventId=a:1&lastEventId=a:1`).then(async (res) => {
        await res.body?.cancel();
        return res.status;
      }),
    ).resolves.toBe(400);
    await expect(
      fetch(`${base}/stream?sessionKey=s1&lastEventId=a:1`, {
        headers: { "Last-Event-ID": "a:2" },
      }).then(async (res) => {
        await res.body?.cancel();
        return res.status;
      }),
    ).resolves.toBe(400);
  });

  it("ends active browser streams during server close", async () => {
    const { server, base } = await start();
    active = server;
    const stream = await fetch(`${base}/stream?sessionKey=s1`);
    expect(stream.status).toBe(200);

    await expect(
      Promise.race([
        server.close().then(() => "closed" as const),
        new Promise<"timed-out">((resolve) => {
          setTimeout(() => resolve("timed-out"), 500);
        }),
      ]),
    ).resolves.toBe("closed");
    active = undefined;
  });

  it("serializes only ServerFrame kinds", async () => {
    const { server, base } = await start();
    active = server;

    const [frame] = await readFrames(await fetch(`${base}/stream?sessionKey=s1`), 1);

    expect(frame?.data.kind).toBe("patch");
    expect(JSON.stringify(frame?.data)).not.toContain('"say"');
    expect(JSON.stringify(frame?.data)).not.toContain('"reset"');
  });
});
