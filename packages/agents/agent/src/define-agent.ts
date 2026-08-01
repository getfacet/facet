import type { VisitorEvent, FacetToolSession } from "@facet/core";

import { Stage } from "./stage.js";

interface FacetRunContext {
  readonly event: VisitorEvent;
  readonly session: FacetToolSession;
}

export interface InProcessFacetAgent {
  run(context: {
    readonly event: VisitorEvent;
    readonly session: FacetToolSession;
  }): Promise<{ readonly text: string | null }>;
}

export interface FacetContext extends FacetRunContext {
  readonly stage: Stage;
}

export type FacetLogic = (ctx: FacetContext) => void | Promise<void>;

export type StreamingFacetLogic = (
  ctx: FacetContext,
) => Iterable<void> | AsyncIterable<void> | Promise<Iterable<void> | AsyncIterable<void>>;

function stageFor(session: FacetToolSession): Stage {
  return new Stage({ session });
}

async function finishStage(
  stage: Stage,
  run: () => Promise<void>,
): Promise<{ readonly text: string | null }> {
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }
  try {
    await stage.drain();
  } catch (error) {
    if (failure === undefined) {
      failure = error;
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
  return stage.flush();
}

export function defineAgent(logic: FacetLogic): InProcessFacetAgent {
  return {
    async run({ event, session }: FacetRunContext) {
      const stage = stageFor(session);
      return finishStage(stage, async () => {
        await logic({ event, session, stage });
      });
    },
  };
}

export function defineStreamingAgent(logic: StreamingFacetLogic): InProcessFacetAgent {
  return {
    async run({ event, session }: FacetRunContext) {
      const stage = stageFor(session);
      return finishStage(stage, async () => {
        const steps = await logic({ event, session, stage });
        for await (const step of steps) {
          void step;
        }
      });
    },
  };
}
