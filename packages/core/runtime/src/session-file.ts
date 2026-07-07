import { join } from "node:path";
import { sessionKey } from "./stage-store.js";

/**
 * On-disk file for a session: the base64url of the session key, one file per
 * `(agent, visitor)`. Shared by the file-backed store and sink so the key→name
 * encoding has a single source. Node-only (`Buffer`).
 */
export function sessionFilePath(
  dir: string,
  agentId: string,
  visitorId: string,
  ext: "json" | "jsonl",
): string {
  const name = Buffer.from(sessionKey(agentId, visitorId)).toString("base64url");
  return join(dir, `${name}.${ext}`);
}
