import {
  EventType,
  type CustomEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
} from "@ag-ui/core";
import {
  MAX_FIELD_VALUE_CHARS,
  MAX_FIELDS_KEYS,
  MAX_PATCH_OPS,
  MAX_RENDER_NODES,
  MAX_SCREENS,
} from "@facet/core";
import { describe, expect, it } from "vitest";
import type { FacetTree, JsonPatchOperation, ServerMessage } from "@facet/core";

import {
  AgUiServerMessageAccumulator,
  FACET_RESET_EVENT_NAME,
  FACET_STAGE_STATE_PATH,
  agUiEventToServerMessages,
  agUiEventsToServerMessages,
  facetStageToStateSnapshot,
  serverMessageToAgUiEvents,
  serverMessagesToAgUiEvents,
} from "./events.js";

const stage: FacetTree = {
  root: "root",
  nodes: {
    root: {
      id: "root",
      type: "box",
      children: ["headline"],
    },
    headline: {
      id: "headline",
      type: "text",
      value: "Hello",
    },
  },
};

function stageWithNodeCount(nodeCount: number): FacetTree {
  const nodes: Record<string, FacetTree["nodes"][string]> = {
    root: { id: "root", type: "box", children: [] },
  };
  for (let index = 1; index < nodeCount; index += 1) {
    nodes[`n-${String(index)}`] = { id: `n-${String(index)}`, type: "text", value: "x" };
  }
  return { root: "root", nodes };
}

