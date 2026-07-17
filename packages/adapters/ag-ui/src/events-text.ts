import { EventType } from "@ag-ui/core";
import { MAX_FIELD_VALUE_CHARS, MAX_FIELDS_KEYS, MAX_PATCH_OPS } from "@facet/core";
import type { ServerMessage } from "@facet/core";

import { agUiEventToServerMessages } from "./events.js";

const MAX_TEXT_BUFFERS = MAX_FIELDS_KEYS;
const MAX_TEXT_PARTS_PER_MESSAGE = MAX_PATCH_OPS;
const MAX_TEXT_CHARS_PER_MESSAGE = MAX_FIELD_VALUE_CHARS * MAX_FIELDS_KEYS;
const MAX_TEXT_TOTAL_CHARS = MAX_TEXT_CHARS_PER_MESSAGE;

interface TextMessageBuffer {
  readonly parts: string[];
  complete: boolean;
  readonly source: "framed" | "chunk";
  chars: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIterableObject(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

export class AgUiServerMessageAccumulator {
  private readonly textBuffers = new Map<string, TextMessageBuffer>();
  private readonly textOrder: string[] = [];
  private readonly droppedTextMessages = new Set<string>();
  private readonly droppedTextOrder: string[] = [];
  private totalTextChars = 0;
  private activeChunkMessageId: string | undefined;

  accept(event: unknown): readonly ServerMessage[] {
    try {
      if (this.handleTextEvent(event)) return this.flushCompletedTextMessages();
      return [...this.flushTextBeforeNonText(), ...agUiEventToServerMessages(event)];
    } catch {
      return [];
    }
  }

  flush(): readonly ServerMessage[] {
    return this.flushFinalTextMessages();
  }

  discard(): void {
    this.textBuffers.clear();
    this.textOrder.length = 0;
    this.droppedTextMessages.clear();
    this.droppedTextOrder.length = 0;
    this.totalTextChars = 0;
    this.activeChunkMessageId = undefined;
  }

  private handleTextEvent(event: unknown): boolean {
    if (!isObject(event)) return false;
    switch (event["type"]) {
      case EventType.TEXT_MESSAGE_START:
        this.startTextMessage(event["messageId"]);
        return true;
      case EventType.TEXT_MESSAGE_CONTENT:
        this.appendTextMessage(event["messageId"], event["delta"]);
        return true;
      case EventType.TEXT_MESSAGE_CHUNK:
        this.appendTextChunk(event["messageId"], event["delta"]);
        return true;
      case EventType.TEXT_MESSAGE_END:
        this.endTextMessage(event["messageId"]);
        return true;
      default:
        return false;
    }
  }

  private startTextMessage(messageId: unknown): void {
    if (typeof messageId !== "string") return;
    if (this.droppedTextMessages.has(messageId)) return;
    if (!this.textBuffers.has(messageId)) this.textOrder.push(messageId);
    this.removeTextMessage(messageId);
    if (this.textOrder.length > MAX_TEXT_BUFFERS) {
      this.dropTextMessage(messageId, true);
      return;
    }
    this.textBuffers.set(messageId, { parts: [], complete: false, source: "framed", chars: 0 });
  }

  private appendTextMessage(messageId: unknown, delta: unknown): void {
    if (typeof messageId !== "string" || typeof delta !== "string") return;
    if (this.droppedTextMessages.has(messageId)) return;
    const buffer = this.textBuffers.get(messageId);
    if (buffer === undefined || buffer.source !== "framed") return;
    this.appendTextPart(messageId, buffer, delta);
  }

  private appendTextChunk(messageId: unknown, delta: unknown): void {
    const id = typeof messageId === "string" ? messageId : this.activeChunkMessageId;
    if (id === undefined) return;
    if (this.droppedTextMessages.has(id)) return;
    this.activeChunkMessageId = id;
    if (typeof delta !== "string") return;
    let buffer = this.textBuffers.get(id);
    if (buffer === undefined) {
      this.textOrder.push(id);
      if (this.textOrder.length > MAX_TEXT_BUFFERS) {
        this.dropTextMessage(id, true);
        return;
      }
      buffer = { parts: [], complete: false, source: "chunk", chars: 0 };
      this.textBuffers.set(id, buffer);
    }
    if (buffer.source !== "chunk") return;
    this.appendTextPart(id, buffer, delta);
  }

  private endTextMessage(messageId: unknown): void {
    if (typeof messageId !== "string") return;
    if (this.droppedTextMessages.has(messageId)) return;
    const buffer = this.textBuffers.get(messageId);
    if (buffer === undefined || buffer.source !== "framed") return;
    buffer.complete = true;
  }

  private appendTextPart(messageId: string, buffer: TextMessageBuffer, delta: string): void {
    if (
      delta.length > MAX_TEXT_CHARS_PER_MESSAGE ||
      buffer.parts.length >= MAX_TEXT_PARTS_PER_MESSAGE ||
      buffer.chars + delta.length > MAX_TEXT_CHARS_PER_MESSAGE ||
      this.totalTextChars + delta.length > MAX_TEXT_TOTAL_CHARS
    ) {
      this.dropTextMessage(messageId, true);
      return;
    }
    buffer.parts.push(delta);
    buffer.chars += delta.length;
    this.totalTextChars += delta.length;
  }

  private dropTextMessage(messageId: string, remember: boolean = false): void {
    this.removeTextMessage(messageId);
    const index = this.textOrder.indexOf(messageId);
    if (index !== -1) this.textOrder.splice(index, 1);
    if (remember) this.rememberDroppedTextMessage(messageId);
  }

  private rememberDroppedTextMessage(messageId: string): void {
    if (this.droppedTextMessages.has(messageId)) return;
    this.droppedTextMessages.add(messageId);
    this.droppedTextOrder.push(messageId);
    if (this.droppedTextOrder.length > MAX_TEXT_BUFFERS) {
      const oldest = this.droppedTextOrder.shift();
      if (oldest !== undefined) this.droppedTextMessages.delete(oldest);
    }
  }

  private removeTextMessage(messageId: string): TextMessageBuffer | undefined {
    const buffer = this.textBuffers.get(messageId);
    if (buffer === undefined) return undefined;
    this.textBuffers.delete(messageId);
    this.totalTextChars = Math.max(0, this.totalTextChars - buffer.chars);
    if (this.activeChunkMessageId === messageId) this.activeChunkMessageId = undefined;
    return buffer;
  }

  private flushCompletedTextMessages(discardIncomplete: boolean = false): readonly ServerMessage[] {
    const messages: ServerMessage[] = [];
    while (this.textOrder.length > 0) {
      const messageId = this.textOrder[0];
      if (messageId === undefined) return messages;
      const buffer = this.textBuffers.get(messageId);
      if (buffer === undefined) {
        this.textOrder.shift();
        continue;
      }
      if (!buffer.complete) {
        if (!discardIncomplete) return messages;
        this.textOrder.shift();
        this.removeTextMessage(messageId);
        continue;
      }
      this.textOrder.shift();
      this.removeTextMessage(messageId);
      messages.push({ kind: "say", text: buffer.parts.join("") });
    }
    return messages;
  }

  private flushTextBeforeNonText(): readonly ServerMessage[] {
    const messages: ServerMessage[] = [];
    while (this.textOrder.length > 0) {
      const messageId = this.textOrder[0];
      if (messageId === undefined) break;
      const buffer = this.textBuffers.get(messageId);
      if (buffer === undefined) {
        this.textOrder.shift();
        continue;
      }
      if (buffer.source === "chunk") {
        this.textOrder.shift();
        this.removeTextMessage(messageId);
        if (buffer.parts.length > 0) messages.push({ kind: "say", text: buffer.parts.join("") });
        continue;
      }
      if (buffer.complete) {
        this.textOrder.shift();
        this.removeTextMessage(messageId);
        messages.push({ kind: "say", text: buffer.parts.join("") });
        continue;
      }
      if (!this.hasLaterDeliverableText()) break;
      this.textOrder.shift();
      this.removeTextMessage(messageId);
    }
    this.activeChunkMessageId = undefined;
    return messages;
  }

  private flushFinalTextMessages(): readonly ServerMessage[] {
    const messages: ServerMessage[] = [];
    for (const messageId of this.textOrder) {
      const buffer = this.textBuffers.get(messageId);
      if (buffer === undefined) continue;
      if (buffer.source === "chunk") {
        if (buffer.parts.length > 0) messages.push({ kind: "say", text: buffer.parts.join("") });
        continue;
      }
      if (buffer.complete) messages.push({ kind: "say", text: buffer.parts.join("") });
    }
    this.textBuffers.clear();
    this.textOrder.length = 0;
    this.droppedTextMessages.clear();
    this.droppedTextOrder.length = 0;
    this.totalTextChars = 0;
    this.activeChunkMessageId = undefined;
    return messages;
  }

  private hasLaterDeliverableText(): boolean {
    for (let index = 1; index < this.textOrder.length; index += 1) {
      const messageId = this.textOrder[index];
      if (messageId === undefined) continue;
      const buffer = this.textBuffers.get(messageId);
      if (buffer?.source === "chunk" && buffer.parts.length > 0) return true;
      if (buffer?.source === "framed" && buffer.complete) return true;
    }
    return false;
  }
}

export function agUiEventsToServerMessages(events: unknown): readonly ServerMessage[] {
  if (!isIterableObject(events)) return [];
  const accumulator = new AgUiServerMessageAccumulator();
  const messages: ServerMessage[] = [];
  try {
    for (const event of events) {
      messages.push(...accumulator.accept(event));
    }
    messages.push(...accumulator.flush());
    return messages;
  } catch {
    accumulator.discard();
    return [];
  }
}
