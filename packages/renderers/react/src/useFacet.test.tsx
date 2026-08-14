// @vitest-environment jsdom
import {
  BOUNDS,
  NEUTRAL_COPY_DEFAULTS,
  type VisitorEvent,
  type ComponentDocument,
  type ComponentMountProps,
  type ComponentNode,
  type ComponentSpec,
  type ConversationMessage,
  type FacetStage,
  type FacetTheme,
  type FacetTransport,
  type JsonPatchOperation,
  type ServerFrame,
} from "@facet/core";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { bootstrapRenderer } from "./bootstrap.js";
import { MODAL_PART_ATTRIBUTE } from "./modal-frame.js";
import type { ComponentRegistry } from "./registry.js";
import { StageRenderer } from "./StageRenderer.js";
import { useFacet } from "./useFacet.js";
import { validTestTheme } from "../../../../test-support/theme-fixture.js";

class TestTransport implements FacetTransport {
  readonly listeners = new Set<(frame: ServerFrame) => void>();

  subscribe(onFrame: (frame: ServerFrame) => void): () => void {
    this.listeners.add(onFrame);
    return () => {
      this.listeners.delete(onFrame);
    };
  }

  emit(frame: ServerFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }
}

const THEME: FacetTheme = validTestTheme();

const EMPTY_STAGE: FacetStage = Object.freeze({ document: null, data: Object.freeze({}) });

const SCREEN_SPEC: ComponentSpec = {
  tag: "Screen",
  whenToUse: "The root of one named screen.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    name: { type: "string", required: true, guidance: "The screen name." },
  },
  acceptsChildren: true,
};

const TEXT_SPEC: ComponentSpec = {
  tag: "Text",
  whenToUse: "Show a line of prose.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    value: { type: "string", required: true, bindable: true, guidance: "The words to show." },
  },
  acceptsChildren: false,
};

const FIELD_SPEC: ComponentSpec = {
  tag: "Field",
  whenToUse: "Ask the visitor for one value.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    name: { type: "string", required: true, guidance: "The collection address." },
    label: { type: "string", required: true, guidance: "The field label." },
    value: { type: "string", default: "", guidance: "The value shown." },
  },
  acceptsChildren: false,
  collect: { collectable: true, valueProp: "value" },
};

const MODAL_SPEC: ComponentSpec = {
  tag: "Modal",
  whenToUse: "Interrupt the screen for one focused decision.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    triggerLabel: { type: "string", required: true, guidance: "The trigger label." },
    title: { type: "string", required: true, guidance: "The dialog title." },
  },
  acceptsChildren: true,
};

const EXPLODER_SPEC: ComponentSpec = {
  tag: "Exploder",
  whenToUse: "A test component that can throw.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    mode: { type: "string", required: true, enum: ["boom", "safe"], guidance: "Throw or render." },
  },
  acceptsChildren: false,
};

function screenImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <section data-testid="screen" data-screen={String(props["name"] ?? "")}>
      {children}
    </section>
  );
}

function textImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  return <p data-testid="text">{String(props["value"] ?? "")}</p>;
}

function fieldImpl({ props, onValueChange }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <input
      data-testid="field"
      aria-label={String(props["label"] ?? "")}
      value={String(props["value"] ?? "")}
      onChange={(event): void => {
        onValueChange?.(event.target.value);
      }}
    />
  );
}

function modalImpl({ props, children }: ComponentMountProps<ReactNode>): ReactNode {
  return (
    <div data-testid="modal-content" data-title={String(props["title"] ?? "")}>
      {children}
    </div>
  );
}

function exploderImpl({ props }: ComponentMountProps<ReactNode>): ReactNode {
  if (props["mode"] === "boom") {
    throw new Error("boom");
  }
  return <div data-testid="exploder">safe</div>;
}

const REGISTRY: ComponentRegistry = Object.freeze({
  Screen: screenImpl,
  Text: textImpl,
  Field: fieldImpl,
  Modal: modalImpl,
  Exploder: exploderImpl,
});

