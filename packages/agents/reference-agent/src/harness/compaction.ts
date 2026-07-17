import type { TurnMessage } from "../provider.js";

export interface CompactHistoryMessagesOptions {
  readonly maxChars: number;
  readonly droppedTurnCount?: number;
}

export interface CompactedHistoryMessages {
  readonly messages: readonly TurnMessage[];
  readonly charCount: number;
  readonly droppedTurnCount: number;
  readonly omittedCharCount: number;
  readonly compacted: boolean;
  readonly note?: string;
}

interface SelectedTurns {
  readonly messages: readonly TurnMessage[];
  readonly charCount: number;
  readonly droppedTurnCount: number;
  readonly omittedCharCount: number;
}

export function compactHistoryMessages(
  messages: readonly TurnMessage[],
  options: CompactHistoryMessagesOptions,
): CompactedHistoryMessages {
  const maxChars = safeNonNegativeInteger(options.maxChars);
  const droppedBeforeCompaction = safeNonNegativeInteger(options.droppedTurnCount ?? 0);
  const currentChars = estimateMessagesChars(messages);
  if (currentChars <= maxChars && droppedBeforeCompaction === 0) {
    return historyResult(messages, currentChars, 0, 0, false);
  }

  let selected = selectNewestTurns(messages, maxChars);
  let droppedTurnCount = droppedBeforeCompaction + selected.droppedTurnCount;
  let omittedCharCount = selected.omittedCharCount;
  if (droppedTurnCount === 0 && omittedCharCount === 0) {
    return historyResult(
      selected.messages,
      selected.charCount,
      droppedTurnCount,
      omittedCharCount,
      false,
    );
  }

  let note = compactionNote(droppedTurnCount, omittedCharCount);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const noteMessage = noteTurnMessage(note);
    const noteChars = estimateMessageChars(noteMessage);
    if (noteChars >= maxChars) {
      return noteOnlyResult(messages, noteMessage, maxChars, droppedBeforeCompaction, currentChars);
    }

    selected = selectNewestTurns(messages, maxChars - noteChars);
    droppedTurnCount = droppedBeforeCompaction + selected.droppedTurnCount;
    omittedCharCount = selected.omittedCharCount;
    const nextNote = compactionNote(droppedTurnCount, omittedCharCount);
    if (nextNote === note) {
      const out = [noteMessage, ...selected.messages];
      return {
        messages: out,
        charCount: estimateMessagesChars(out),
        droppedTurnCount,
        omittedCharCount,
        compacted: true,
        note,
      };
    }
    note = nextNote;
  }

  const noteMessage = noteTurnMessage(note);
  const out = [noteMessage, ...selected.messages];
  return historyResult(
    out,
    estimateMessagesChars(out),
    droppedTurnCount,
    omittedCharCount,
    true,
    note,
  );
}

export function estimateMessagesChars(messages: readonly TurnMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageChars(message);
  return total;
}

/**
 * Split an in-turn transcript into step groups. One group is the messages of a
 * single provider step: an `assistant_tools` message plus every `tool_result`
 * that immediately follows it, or a lone `assistant`/`user`/orphan `tool_result`
 * message on its own. Grouping this way guarantees no split ever lands between a
 * tool_use and its tool_results, for BOTH provider wire formats.
 */
export function groupTranscriptSteps(
  messages: readonly TurnMessage[],
): readonly (readonly TurnMessage[])[] {
  const groups: TurnMessage[][] = [];
  let current: TurnMessage[] | undefined;
  for (const message of messages) {
    if (message.role === "assistant_tools") {
      current = [message];
      groups.push(current);
    } else if (message.role === "tool_result" && current !== undefined) {
      current.push(message);
    } else {
      current = undefined;
      groups.push([message]);
    }
  }
  return groups;
}