describe("AG-UI event conversion", () => {
  it("maps Facet patches to reserved AG-UI STATE_DELTA paths and back", () => {
    const patches: readonly JsonPatchOperation[] = [
      { op: "replace", path: "/nodes/headline/value", value: "Updated" },
      { op: "add", path: "/nodes/root/children/-", value: "cta" },
      { op: "copy", from: "/nodes/headline", path: "/nodes/headline-copy" },
    ];

    const [event] = serverMessageToAgUiEvents({ kind: "patch", patches });

    expect(event).toEqual({
      type: EventType.STATE_DELTA,
      delta: [
        { op: "replace", path: `${FACET_STAGE_STATE_PATH}/nodes/headline/value`, value: "Updated" },
        { op: "add", path: `${FACET_STAGE_STATE_PATH}/nodes/root/children/-`, value: "cta" },
        {
          op: "copy",
          from: `${FACET_STAGE_STATE_PATH}/nodes/headline`,
          path: `${FACET_STAGE_STATE_PATH}/nodes/headline-copy`,
        },
      ],
    });
    expect(agUiEventToServerMessages(event)).toEqual([{ kind: "patch", patches }]);
  });

  it("maps root replace patches to the exact /facet/stage state path", () => {
    const patch: JsonPatchOperation = { op: "replace", path: "", value: stage };
    const [event] = serverMessageToAgUiEvents({ kind: "patch", patches: [patch] });

    expect((event as StateDeltaEvent).delta).toEqual([
      { op: "replace", path: FACET_STAGE_STATE_PATH, value: stage },
    ]);
    expect(agUiEventToServerMessages(event)).toEqual([{ kind: "patch", patches: [patch] }]);
  });

  it("maps RFC patch test, remove, and move ops through the reserved stage path", () => {
    const patches: readonly JsonPatchOperation[] = [
      { op: "test", path: "/nodes/headline/value", value: "Hello" },
      { op: "remove", path: "/nodes/root/children/0" },
      { op: "move", from: "/nodes/headline", path: "/nodes/moved-headline" },
    ];

    const [event] = serverMessageToAgUiEvents({ kind: "patch", patches });

    expect(event).toEqual({
      type: EventType.STATE_DELTA,
      delta: [
        { op: "test", path: `${FACET_STAGE_STATE_PATH}/nodes/headline/value`, value: "Hello" },
        { op: "remove", path: `${FACET_STAGE_STATE_PATH}/nodes/root/children/0` },
        {
          op: "move",
          from: `${FACET_STAGE_STATE_PATH}/nodes/headline`,
          path: `${FACET_STAGE_STATE_PATH}/nodes/moved-headline`,
        },
      ],
    });
    expect(agUiEventToServerMessages(event)).toEqual([{ kind: "patch", patches }]);
  });

  it("maps AG-UI STATE_SNAPSHOT facet.stage to a root-replace patch", () => {
    const event: StateSnapshotEvent = {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { facet: { stage } },
    };

    expect(agUiEventToServerMessages(event)).toEqual([
      { kind: "patch", patches: [{ op: "replace", path: "", value: stage }] },
    ]);
    expect(facetStageToStateSnapshot(stage)).toEqual({
      type: EventType.STATE_SNAPSHOT,
      snapshot: { facet: { stage } },
    });
  });

  it("maps Facet say text to AG-UI text message start/content/end in order", () => {
    const events = serverMessageToAgUiEvents({ kind: "say", text: "Hello from Facet" });

    expect(events.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
    expect(events[0]).toMatchObject({ role: "assistant" });
    expect(events[1]).toMatchObject({ delta: "Hello from Facet" });
    expect(new Set(events.map((event) => "messageId" in event && event.messageId))).toHaveProperty(
      "size",
      1,
    );
  });

  it("uses unique default message ids for standalone say conversions", () => {
    const first = serverMessageToAgUiEvents({ kind: "say", text: "First" });
    const second = serverMessageToAgUiEvents({ kind: "say", text: "Second" });

    expect((first[0] as { readonly messageId: string }).messageId).not.toBe(
      (second[0] as { readonly messageId: string }).messageId,
    );
  });

  it("maps Facet reset through a reversible AG-UI custom event", () => {
    const [event] = serverMessageToAgUiEvents({ kind: "reset" });

    expect(event).toEqual({
      type: EventType.CUSTOM,
      name: FACET_RESET_EVENT_NAME,
      value: null,
    });
    expect(agUiEventToServerMessages(event)).toEqual([{ kind: "reset" }]);
  });

  it("ignores hostile or non-Facet state paths", () => {
    const event: StateDeltaEvent = {
      type: EventType.STATE_DELTA,
      delta: [
        { op: "replace", path: "/messages/0/content", value: "inject" },
        { op: "replace", path: "/facet/not-stage/root", value: "inject" },
        { op: "replace", path: "/facet/stagecraft/root", value: "inject" },
      ],
    };

    expect(agUiEventToServerMessages(event)).toEqual([]);
  });

  it("does not throw or emit writes for null, empty, malformed, raw, custom, or cyclic input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    const values: readonly unknown[] = [
      null,
      undefined,
      {},
      [],
      { type: EventType.STATE_DELTA },
      { type: EventType.STATE_DELTA, delta: null },
      { type: EventType.STATE_DELTA, delta: [] },
      { type: EventType.STATE_DELTA, delta: [{ op: "replace", path: FACET_STAGE_STATE_PATH }] },
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: FACET_STAGE_STATE_PATH, value: cyclic }],
      },
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "copy", from: "/messages/0", path: `${FACET_STAGE_STATE_PATH}/nodes/leak` }],
      },
      { type: EventType.STATE_SNAPSHOT, snapshot: null },
      { type: EventType.STATE_SNAPSHOT, snapshot: { facet: { stage: cyclic } } },
      { type: EventType.RAW, event: { facet: { stage } } },
      { type: EventType.CUSTOM, name: "not-facet/reset", value: { stage } },
    ];

    for (const value of values) {
      expect(() => agUiEventToServerMessages(value)).not.toThrow();
      expect(agUiEventToServerMessages(value)).toEqual([]);
    }
    expect(agUiEventsToServerMessages(values)).toEqual([]);
  });

  it("drops AG-UI state deltas over the shared patch operation cap before conversion", () => {
    const delta = Array.from({ length: MAX_PATCH_OPS + 1 }, () => ({
      op: "replace",
      path: `${FACET_STAGE_STATE_PATH}/nodes/headline/value`,
      value: "Updated",
    }));

    expect(agUiEventToServerMessages({ type: EventType.STATE_DELTA, delta })).toEqual([]);
  });

  it("drops AG-UI state deltas with non-finite JSON values", () => {
    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [
          {
            op: "replace",
            path: `${FACET_STAGE_STATE_PATH}/theme`,
            value: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops AG-UI root deltas over the render node cap", () => {
    const hugeStage = stageWithNodeCount(MAX_RENDER_NODES + 1);

    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: FACET_STAGE_STATE_PATH, value: hugeStage }],
      }),
    ).toEqual([]);
    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: `${FACET_STAGE_STATE_PATH}/nodes`, value: hugeStage.nodes }],
      }),
    ).toEqual([]);
  });

  it("drops malformed AG-UI /nodes map replacements instead of clearing the stage", () => {
    for (const value of [null, [], "nodes"]) {
      expect(
        agUiEventToServerMessages({
          type: EventType.STATE_DELTA,
          delta: [{ op: "replace", path: `${FACET_STAGE_STATE_PATH}/nodes`, value }],
        }),
      ).toEqual([]);
    }
  });

  it("drops oversized AG-UI partial stage deltas before cloning them", () => {
    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [
          {
            op: "replace",
            path: `${FACET_STAGE_STATE_PATH}/nodes/root/children`,
            value: Array.from({ length: MAX_RENDER_NODES + 1 }, (_, index) => `n-${String(index)}`),
          },
        ],
      }),
    ).toEqual([]);

    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [
          {
            op: "replace",
            path: `${FACET_STAGE_STATE_PATH}/screens`,
            value: Object.fromEntries(
              Array.from({ length: MAX_SCREENS + 1 }, (_, index) => [
                `screen-${String(index)}`,
                "root",
              ]),
            ),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops aggregate string-heavy AG-UI state deltas before cloning them", () => {
    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [
          {
            op: "replace",
            path: `${FACET_STAGE_STATE_PATH}/nodes/root/style`,
            value: Object.fromEntries(
              Array.from({ length: MAX_FIELDS_KEYS + 1 }, (_, index) => [
                `k-${String(index)}`,
                "x".repeat(MAX_FIELD_VALUE_CHARS),
              ]),
            ),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops AG-UI snapshots over the snapshot node cap", () => {
    const hugeStage = stageWithNodeCount(MAX_RENDER_NODES + MAX_PATCH_OPS + 1);

    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_SNAPSHOT,
        snapshot: { facet: { stage: hugeStage } },
      }),
    ).toEqual([]);
  });

  it("drops aggregate string-heavy AG-UI snapshots before cloning them", () => {
    const nodes: Record<string, FacetTree["nodes"][string]> = {
      root: { id: "root", type: "box", children: [] },
    };
    for (let index = 0; index < MAX_FIELDS_KEYS + 1; index += 1) {
      const id = `n-${String(index)}`;
      nodes[id] = { id, type: "text", value: "x".repeat(MAX_FIELD_VALUE_CHARS) };
    }

    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_SNAPSHOT,
        snapshot: { facet: { stage: { root: "root", nodes } } },
      }),
    ).toEqual([]);
  });

  it("round-trips outbound Facet snapshots whose full node map exceeds the render budget", () => {
    const largeStage = stageWithNodeCount(MAX_RENDER_NODES + 1);
    const event = facetStageToStateSnapshot(largeStage);

    expect(event.snapshot.facet.stage).toEqual(largeStage);
    expect(agUiEventToServerMessages(event)).toEqual([
      { kind: "patch", patches: [{ op: "replace", path: "", value: largeStage }] },
    ]);
  });

  it("drops outbound Facet patch batches over the shared operation cap", () => {
    const patches: JsonPatchOperation[] = Array.from({ length: MAX_PATCH_OPS + 1 }, (_, index) => ({
      op: "replace" as const,
      path: `/nodes/node-${String(index)}/value`,
      value: "Updated",
    }));

    expect(serverMessageToAgUiEvents({ kind: "patch", patches })).toEqual([]);
  });

  it("ignores non-Facet state deltas before cloning their values", () => {
    let cloned = false;
    const hostileValue = {
      toJSON: () => {
        cloned = true;
        throw new Error("non-Facet values should not be cloned");
      },
    };

    expect(
      agUiEventToServerMessages({
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/messages/0/content", value: hostileValue }],
      }),
    ).toEqual([]);
    expect(cloned).toBe(false);
  });

  it("surfaces AG-UI RUN_ERROR as a safe Facet say message", () => {
    expect(
      agUiEventToServerMessages({
        type: EventType.RUN_ERROR,
        message: "postgres://secret@internal/path",
        code: "RUNTIME_ERROR",
      }),
    ).toEqual([{ kind: "say", text: "(the agent hit an error - try again)" }]);
  });

  it("aggregates AG-UI TEXT_MESSAGE_CHUNK deltas by message id", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "Hel" },
        { type: EventType.TEXT_MESSAGE_CHUNK, delta: "lo" },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m2", delta: "Again" },
      ]),
    ).toEqual([
      { kind: "say", text: "Hello" },
      { kind: "say", text: "Again" },
    ]);
    expect(
      agUiEventToServerMessages({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId: "m1",
        delta: "chunk text",
      }),
    ).toEqual([]);
  });

  it("drops AG-UI text messages that exceed the text buffer caps", () => {
    const tooLong = "x".repeat(MAX_FIELD_VALUE_CHARS * MAX_FIELDS_KEYS + 1);

    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "huge", delta: tooLong },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "huge", delta: "tail" },
      ]),
    ).toEqual([]);
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_START, messageId: "framed", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "framed", delta: tooLong },
        { type: EventType.TEXT_MESSAGE_END, messageId: "framed" },
      ]),
    ).toEqual([]);
    expect(
      agUiEventsToServerMessages(
        Array.from({ length: MAX_PATCH_OPS + 1 }, () => ({
          type: EventType.TEXT_MESSAGE_CHUNK,
          messageId: "parts",
          delta: "x",
        })),
      ),
    ).toEqual([]);
  });

  it("bounds distinct AG-UI text message buffers", () => {
    const messages = agUiEventsToServerMessages(
      Array.from({ length: MAX_FIELDS_KEYS + 1 }, (_, index) => ({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId: `m-${String(index)}`,
        delta: "x",
      })),
    );

    expect(messages).toHaveLength(MAX_FIELDS_KEYS);
    expect(messages.every((message) => message.kind === "say" && message.text === "x")).toBe(true);
  });

  it("bounds aggregate AG-UI text buffered across message ids", () => {
    const halfCap = Math.floor((MAX_FIELD_VALUE_CHARS * MAX_FIELDS_KEYS) / 2);
    const messages = agUiEventsToServerMessages([
      { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "a".repeat(halfCap) },
      { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m2", delta: "b".repeat(halfCap) },
      { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m3", delta: "c" },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ kind: "say", text: "a".repeat(halfCap) });
    expect(messages[1]).toMatchObject({ kind: "say", text: "b".repeat(halfCap) });
  });

  it("uses metadata-only text chunks to switch the active chunk message id", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "A" },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m2", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CHUNK, delta: "B" },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m3", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CHUNK, delta: "C" },
      ]),
    ).toEqual([
      { kind: "say", text: "A" },
      { kind: "say", text: "B" },
      { kind: "say", text: "C" },
    ]);
  });

  it("does not let metadata-only chunks block later completed framed text", () => {
    const accumulator = new AgUiServerMessageAccumulator();

    expect(
      accumulator.accept({
        type: EventType.TEXT_MESSAGE_CHUNK,
        messageId: "metadata-only",
        role: "assistant",
      }),
    ).toEqual([]);
    expect(
      accumulator.accept({
        type: EventType.TEXT_MESSAGE_START,
        messageId: "framed",
        role: "assistant",
      }),
    ).toEqual([]);
    expect(
      accumulator.accept({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "framed",
        delta: "framed",
      }),
    ).toEqual([]);
    expect(
      accumulator.accept({
        type: EventType.TEXT_MESSAGE_END,
        messageId: "framed",
      }),
    ).toEqual([{ kind: "say", text: "framed" }]);
  });

  it("flushes open AG-UI text chunks before later state events", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "m1", delta: "Hello" },
        {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "replace",
              path: `${FACET_STAGE_STATE_PATH}/nodes/headline/value`,
              value: "Updated",
            },
          ],
        },
      ]),
    ).toEqual([
      { kind: "say", text: "Hello" },
      {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/headline/value", value: "Updated" }],
      },
    ]);
  });

  it("drops incomplete framed text at final flush without losing later completed messages", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_START, messageId: "broken", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "broken", delta: "drop me" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "ok", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "ok", delta: "keep me" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "ok" },
      ]),
    ).toEqual([{ kind: "say", text: "keep me" }]);
  });

  it("preserves final text order after dropping incomplete framed blockers", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_START, messageId: "broken", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "broken", delta: "drop me" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "ok", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "ok", delta: "framed" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "ok" },
        { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "chunk", delta: "chunk" },
      ]),
    ).toEqual([
      { kind: "say", text: "framed" },
      { kind: "say", text: "chunk" },
    ]);
  });

  it("flushes completed framed text before later state after dropping stale blockers", () => {
    expect(
      agUiEventsToServerMessages([
        { type: EventType.TEXT_MESSAGE_START, messageId: "broken", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "broken", delta: "drop me" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "ok", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "ok", delta: "framed" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "ok" },
        {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "replace",
              path: `${FACET_STAGE_STATE_PATH}/nodes/headline/value`,
              value: "Updated",
            },
          ],
        },
      ]),
    ).toEqual([
      { kind: "say", text: "framed" },
      {
        kind: "patch",
        patches: [{ op: "replace", path: "/nodes/headline/value", value: "Updated" }],
      },
    ]);
  });

  it("does not alias converted stage state or patch values", () => {
    const mutableStage: FacetTree = structuredClone(stage);
    const snapshot: StateSnapshotEvent = {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { facet: { stage: mutableStage } },
    };
    const [snapshotMessage] = agUiEventToServerMessages(snapshot);
    (mutableStage.nodes as Record<string, unknown>)["root"] = {
      id: "root",
      type: "box",
      children: ["mutated"],
    };

    expect(snapshotMessage).toEqual({
      kind: "patch",
      patches: [{ op: "replace", path: "", value: stage }],
    });

    const patch: JsonPatchOperation = {
      op: "replace",
      path: "/nodes/headline",
      value: stage.nodes.headline,
    };
    const [delta] = serverMessagesToAgUiEvents([{ kind: "patch", patches: [patch] }]);
    const [deltaOperation] = (delta as StateDeltaEvent).delta;
    expect(deltaOperation).toBeDefined();
    (deltaOperation as { value: unknown }).value = { id: "mutated", type: "text", value: "unsafe" };

    expect(patch.value).toEqual(stage.nodes.headline);
  });

  it("returns an empty message batch for malformed AG-UI event containers", () => {
    expect(agUiEventsToServerMessages(null)).toEqual([]);
    expect(agUiEventsToServerMessages({})).toEqual([]);
    expect(
      agUiEventsToServerMessages({
        [Symbol.iterator]: () => ({
          next: () => {
            throw new Error("iterator failed");
          },
        }),
      }),
    ).toEqual([]);
  });

  it("preserves mixed server message ordering", () => {
    const messages: readonly ServerMessage[] = [
      { kind: "say", text: "A" },
      { kind: "patch", patches: [{ op: "replace", path: "/root", value: "root" }] },
      { kind: "reset" },
    ];

    expect(serverMessagesToAgUiEvents(messages).map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_DELTA,
      EventType.CUSTOM,
    ]);
  });

  it("only treats the Facet reset custom event as native reset", () => {
    const event: CustomEvent = {
      type: EventType.CUSTOM,
      name: FACET_RESET_EVENT_NAME,
      value: null,
    };

    expect(agUiEventToServerMessages(event)).toEqual([{ kind: "reset" }]);
    expect(
      agUiEventToServerMessages({
        type: EventType.CUSTOM,
        name: FACET_RESET_EVENT_NAME,
        value: "payload",
      }),
    ).toEqual([]);
  });
});
