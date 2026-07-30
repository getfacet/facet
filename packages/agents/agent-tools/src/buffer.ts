import { parseMarkup } from "@facet/core";

export interface MarkupBufferOutcome {
  readonly ready: readonly string[];
  readonly pending: string;
}

export interface MarkupBuffer {
  append(chunk: string): MarkupBufferOutcome;
  pending(): string;
}

function outcome(ready: readonly string[], pending: string): MarkupBufferOutcome {
  return Object.freeze({ ready: Object.freeze([...ready]), pending });
}

export function createMarkupBuffer(): MarkupBuffer {
  let buffered = "";
  return {
    append(chunk: string): MarkupBufferOutcome {
      buffered += chunk;
      if (!parseMarkup(buffered).ok) {
        return outcome([], buffered);
      }
      const ready = buffered;
      buffered = "";
      return outcome([ready], buffered);
    },
    pending(): string {
      return buffered;
    },
  };
}