/**
 * Split at a group boundary that never orphans a pair: keep the last `keepGroups`
 * step groups verbatim and return the older groups as `compactable`. Both slices
 * are self-contained, pair-safe message sequences that concatenate back to the
 * input in order.
 */
export function splitStepGroups(
  messages: readonly TurnMessage[],
  keepGroups: number,
): { readonly compactable: readonly TurnMessage[]; readonly verbatim: readonly TurnMessage[] } {
  const groups = groupTranscriptSteps(messages);
  const keep = clampKeepGroups(keepGroups, groups.length);
  const cut = groups.length - keep;
  return {
    compactable: groups.slice(0, cut).flat(),
    verbatim: groups.slice(cut).flat(),
  };
}

function clampKeepGroups(keepGroups: number, groupCount: number): number {
  if (!Number.isFinite(keepGroups) || keepGroups <= 0) return 0;
  return Math.min(groupCount, Math.floor(keepGroups));
}

function selectNewestTurns(messages: readonly TurnMessage[], maxChars: number): SelectedTurns {
  if (maxChars <= 0) {
    return {
      messages: [],
      charCount: 0,
      droppedTurnCount: turnCount(messages),
      omittedCharCount: estimateMessagesChars(messages),
    };
  }

  const turns = groupTurns(messages);
  const kept: TurnMessage[][] = [];
  let usedChars = 0;
  let droppedTurnCount = 0;
  let omittedCharCount = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index] ?? [];
    const turnChars = estimateMessagesChars(turn);
    if (usedChars + turnChars <= maxChars) {
      kept.push([...turn]);
      usedChars += turnChars;
      continue;
    }

    if (kept.length === 0 && maxChars > usedChars) {
      const fitted = fitMessagesToChars(turn, maxChars - usedChars);
      const fittedChars = estimateMessagesChars(fitted);
      if (fitted.length > 0) {
        kept.push([...fitted]);
        usedChars += fittedChars;
        omittedCharCount += Math.max(0, turnChars - fittedChars);
      } else {
        droppedTurnCount += 1;
        omittedCharCount += turnChars;
      }
    } else {
      droppedTurnCount += 1;
      omittedCharCount += turnChars;
    }

    for (let older = index - 1; older >= 0; older -= 1) {
      const olderTurn = turns[older] ?? [];
      droppedTurnCount += 1;
      omittedCharCount += estimateMessagesChars(olderTurn);
    }
    break;
  }

  const selectedMessages = kept.reverse().flat();
  return {
    messages: selectedMessages,
    charCount: usedChars,
    droppedTurnCount,
    omittedCharCount,
  };
}

function historyResult(
  messages: readonly TurnMessage[],
  charCount: number,
  droppedTurnCount: number,
  omittedCharCount: number,
  compacted: boolean,
  note?: string,
): CompactedHistoryMessages {
  return {
    messages,
    charCount,
    droppedTurnCount,
    omittedCharCount,
    compacted,
    ...(note !== undefined ? { note } : {}),
  };
}

function noteOnlyResult(
  messages: readonly TurnMessage[],
  noteMessage: TurnMessage,
  maxChars: number,
  droppedBeforeCompaction: number,
  currentChars: number,
): CompactedHistoryMessages {
  const fittedNote = fitMessageToChars(noteMessage, maxChars);
  const noteMessages = fittedNote === undefined ? [] : [fittedNote];
  return historyResult(
    noteMessages,
    estimateMessagesChars(noteMessages),
    droppedBeforeCompaction + turnCount(messages),
    currentChars,
    true,
    fittedNote !== undefined ? messageText(fittedNote) : undefined,
  );
}

function noteTurnMessage(note: string): TurnMessage {
  return { role: "user", content: note };
}

function groupTurns(messages: readonly TurnMessage[]): readonly (readonly TurnMessage[])[] {
  const turns: TurnMessage[][] = [];
  for (let index = 0; index < messages.length; index += 2) {
    turns.push(messages.slice(index, index + 2));
  }
  return turns;
}

