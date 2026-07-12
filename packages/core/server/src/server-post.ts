import type { IncomingMessage, ServerResponse } from "node:http";
import type { TurnResult } from "@facet/runtime";
import type { AgentChannel } from "./agent-channel.js";
import { isStaleLateResult, type LateWindow } from "./late.js";
import { isControlBody, isEventBody, isRecordBody, readJson } from "./server-validation.js";
import {
  addHandlingTurn,
  handlingTurnHasFrames,
  removeHandlingTurn,
  type HandlingTurn,
  type PostHandlerDeps,
} from "./server-rehydrate.js";

/** POST /event: shape-check the untrusted body, ack 202, then run the turn on the
 * visitor's lane — {apply → deliver} — with a per-visitor arrival index stamped at
 * arrival so a late result can detect a newer turn that already applied. */
export function handleEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PostHandlerDeps,
): void {
  const { lane, runtime, frameLog, deliver, handling } = deps;
  readJson(req)
    .then((body) => {
      if (!isEventBody(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      const { visitor, event } = body;
      res.writeHead(202);
      res.end();
      // Stamp a per-visitor arrival {index, era} pair NOW (the true order, before
      // any lane hop), so a late result can detect a newer turn that already
      // applied. The pair is atomic: an index paired with a later re-minted era
      // could false-pass the staleness check.
      const arrival = frameLog.nextArrival(visitor.visitorId);
      // One lane task per turn: {apply → deliver}. `deliver` assigns seqs and
      // fans out synchronously, so this visitor's frames can't cross or reorder
      // (a late apply for the same visitor enqueues behind this task).
      void lane(visitor.visitorId, async () => {
        // Tag the in-flight turn so a timed-out park picks up this arrival pair
        // (kept in a server-local map, NOT on the LRU-evictable log entry).
        const turn: HandlingTurn = {
          ...arrival,
          streamStartSeq: frameLog.logFor(visitor.visitorId).nextSeq,
        };
        addHandlingTurn(handling, visitor.visitorId, turn);
        let recordSettled: Promise<void> | undefined;
        let result: TurnResult = { messages: [], agentMutated: false };
        try {
          result = await runtime.handle(
            visitor,
            event,
            (messages) => deliver(visitor.visitorId, messages),
            (settled) => {
              recordSettled = settled;
            },
          );
        } catch (error) {
          // Don't leave the visitor staring at a 202 that went nowhere.
          console.error("[facet] handle failed:", error);
          result = {
            messages: [{ kind: "say", text: "(the agent hit an error — try again)" }],
            agentMutated: false,
          };
          deliver(visitor.visitorId, result.messages);
        } finally {
          // Advance lastApplied only if the AGENT'S OWN turn mutated the stage. A
          // say-only turn, an interim-timeout note, a failed handle, and a turn
          // that merely re-emits a parked seed frame all leave the stage
          // untouched, so an older parked patch can still safely apply after them
          // — bumping lastApplied there would falsely mark it stale. (Gate on the
          // runtime's pre-seed `agentMutated`, not the delivered list, since the
          // seed frame is a patch that mutated nothing.)
          if (result.agentMutated)
            frameLog.recordApplied(visitor.visitorId, arrival.index, arrival.era);
          turn.streamEndSeq = frameLog.logFor(visitor.visitorId).nextSeq - 1;
          const removeTurn = (): void => removeHandlingTurn(handling, visitor.visitorId, turn);
          if (recordSettled === undefined || !handlingTurnHasFrames(turn)) {
            removeTurn();
          } else {
            void recordSettled.finally(removeTurn);
          }
        }
      });
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}

/** POST /record: shape-check the untrusted body, ack 202, then persist the collected
 * LOCAL tap on the visitor's SAME serial lane as /event — via `runtime.record`, which
 * writes to the Sink WITHOUT invoking the agent and WITHOUT producing a stage patch.
 * Riding the shared lane keeps a record's Sink append order behind any in-flight
 * /event turn for that visitor (send order == append order). A malformed body is
 * 400'd with NO Sink write. Deliberately NEVER calls `runtime.handle`/`deliver`. */
export function handleRecord(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PostHandlerDeps,
): void {
  const { lane, runtime } = deps;
  readJson(req)
    .then((body) => {
      if (!isRecordBody(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      const { visitor, event } = body;
      res.writeHead(202);
      res.end();
      // Same per-visitor lane as /event so `runtime.record` is CALLED in lane/arrival
      // order — its slot on the runtime's serializeRecord queue is reserved
      // SYNCHRONOUSLY at call time, so append order is fixed the instant the lane task
      // runs. We must NOT await it: the returned promise resolves only after the async
      // Sink write, and awaiting it on the SHARED lane would let a slow/hung sink wedge
      // this visitor's subsequent /event turns (head-of-line blocking). Fire-and-forget
      // — `runtime.record` never rejects (it logs a sink failure internally) — so the
      // lane task returns immediately after the synchronous reservation, order preserved.
      void lane(visitor.visitorId, async () => {
        void runtime.record(visitor, event);
      });
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}

/** POST /agent/control: shape-check the body, then settle the still-waiting turn
 * in-time via the channel, or re-inject a parked (timed-out/dropped) turn on its
 * lane. Always answers 202 — a miss (evicted/unknown requestId) is a bounded no-op. */
export function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  channel: AgentChannel,
  lateWindow: LateWindow,
  deps: PostHandlerDeps,
): void {
  const { lane, runtime, frameLog, deliver, handling } = deps;
  readJson(req)
    .then((body) => {
      if (!isControlBody(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      const { requestId, messages } = body;
      // In-time: the channel settles the still-waiting turn (its lane task applies
      // + delivers). Otherwise the turn timed out or its agent dropped — check the
      // late window.
      if (!channel.resolve(requestId, messages)) {
        const late = lateWindow.take(requestId);
        if (late !== undefined) {
          // Late: re-inject through the runtime and deliver, on the SAME per-visitor
          // lane as live turns so it can't race one for that visitor.
          const parked = { era: late.era, index: late.index };
          void lane(late.visitor.visitorId, async () => {
            const turn: HandlingTurn = {
              ...parked,
              streamStartSeq: frameLog.logFor(late.visitor.visitorId).nextSeq,
            };
            addHandlingTurn(handling, late.visitor.visitorId, turn);
            let recordSettled: Promise<void> | undefined;
            try {
              // If a NEWER turn already mutated this visitor's stage (or the frame
              // log was re-minted since the park), this late result's stage
              // mutation is stale — applying it (Stage `render` is a root
              // `replace`) would overwrite the newer stage. Drop its patch
              // messages but KEEP its says, so the conversational answer still
              // honors the interim promise without rolling the stage back.
              const stale = isStaleLateResult(parked, frameLog.logFor(late.visitor.visitorId));
              const toApply = stale ? messages.filter((m) => m.kind === "say") : messages;
              const applied = await runtime.applyMessages(
                late.visitor,
                late.event,
                toApply,
                (settled) => {
                  recordSettled = settled;
                },
              );
              deliver(late.visitor.visitorId, applied.messages);
              // Record only a REAL stage mutation (the fold's effect-based flag,
              // mirroring the live path): a late patch whose ops all failed
              // salvage (or an empty batch) must not bump lastApplied, or it
              // would falsely stale an older parked turn's still-valid patch.
              if (!stale && applied.agentMutated) {
                frameLog.recordApplied(late.visitor.visitorId, parked.index, parked.era);
              }
            } catch (error) {
              // Mirror the live path: a store failure here must not leave the
              // visitor waiting forever on the interim "it's coming" note.
              console.error("[facet] late apply failed:", error);
              deliver(late.visitor.visitorId, [
                { kind: "say", text: "(the agent hit an error — try again)" },
              ]);
            } finally {
              turn.streamEndSeq = frameLog.logFor(late.visitor.visitorId).nextSeq - 1;
              const removeTurn = (): void =>
                removeHandlingTurn(handling, late.visitor.visitorId, turn);
              if (recordSettled === undefined || !handlingTurnHasFrames(turn)) {
                removeTurn();
              } else {
                void recordSettled.finally(removeTurn);
              }
            }
          });
        }
        // miss + miss (evicted/unknown requestId): silent 202 no-op — the late
        // guarantee is deliberately bounded (LATE_WINDOW_LIMIT).
      }
      res.writeHead(202);
      res.end();
    })
    .catch(() => {
      res.writeHead(400);
      res.end();
    });
}
