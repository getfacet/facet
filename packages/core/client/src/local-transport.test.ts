import { describe, expect, it, vi } from "vitest";
import { foldPatchIntoStage, resolveNodeData, treeHasContent } from "@facet/core";
import type {
  CollectedEvent,
  FacetAgent,
  ChartNode,
  FacetTree,
  JsonPatchOperation,
  ServerMessage,
  TableNode,
  VisitorContext,
} from "@facet/core";
import { FacetRuntime } from "@facet/runtime";
import { LocalTransport } from "./local-transport.js";

const visitor = { visitorId: "v" };
const agentOf =
  (...messages: ServerMessage[]): FacetAgent =>
  () =>
    Promise.resolve(messages);

/** send() is fire-and-forget; deliveries land on later microtasks. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("LocalTransport", () => {
  it("delivers the runtime's messages to a subscriber", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "hello" });
    await flush();

    expect(received).toEqual([{ kind: "say", text: "hi" }]);
  });

  it("fans out to every subscriber", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const a: ServerMessage[] = [];
    const b: ServerMessage[] = [];
    transport.subscribe((message) => a.push(message));
    transport.subscribe((message) => b.push(message));

    transport.send({ kind: "visit", visitor });
    await flush();

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("turns an agent throw into a chat notice instead of an unhandled rejection", async () => {
    const throwingAgent: FacetAgent = () => {
      throw new Error("boom");
    };
    const runtime = new FacetRuntime({ agentId: "a", agent: throwingAgent });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "hello" });
    await flush();

    expect(received).toEqual([{ kind: "say", text: "(the agent hit an error)" }]);
  });

  it("routes record() to runtime.record and is best-effort on throw", () => {
    const recorded: Array<[VisitorContext, CollectedEvent]> = [];
    const runtime = {
      handle: () => Promise.resolve({ messages: [] as ServerMessage[] }),
      record: (v: VisitorContext, e: CollectedEvent) => {
        recorded.push([v, e]);
        return Promise.resolve();
      },
    };
    const transport = new LocalTransport(runtime, visitor);
    const tap: CollectedEvent = { kind: "tap", target: "n1", effect: { navigate: "home" } };

    transport.record(tap);
    expect(recorded).toEqual([[visitor, tap]]);

    // A runtime whose record throws synchronously must not propagate.
    const throwing = {
      handle: () => Promise.resolve({ messages: [] as ServerMessage[] }),
      record: () => {
        throw new Error("boom");
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t2 = new LocalTransport(throwing, visitor);
    expect(() => t2.record(tap)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith("[facet] record failed:", expect.any(Error));
    errorSpy.mockRestore();

    // A runtime without record() at all is a safe no-op.
    const bare = { handle: () => Promise.resolve({ messages: [] as ServerMessage[] }) };
    expect(() => new LocalTransport(bare, visitor).record(tap)).not.toThrow();
  });

  it("stops delivering after unsubscribe", async () => {
    const runtime = new FacetRuntime({ agentId: "a", agent: agentOf({ kind: "say", text: "hi" }) });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    const unsubscribe = transport.subscribe((message) => received.push(message));

    transport.send({ kind: "visit", visitor });
    await flush();
    unsubscribe();
    transport.send({ kind: "visit", visitor });
    await flush();

    expect(received).toHaveLength(1);
  });

  // A `/data/<name>` patch delivered over the transport must fold through the
  // SAME pure `foldPatchIntoStage` the runtime uses, so the single data source
  // updates and every `from`-bound view reflects it client-side (DC-002).
  it("folds a /data patch client-side so a bound view reflects the single source", async () => {
    const salesTable: TableNode = {
      id: "sales",
      type: "table",
      from: "sales",
      columns: [
        { key: "region", label: "Region" },
        { key: "revenue", label: "Revenue" },
      ],
      rows: [],
    };
    const base: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["sales"] },
        sales: salesTable,
      },
      data: {
        sales: [
          { region: "West", revenue: 100 },
          { region: "East", revenue: 200 },
        ],
      },
    };

    // The agent edits ONE cell of the single source; the patch travels the transport.
    const patch: JsonPatchOperation = { op: "replace", path: "/data/sales/1/revenue", value: 999 };
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "patch", patches: [patch] }),
    });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "bump revenue" });
    await flush();

    const [message] = received;
    expect(message).toEqual({ kind: "patch", patches: [patch] });
    const folded = foldPatchIntoStage(
      base,
      (message as { readonly patches: readonly JsonPatchOperation[] }).patches,
    );

    // The single /data source updated, and the from-bound table resolves the new cell.
    expect(folded.tree.data?.["sales"]?.[1]?.["revenue"]).toBe(999);
    expect(resolveNodeData(folded.tree.nodes["sales"] as TableNode, folded.tree.data)).toEqual([
      { region: "West", revenue: 100 },
      { region: "East", revenue: 999 },
    ]);
  });

  // A node bound to a dataset that has not arrived yet shows nothing; once a
  // later `/data` patch folds in client-side, the buffered forward reference
  // resolves and the bound node becomes content (DC-008).
  it("resolves a node bound before its data lands once a later /data patch arrives", async () => {
    // A CHART renders nothing until its series resolve, so it exercises the
    // "non-content before the data lands, content after" transition (a from-bound
    // table shows a header from its columns and is content immediately).
    const salesChart: ChartNode = {
      id: "sales",
      type: "chart",
      kind: "bar",
      from: "sales",
      series: [],
    };
    const base: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["sales"] },
        sales: salesChart,
      },
    };

    // Bound before its dataset exists: the chart has nothing to show yet.
    expect(treeHasContent(base)).toBe(false);

    const dataset = [{ revenue: 10 }, { revenue: 20 }];
    const patch: JsonPatchOperation = { op: "add", path: "/data", value: { sales: dataset } };
    const runtime = new FacetRuntime({
      agentId: "a",
      agent: agentOf({ kind: "patch", patches: [patch] }),
    });
    const transport = new LocalTransport(runtime, visitor);
    const received: ServerMessage[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send({ kind: "message", text: "here is the data" });
    await flush();

    const [message] = received;
    const folded = foldPatchIntoStage(
      base,
      (message as { readonly patches: readonly JsonPatchOperation[] }).patches,
    );

    // The forward reference now resolves: the bound node is content and projects a series.
    expect(treeHasContent(folded.tree)).toBe(true);
    expect(resolveNodeData(folded.tree.nodes["sales"] as ChartNode, folded.tree.data)).toEqual([
      { label: "revenue", values: [10, 20] },
    ]);
  });
});