const BOOTSTRAP = (() => {
  const result = bootstrapRenderer({
    catalog: { components: [SCREEN_SPEC, TEXT_SPEC, FIELD_SPEC, MODAL_SPEC, EXPLODER_SPEC] },
    registry: REGISTRY,
    theme: THEME,
  });
  if (!result.ok) {
    throw new Error(`fixture bootstrap failed: ${result.code} at ${result.at}`);
  }
  return result;
})();

function scalar(value: string): ComponentNode["props"][string] {
  return { kind: "scalar", value };
}

function documentWithText(value: string): ComponentDocument {
  return {
    entry: "home",
    screens: ["s1"],
    nodes: {
      s1: { tag: "Screen", props: { name: scalar("home") }, children: ["t1"] },
      t1: { tag: "Text", props: { value: scalar(value) }, children: [] },
    },
  };
}

const INTERACTIVE_DOCUMENT: ComponentDocument = {
  entry: "home",
  screens: ["s1"],
  nodes: {
    s1: { tag: "Screen", props: { name: scalar("home") }, children: ["f1", "m1", "e1"] },
    f1: {
      tag: "Field",
      props: { name: scalar("region"), label: scalar("Region") },
      children: [],
    },
    m1: {
      tag: "Modal",
      props: { triggerLabel: scalar("Filter"), title: scalar("Filter") },
      children: [],
    },
    e1: { tag: "Exploder", props: { mode: scalar("boom") }, children: [] },
  },
};

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    kind: "conversation",
    messageId: "turn-1:assistant",
    turnId: "turn-1",
    role: "assistant",
    text: "hello",
    at: 1,
    ...overrides,
  };
}

function patch(stageRevision: number, ops: readonly JsonPatchOperation[]): ServerFrame {
  return { kind: "patch", stageRevision, ops };
}

function renderHookWith(
  transport: TestTransport,
  options: Partial<Parameters<typeof useFacet>[0]> = {},
): ReturnType<typeof renderHook<ReturnType<typeof useFacet>, void>> {
  return renderHook(() =>
    useFacet({
      transport,
      initialStage: EMPTY_STAGE,
      ...options,
    }),
  );
}

function emit(transport: TestTransport, frame: ServerFrame): void {
  act(() => {
    transport.emit(frame);
  });
}

function sourceOf(file: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), "utf8");
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function firstField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('[data-testid="field"]');
  if (field === null) {
    throw new Error("fixture rendered no field");
  }
  return field;
}

function openModal(label: string): void {
  const trigger = [
    ...document.querySelectorAll<HTMLElement>(`[${MODAL_PART_ATTRIBUTE}="trigger"]`),
  ].find((element) => element.textContent === label);
  if (trigger === undefined) {
    throw new Error(`no modal trigger labelled ${label}`);
  }
  fireEvent.click(trigger);
}

