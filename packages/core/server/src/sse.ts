/**
 * The single SSE `data:`-frame writer for `@facet/server`. Both the browser and the
 * agent channels emit their frames through here so the wire shape can't drift.
 *
 * Emits `data: <payload>\n\n`, prefixed with an `id: <id>\n` line ONLY when an `id`
 * is given (the browser channel stamps `<era>:<seq>` for `Last-Event-ID` resume; the
 * agent channel and the full-rehydrate reset frame pass none). The payload is either
 * `{ data }` — JSON-serialized here — or `{ json }` — written verbatim, the replay
 * path that re-emits a logged frame's exact serialized JSON. Internal to the package
 * (not part of the public barrel).
 */
export function writeSse(
  out: { write(s: string): void },
  frame: { data: unknown } | { json: string },
  id?: string,
): void {
  const serialized = "json" in frame ? frame.json : JSON.stringify(frame.data);
  const payload = `data: ${serialized}\n\n`;
  out.write(id !== undefined ? `id: ${id}\n${payload}` : payload);
}
