import type { ServerFrame } from "@facet/core";

/**
 * The package-private SSE writer for `@facet/server`.
 *
 * Browser and agent channels both write sanitized JSON data frames through this
 * helper. The browser channel may add a `Last-Event-ID` token; the agent channel
 * does not.
 */
export function writeSse(
  out: { write(s: string): void },
  frame: { readonly data: ServerFrame | unknown } | { readonly json: string },
  id?: string,
): void {
  const serialized = "json" in frame ? frame.json : JSON.stringify(frame.data);
  out.write(id === undefined ? `data: ${serialized}\n\n` : `id: ${id}\ndata: ${serialized}\n\n`);
}