function openFrame(): HTMLElement {
  const frame = document.querySelector<HTMLElement>(`[${MODAL_PART_ATTRIBUTE}="frame"]`);
  if (frame === null) {
    throw new Error("fixture has no open modal frame");
  }
  return frame;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("useFacet frame folding", () => {
  it("keeps local foldCount distinct from server stageRevision", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport);

    emit(
      transport,
      patch(7, [{ op: "replace", path: "", value: { document: documentWithText("a"), data: {} } }]),
    );
    emit(
      transport,
      patch(11, [
        {
          op: "replace",
          path: "",
          value: { document: documentWithText("b"), data: { count: 2 } },
        },
      ]),
    );

    expect(view.result.current.transition).toEqual({ foldCount: 2, stageRevision: 11 });
    expect(view.result.current.stage.document).toEqual(documentWithText("b"));
    expect(view.result.current.stage.data).toEqual({ count: 2 });
  });

  it("rejects stale patch revisions instead of merging them", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport);

    emit(
      transport,
      patch(5, [
        { op: "replace", path: "", value: { document: documentWithText("fresh"), data: {} } },
      ]),
    );
    emit(
      transport,
      patch(4, [
        { op: "replace", path: "", value: { document: documentWithText("stale"), data: {} } },
      ]),
    );

    expect(view.result.current.transition).toEqual({ foldCount: 1, stageRevision: 5 });
    expect(view.result.current.stage.document).toEqual(documentWithText("fresh"));
  });

  it("folds a reconnect root replace through the ordinary stage patch path", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport);
    const resynced = { document: documentWithText("rehydrated"), data: { totals: { q1: 42 } } };

    emit(transport, patch(17, [{ op: "replace", path: "", value: resynced }]));
    emit(transport, message({ messageId: "turn-2:assistant", turnId: "turn-2" }));
    emit(transport, message({ messageId: "turn-2:assistant", turnId: "turn-2" }));

    expect(view.result.current.stage).toEqual(resynced);
    expect(view.result.current.transition).toEqual({ foldCount: 1, stageRevision: 17 });
    expect(view.result.current.conversation.map((item) => item.messageId)).toEqual([
      "turn-2:assistant",
    ]);
  });

  it("has no reset or snapshot branch that clears conversation", () => {
    const source = sourceOf("useFacet.ts");

    expect(source).not.toContain("setChat");
    expect(source).not.toContain('kind === "reset"');
    expect(source).not.toContain('kind === "snapshot"');
  });
});

