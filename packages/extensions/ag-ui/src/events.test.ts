import {
  EventType,
  type CustomEvent,
  type StateDeltaEvent,
  type StateSnapshotEvent,
} from "@ag-ui/core";
import { MAX_PATCH_OPS } from "@facet/core";
import { describe, expect, it } from "vitest";
import type { FacetTree, JsonPatchOperation, ServerMessage } from "@facet/core";

import {
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

  it("surfaces AG-UI RUN_ERROR as a safe Facet say message", () => {
    expect(
      agUiEventToServerMessages({
        type: EventType.RUN_ERROR,
        message: "postgres://secret@internal/path",
        code: "RUNTIME_ERROR",
      }),
    ).toEqual([{ kind: "say", text: "(the agent hit an error - try again)" }]);
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
