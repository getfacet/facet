import type { ServerMessage } from "./protocol.js";

export type FacetAgentResult =
  | readonly ServerMessage[]
  | Promise<readonly ServerMessage[]>
  | AsyncIterable<readonly ServerMessage[]>;

function isAsyncIterable(
  value: FacetAgentResult,
): value is AsyncIterable<readonly ServerMessage[]> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

export async function* iterateAgentResult(
  result: FacetAgentResult,
): AsyncIterable<readonly ServerMessage[]> {
  if (isAsyncIterable(result)) {
    for await (const batch of result) {
      yield batch;
    }
    return;
  }

  yield await result;
}

export async function collectMessages(result: FacetAgentResult): Promise<readonly ServerMessage[]> {
  const messages: ServerMessage[] = [];
  for await (const batch of iterateAgentResult(result)) {
    for (const message of batch) messages.push(message);
  }
  return messages;
}