describe("useFacet conversation and sends", () => {
  it("collapses redelivered conversation frames by messageId", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport);

    emit(transport, message({ messageId: "turn-1:assistant", text: "first" }));
    emit(transport, message({ messageId: "turn-1:assistant", text: "different duplicate" }));
    emit(transport, message({ messageId: "turn-2:assistant", turnId: "turn-2", text: "second" }));

    expect(view.result.current.conversation.map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("stamps only eventId and stageRevision onto renderer events", () => {
    const transport = new TestTransport();
    const sent: VisitorEvent[] = [];
    const ids = ["event-a", "event-b"];
    const view = renderHookWith(transport, {
      onVisitorEvent: (event) => {
        sent.push(event);
      },
      createEventId: () => ids.shift() ?? "event-extra",
    });

    emit(
      transport,
      patch(9, [
        { op: "replace", path: "", value: { document: documentWithText("ready"), data: {} } },
      ]),
    );
    act(() => {
      view.result.current.sendEvent({
        eventName: "pick",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
      view.result.current.sendEvent({
        eventName: "pick",
        sourceNodeId: "button_2",
        screen: "home",
        arg: "north",
        collect: { region: { kind: "value", value: "EMEA" } },
      });
    });

    expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
      "collect",
      "eventId",
      "eventName",
      "screen",
      "sourceNodeId",
      "stageRevision",
    ]);
    expect("arg" in (sent[0] ?? {})).toBe(false);
    expect(sent[0]).toMatchObject({ eventId: "event-a", stageRevision: 9 });
    expect(Object.keys(sent[1] ?? {}).sort()).toEqual([
      "arg",
      "collect",
      "eventId",
      "eventName",
      "screen",
      "sourceNodeId",
      "stageRevision",
    ]);
    expect(sent[1]?.arg).toBe("north");
  });

  it("surfaces a turn in flight as pending until a server frame settles it", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorEvent: () => {},
      createEventId: () => "event-1",
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
    });
    expect(view.result.current.pending).toBe(true);

    emit(transport, message({ messageId: "event-1:assistant", turnId: "event-1" }));
    expect(view.result.current.pending).toBe(false);
  });

  it("clears pending after a void callback even when the turn is patch-only", async () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorEvent: () => {},
      createEventId: () => "event-1",
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
    });
    emit(
      transport,
      patch(1, [{ op: "replace", path: "", value: { document: documentWithText("a"), data: {} } }]),
    );
    expect(view.result.current.pending).toBe(true);

    await act(async () => {
      await nextTick();
    });

    expect(view.result.current.pending).toBe(false);
  });

  it("clears pending when async visitor event sending completes", async () => {
    const transport = new TestTransport();
    let completeSend: (() => void) | undefined;
    const sent = new Promise<void>((resolve) => {
      completeSend = resolve;
    });
    const view = renderHookWith(transport, {
      onVisitorEvent: () => sent,
      createEventId: () => "event-1",
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
    });
    expect(view.result.current.pending).toBe(true);

    await act(async () => {
      if (completeSend === undefined) {
        throw new Error("send promise was not created");
      }
      completeSend();
      await sent;
      await Promise.resolve();
    });

    expect(view.result.current.pending).toBe(false);
  });

  it("does not clear pending for a patch frame that has no turn identity", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorEvent: () => {},
      createEventId: () => "event-1",
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
    });
    emit(
      transport,
      patch(1, [{ op: "replace", path: "", value: { document: documentWithText("a"), data: {} } }]),
    );

    expect(view.result.current.pending).toBe(true);

    emit(transport, message({ messageId: "event-1:assistant", turnId: "event-1" }));
    expect(view.result.current.pending).toBe(false);
  });

  it("clears pending when visitor event sending fails", async () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorEvent: () => Promise.reject(new Error("offline")),
    });

    await act(async () => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
      await Promise.resolve();
    });

    expect(view.result.current.pending).toBe(false);
  });

  it("clears pending when visitor event sending throws synchronously", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorEvent: () => {
        throw new Error("offline");
      },
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
    });

    expect(view.result.current.pending).toBe(false);
  });

  it("clears pending when visitor message sending fails", async () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      onVisitorMessage: () => Promise.reject(new Error("offline")),
      createMessageId: () => "visitor-turn",
      now: () => 123,
    });

    await act(async () => {
      view.result.current.sendMessage("hello");
      await Promise.resolve();
    });

    expect(view.result.current.pending).toBe(false);
    expect(view.result.current.conversation.map((item) => item.messageId)).toEqual([
      "visitor-turn:visitor",
    ]);
  });

  it("keeps pending when a later send fails while an earlier turn is unresolved", async () => {
    const transport = new TestTransport();
    const ids = ["event-a", "event-b"];
    const view = renderHookWith(transport, {
      onVisitorEvent: (event) =>
        event.eventId === "event-a"
          ? new Promise<void>(() => {})
          : Promise.reject(new Error("offline")),
      createEventId: () => ids.shift() ?? "event-extra",
    });

    await act(async () => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_2",
        screen: "home",
        collect: {},
      });
      await Promise.resolve();
    });

    expect(view.result.current.pending).toBe(true);

    emit(
      transport,
      message({ messageId: "event-a:assistant", turnId: "event-a", text: "first done" }),
    );
    expect(view.result.current.pending).toBe(false);
  });

  it("does not count one turn's patch and conversation as two pending settlements", () => {
    const transport = new TestTransport();
    const ids = ["event-a", "event-b"];
    const view = renderHookWith(transport, {
      onVisitorEvent: () => {},
      createEventId: () => ids.shift() ?? "event-extra",
    });

    act(() => {
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_1",
        screen: "home",
        collect: {},
      });
      view.result.current.sendEvent({
        eventName: "refresh",
        sourceNodeId: "button_2",
        screen: "home",
        collect: {},
      });
    });

    emit(
      transport,
      patch(1, [{ op: "replace", path: "", value: { document: documentWithText("a"), data: {} } }]),
    );
    expect(view.result.current.pending).toBe(true);

    emit(
      transport,
      message({ messageId: "event-a:assistant", turnId: "event-a", text: "first done" }),
    );
    expect(view.result.current.pending).toBe(true);

    emit(
      transport,
      message({ messageId: "event-b:assistant", turnId: "event-b", text: "second done" }),
    );
    expect(view.result.current.pending).toBe(false);
  });

  it("rejects visitor text past B-25 before starting a turn", () => {
    const transport = new TestTransport();
    const sent: ConversationMessage[] = [];
    const view = renderHookWith(transport, {
      onVisitorMessage: (entry) => {
        sent.push(entry);
      },
      createMessageId: () => "visitor-turn",
      now: () => 123,
    });

    act(() => {
      view.result.current.sendMessage("x".repeat(BOUNDS.conversationMessageChars + 1));
    });

    expect(sent).toEqual([]);
    expect(view.result.current.pending).toBe(false);
    expect(view.result.current.conversation).toEqual([]);
    expect(view.result.current.validationError).toBe(
      NEUTRAL_COPY_DEFAULTS.validation.messageTooLong,
    );
  });

  it("accepts a visitor message at B-25 and records it by messageId", () => {
    const transport = new TestTransport();
    const sent: ConversationMessage[] = [];
    const view = renderHookWith(transport, {
      onVisitorMessage: (entry) => {
        sent.push(entry);
      },
      createMessageId: () => "visitor-turn",
      now: () => 123,
    });

    act(() => {
      view.result.current.sendMessage("x".repeat(BOUNDS.conversationMessageChars));
    });

    expect(sent).toEqual([
      {
        kind: "conversation",
        messageId: "visitor-turn:visitor",
        turnId: "visitor-turn",
        role: "visitor",
        text: "x".repeat(BOUNDS.conversationMessageChars),
        at: 123,
      },
    ]);
    expect(view.result.current.pending).toBe(true);
    expect(view.result.current.validationError).toBeUndefined();
    expect(view.result.current.conversation.map((item) => item.messageId)).toEqual([
      "visitor-turn:visitor",
    ]);
  });

  it("uses the resolved host validation copy", () => {
    const transport = new TestTransport();
    const view = renderHookWith(transport, {
      copy: {
        ...NEUTRAL_COPY_DEFAULTS,
        validation: { messageTooLong: "Shorten this note." },
      },
    });

    act(() => {
      view.result.current.sendMessage("x".repeat(BOUNDS.conversationMessageChars + 1));
    });

    expect(view.result.current.validationError).toBe("Shorten this note.");
  });
});

