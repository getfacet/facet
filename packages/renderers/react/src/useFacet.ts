/**
 * React hook for the browser side of one Facet session.
 *
 * The transport owns only the server-to-browser stream: `FacetTransport` is a
 * `subscribe(ServerFrame)` contract, not a send contract. Sending is therefore
 * injected as callbacks, which lets the later browser transports choose their
 * POST shape without making `@facet/core` describe a request it cannot validate.
 *
 * Two counters are deliberately separate. `transition.foldCount` is the number
 * of server patch frames this client actually folded. `transition.stageRevision`
 * is the server-authoritative revision stamped on the last accepted frame and
 * echoed on every outgoing `agent:` event.
 *
 * Visibility: barrel-exported - `useFacet`, `UseFacetResult` only. No other
 * symbol in this module is public.
 */

import {
  applyPatch,
  deriveMessageId,
  NEUTRAL_COPY_DEFAULTS,
  validateVisitorText,
} from "@facet/core";
import type {
  AgentEvent,
  ConversationMessage,
  FacetStage,
  FacetTransport,
  NeutralCopy,
  StageRevision,
} from "@facet/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConversationItem } from "./ConversationSurface.js";

type RendererEvent = {
  readonly eventName: string;
  readonly sourceNodeId: string;
  readonly screen: string;
  readonly arg?: string;
  readonly collect: AgentEvent["collect"];
};

interface ConversationState {
  readonly order: readonly string[];
  readonly byId: Readonly<Record<string, ConversationItem>>;
}

interface StageState {
  readonly stage: FacetStage;
  readonly transition: UseFacetResult["transition"];
}

const EMPTY_STAGE: FacetStage = Object.freeze({
  document: null,
  data: Object.freeze({}),
});

const EMPTY_CONVERSATION: ConversationState = Object.freeze({
  order: Object.freeze([]),
  byId: Object.freeze(Object.create(null) as Record<string, ConversationItem>),
});

const INITIAL_TRANSITION = Object.freeze({
  foldCount: 0,
  stageRevision: 0,
});

function addConversation(
  state: ConversationState,
  message: ConversationMessage,
): ConversationState {
  if (
    typeof message.messageId !== "string" ||
    message.messageId.length === 0 ||
    typeof message.text !== "string" ||
    (message.role !== "visitor" && message.role !== "assistant")
  ) {
    return state;
  }
  if (Object.prototype.hasOwnProperty.call(state.byId, message.messageId)) {
    return state;
  }
  return {
    order: [...state.order, message.messageId],
    byId: Object.freeze({
      ...state.byId,
      [message.messageId]: {
        messageId: message.messageId,
        role: message.role,
        text: message.text,
      },
    }),
  };
}

function conversationItems(state: ConversationState): readonly ConversationItem[] {
  return state.order.flatMap((messageId) => {
    const item = state.byId[messageId];
    return item === undefined ? [] : [item];
  });
}

/**
 * The complete state a host needs to render one browser session.
 *
 * `sendEvent` accepts exactly the event object `StageRenderer` produces and
 * stamps only the two browser-owned fields before handing it to the caller's
 * send callback. `sendMessage` validates `B-25` locally and surfaces the
 * resolved validation copy instead of occupying the turn gate.
 */
export interface UseFacetResult {
  readonly stage: FacetStage;
  readonly conversation: readonly ConversationItem[];
  readonly transition: {
    readonly foldCount: number;
    readonly stageRevision: StageRevision;
  };
  readonly pending: boolean;
  readonly validationError?: string | undefined;
  readonly sendEvent: (event: RendererEvent) => void;
  readonly sendMessage: (text: string) => void;
}

export function useFacet(options: {
  readonly transport: FacetTransport;
  readonly initialStage?: FacetStage;
  readonly copy?: NeutralCopy;
  readonly onAgentEvent?: (event: AgentEvent) => void;
  readonly onVisitorMessage?: (message: ConversationMessage) => void;
  readonly createEventId?: () => string;
  readonly createMessageId?: () => string;
  readonly now?: () => number;
}): UseFacetResult {
  const {
    transport,
    initialStage = EMPTY_STAGE,
    copy = NEUTRAL_COPY_DEFAULTS,
    onAgentEvent,
    onVisitorMessage,
    createEventId,
    createMessageId,
    now,
  } = options;
  const localId = useRef(0);
  const [stageState, setStageState] = useState<StageState>({
    stage: initialStage,
    transition: INITIAL_TRANSITION,
  });
  const [conversation, setConversation] = useState<ConversationState>(EMPTY_CONVERSATION);
  const [pending, setPending] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  const nextId = useCallback((configured: (() => string) | undefined, prefix: string): string => {
    const candidate = configured?.();
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    const random = globalThis.crypto?.randomUUID?.();
    if (typeof random === "string" && random.length > 0) {
      return `${prefix}-${random}`;
    }
    localId.current += 1;
    return `${prefix}-${localId.current}`;
  }, []);

  useEffect(() => {
    return transport.subscribe((frame) => {
      if (frame.kind === "patch") {
        setStageState((current) => {
          if (frame.stageRevision <= current.transition.stageRevision) {
            return current;
          }
          const next = applyPatch(current.stage, frame.ops);
          if (next === current.stage) {
            return current;
          }
          return {
            stage: next,
            transition: {
              foldCount: current.transition.foldCount + 1,
              stageRevision: frame.stageRevision,
            },
          };
        });
        setPending(false);
        return;
      }
      setConversation((current) => addConversation(current, frame));
      setPending(false);
    });
  }, [transport]);

  const sendEvent = useCallback(
    (event: RendererEvent): void => {
      if (onAgentEvent === undefined) {
        return;
      }
      const stamped: AgentEvent = {
        eventId: nextId(createEventId, "event"),
        eventName: event.eventName,
        sourceNodeId: event.sourceNodeId,
        screen: event.screen,
        stageRevision: stageState.transition.stageRevision,
        ...(typeof event.arg === "string" ? { arg: event.arg } : {}),
        collect: event.collect,
      };
      onAgentEvent(stamped);
      setPending(true);
    },
    [createEventId, nextId, onAgentEvent, stageState.transition.stageRevision],
  );

  const sendMessage = useCallback(
    (text: string): void => {
      if (!validateVisitorText(text)) {
        setValidationError(copy.validation.messageTooLong);
        return;
      }
      setValidationError(undefined);
      const turnId = nextId(createMessageId, "visitor");
      const entry: ConversationMessage = {
        kind: "conversation",
        messageId: deriveMessageId(turnId, "visitor"),
        turnId,
        role: "visitor",
        text,
        at: now?.() ?? Date.now(),
      };
      setConversation((current) => addConversation(current, entry));
      if (onVisitorMessage !== undefined) {
        onVisitorMessage(entry);
        setPending(true);
      }
    },
    [copy.validation.messageTooLong, createMessageId, nextId, now, onVisitorMessage],
  );

  const visibleConversation = useMemo(() => conversationItems(conversation), [conversation]);

  return {
    stage: stageState.stage,
    conversation: visibleConversation,
    transition: stageState.transition,
    pending,
    validationError,
    sendEvent,
    sendMessage,
  };
}
