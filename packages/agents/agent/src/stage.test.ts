import { readFileSync } from "node:fs";

import type {
  AgentEvent,
  AuthorValidationResult,
  ComponentDocument,
  DataPath,
  FacetTargetedMutationInput,
  FacetTargetedMutationResult,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";
import { describe, expect, it } from "vitest";

import { Stage } from "./stage.js";
import * as agent from "./index.js";

const STAGE_SOURCE = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
const INDEX_SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

const DOCUMENT: ComponentDocument = Object.freeze({
  entry: "home",
  screens: Object.freeze(["n1"]),
  nodes: Object.freeze({
    n1: Object.freeze({
      tag: "Screen",
      props: Object.freeze({ name: Object.freeze({ kind: "scalar" as const, value: "home" }) }),
      children: Object.freeze([]),
    }),
  }),
});

class StubSession implements FacetToolSession {
  readonly catalog: FacetToolSession["catalog"] = Object.freeze({ components: Object.freeze([]) });
  document: ComponentDocument | null = null;
  data: FacetToolSession["data"] = Object.freeze({});
  stageRevision: FacetToolSession["stageRevision"] = 2;
  readonly rendered: string[] = [];
  readonly published: { readonly path: DataPath; readonly value: unknown }[] = [];

  async applyAuthorMutation(markup: string): Promise<AuthorValidationResult> {
    this.rendered.push(markup);
    this.document = DOCUMENT;
    this.stageRevision = 3;
    return { ok: true, document: DOCUMENT };
  }

  async applyTargetedMutation(
    _input: FacetTargetedMutationInput,
  ): Promise<FacetTargetedMutationResult> {
    return { ok: true, document: DOCUMENT };
  }

  async publishData(path: DataPath, value: unknown): Promise<PayloadEvaluation> {
    this.published.push({ path, value });
    this.data = Object.freeze({ [path.join(".")]: value });
    this.stageRevision = 3;
    return { ok: true, chars: JSON.stringify(value).length };
  }
}

class FailingSession extends StubSession {
  override async applyAuthorMutation(): Promise<AuthorValidationResult> {
    throw new Error("render failed");
  }
}

const EVENT: AgentEvent = Object.freeze({
  eventId: "event1",
  eventName: "refresh",
  sourceNodeId: "n1",
  screen: "home",
  stageRevision: 2,
  collect: Object.freeze({}),
});

describe("Stage greenfield API", () => {
  it("renders through the session authoring lane instead of manufacturing patches", async () => {
    const session = new StubSession();
    const stage = new Stage({ session });

    await expect(
      stage.render('<Facet entry="home"><Screen name="home" /></Facet>'),
    ).resolves.toEqual({
      ok: true,
      document: DOCUMENT,
    });

    expect(session.rendered).toEqual(['<Facet entry="home"><Screen name="home" /></Facet>']);
    expect(stage.flush()).toEqual({ text: null });
  });

  it("publishes data through the session publish lane", async () => {
    const session = new StubSession();
    const stage = new Stage({ session });
    const path: DataPath = Object.freeze(["account"]);

    await expect(stage.publishData(path, { status: "ok" })).resolves.toEqual({
      ok: true,
      chars: 15,
    });

    expect(session.published).toEqual([{ path, value: { status: "ok" } }]);
    expect(stage.flush()).toEqual({ text: null });
  });

  it("allows zero or one conversation message as text for the runtime", () => {
    const stage = new Stage({ session: new StubSession() });

    expect(stage.flush()).toEqual({ text: null });
    stage.message("done");

    expect(stage.flush()).toEqual({ text: "done" });
  });

  it("rejects a second conversation message", () => {
    const stage = new Stage({ session: new StubSession() });

    stage.message("one");

    expect(() => stage.message("two")).toThrow("one conversation");
  });

  it("surfaces a fire-and-forget stage operation failure before flushing text", async () => {
    const worker = agent.defineAgent(({ stage }) => {
      void stage.render('<Facet entry="home"><Screen name="home" /></Facet>');
      stage.message("done");
    });

    await expect(worker.run({ event: EVENT, session: new FailingSession() })).rejects.toThrow(
      "render failed",
    );
  });

  it("removes say, patch, and raw-markup patch production", () => {
    expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain("say");
    expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain("setData");
    expect(Object.getOwnPropertyNames(Stage.prototype)).not.toContain("patch");
    expect(STAGE_SOURCE).not.toMatch(
      /JsonPatchOperation|TurnOutcome|path:\s*"\/document"|value:\s*markup/u,
    );
  });

  it("publishes exactly Barrel Export Contract list 7", () => {
    expect(Object.keys(agent).sort()).toEqual(["Stage", "defineAgent", "defineStreamingAgent"]);
    expect(INDEX_SOURCE).toContain(
      'export { defineAgent, defineStreamingAgent } from "./define-agent.js";',
    );
    expect(INDEX_SOURCE).toContain('export { Stage } from "./stage.js";');
    expect(INDEX_SOURCE).toMatch(
      /export\s+type\s+\{[^}]*FacetContext[^}]*FacetLogic[^}]*InProcessFacetAgent[^}]*StreamingFacetLogic[^}]*\}\s+from\s+"\.\/define-agent\.js";/su,
    );
    expect(INDEX_SOURCE).toContain('export type { StageOptions } from "./stage.js";');
    expect(INDEX_SOURCE).not.toContain("export *");
  });
});