describe("useFacet with StageRenderer", () => {
  it("preserves field state, focus and modal state across unrelated stage updates", () => {
    const transport = new TestTransport();

    function Harness(): ReactNode {
      const facet = useFacet({
        transport,
        initialStage: { document: INTERACTIVE_DOCUMENT, data: {} },
      });
      return (
        <StageRenderer
          bootstrap={BOOTSTRAP}
          document={facet.stage.document}
          data={facet.stage.data}
          onEvent={facet.sendEvent}
        />
      );
    }

    render(<Harness />);
    fireEvent.change(firstField(), { target: { value: "north" } });
    firstField().focus();
    openModal("Filter");
    expect(openFrame()).not.toBeNull();
    const focused = document.activeElement;
    expect(focused).toBe(openFrame());
    expect(
      document.querySelector('[data-facet-neutral-state="component-unavailable"]'),
    ).not.toBeNull();

    emit(
      transport,
      patch(1, [
        {
          op: "add",
          path: "/document/nodes/t1",
          value: { tag: "Text", props: { value: scalar("Added") }, children: [] },
        },
        {
          op: "replace",
          path: "/document/nodes/s1/children",
          value: ["f1", "m1", "e1", "t1"],
        },
      ]),
    );
    expect(firstField().value).toBe("north");
    expect(document.activeElement).toBe(focused);
    expect(openFrame()).not.toBeNull();
    expect(document.querySelector('[data-testid="exploder"]')).toBeNull();

    emit(transport, patch(2, [{ op: "add", path: "/data/flag", value: "fresh" }]));
    expect(firstField().value).toBe("north");
    expect(document.activeElement).toBe(focused);
    expect(openFrame()).not.toBeNull();

    emit(
      transport,
      patch(3, [
        {
          op: "replace",
          path: "/document/nodes/e1/props/mode",
          value: scalar("safe"),
        },
      ]),
    );
    expect(document.querySelector('[data-testid="exploder"]')?.textContent).toBe("safe");
    expect(firstField().value).toBe("north");
    expect(document.activeElement).toBe(focused);
    expect(openFrame()).not.toBeNull();
  });
});