function fitMessagesToChars(
  messages: readonly TurnMessage[],
  maxChars: number,
): readonly TurnMessage[] {
  const out: TurnMessage[] = [];
  let remaining = maxChars;
  for (const message of messages) {
    const fullChars = estimateMessageChars(message);
    if (fullChars <= remaining) {
      out.push(message);
      remaining -= fullChars;
      continue;
    }

    const fitted = fitMessageToChars(message, remaining);
    if (fitted !== undefined) out.push(fitted);
    break;
  }
  return out;
}

function fitMessageToChars(message: TurnMessage, maxChars: number): TurnMessage | undefined {
  const emptyChars = estimateMessageChars(rewriteMessageText(message, ""));
  const textBudget = maxChars - emptyChars;
  if (textBudget <= 0) return undefined;
  return rewriteMessageText(message, truncateText(messageText(message), textBudget));
}

function rewriteMessageText(message: TurnMessage, text: string): TurnMessage {
  switch (message.role) {
    case "user":
      return { role: "user", content: text };
    case "assistant":
      return { role: "assistant", content: text };
    case "tool_result":
      return { role: "tool_result", callId: message.callId, content: text };
    case "assistant_tools":
      return { role: "assistant_tools", text, toolCalls: message.toolCalls };
  }
}

function estimateMessageChars(message: TurnMessage): number {
  switch (message.role) {
    case "user":
    case "assistant":
      return `${message.role}: ${message.content}\n`.length;
    case "tool_result":
      return `${message.role} ${message.callId}: ${message.content}\n`.length;
    case "assistant_tools":
      return `${message.role}: ${message.text}\n${safeJson(message.toolCalls)}\n`.length;
  }
}

function messageText(message: TurnMessage): string {
  switch (message.role) {
    case "user":
    case "assistant":
      return message.content;
    case "tool_result":
      return message.content;
    case "assistant_tools":
      return message.text;
  }
}

/** Truncated text plus how many source chars the marker stands in for. */
export interface TruncatedText {
  readonly content: string;
  readonly omittedChars: number;
}

/**
 * The ONE truncation-with-marker implementation shared by history compaction,
 * summary field caps, and observation bounding. The marker's exact literal is a
 * cross-file contract (`MIN_REFERENCE_AGENT_OBSERVATION_CHARS` derives from it).
 */
export function truncateWithMarker(value: string, maxChars: number): TruncatedText {
  if (value.length <= maxChars) return { content: value, omittedChars: 0 };
  if (maxChars <= 0) return { content: "", omittedChars: value.length };

  let omitted = value.length;
  let marker = truncatedMarker(omitted);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const prefixChars = Math.max(0, maxChars - marker.length);
    omitted = value.length - prefixChars;
    const next = truncatedMarker(omitted);
    if (next === marker) {
      return marker.length > maxChars
        ? { content: marker.slice(0, maxChars), omittedChars: value.length }
        : { content: `${value.slice(0, prefixChars)}${marker}`, omittedChars: omitted };
    }
    marker = next;
  }
  return marker.length > maxChars
    ? { content: marker.slice(0, maxChars), omittedChars: value.length }
    : {
        content: `${value.slice(0, maxChars - marker.length)}${marker}`,
        omittedChars: value.length - (maxChars - marker.length),
      };
}

function truncateText(value: string, maxChars: number): string {
  return truncateWithMarker(value, maxChars).content;
}

export function truncatedMarker(omittedChars: number): string {
  return `[truncated: ${String(Math.max(0, omittedChars))} chars omitted]`;
}

function compactionNote(droppedTurnCount: number, omittedCharCount: number): string {
  return `[history compacted: dropped ${String(droppedTurnCount)} older turn(s); ${String(
    omittedCharCount,
  )} chars omitted]`;
}

function turnCount(messages: readonly TurnMessage[]): number {
  return Math.ceil(messages.length / 2);
}

function safeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}
