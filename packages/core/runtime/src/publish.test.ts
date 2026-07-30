import { describe, expect, expectTypeOf, it } from "vitest";

import { BOUNDS, evaluateCandidateModel, parseDataPath } from "@facet/core";
import type {
  ComponentDocument,
  DataModel,
  DataPath,
  FacetCatalog,
  FacetTheme,
  StageRevision,
} from "@facet/core";

import { bootstrapSession } from "./bootstrap.js";
import { applyDataPublish } from "./publish.js";
import type { Session } from "./session.js";
import { TurnGate } from "./turn-gate.js";
import type { TurnToken, WriteAuthority } from "./turn-gate.js";

function at(value: string): DataPath {
  const parsed = parseDataPath(value);
  if (parsed === null) {
    throw new Error(`test fixture uses an illegal data path: ${value}`);
  }
  return parsed;
}

function catalogRecord(): Record<string, unknown> {
  return {
    components: [
      {
        tag: "Screen",
        whenToUse: "Root screen used to render a page.",
        props: {
          name: {
            type: "string",
            required: true,
            guidance: "The route name selected by the Facet entry.",
          },
        },
        acceptsChildren: true,
      },
      {
        tag: "Text",
        whenToUse: "Short visible text.",
        props: {
          value: { type: "string", bindable: true, guidance: "Text to show." },
        },
        acceptsChildren: false,
      },
    ],
  };
}

function themeRecord(): Record<string, Record<string, string>> {
  return {
    color: {
      background: "#fff",
      surface: "#f9fafb",
      border: "#e5e7eb",
      text: "#111827",
      textMuted: "#6b7280",
      accent: "#2563eb",
      onAccent: "#fff",
      success: "#16a34a",
      warning: "#ca8a04",
      danger: "#dc2626",
    },
    space: { xs: "2px", sm: "4px", md: "8px", lg: "16px", xl: "24px" },
    radius: { sm: "4px", md: "8px", lg: "12px", full: "999px" },
    borderWidth: { thin: "1px", thick: "2px" },
    shadow: { sm: "none", md: "0 2px 8px #0002", lg: "0 8px 24px #0003" },
    fontFamily: { sans: "system-ui", mono: "ui-monospace" },
    fontSize: { xs: "12px", sm: "14px", md: "16px", lg: "18px", xl: "22px" },
    fontWeight: { regular: "400", medium: "500", bold: "700" },
    lineHeight: { tight: "1.1", normal: "1.4", relaxed: "1.8" },
  };
}

function boot(
  overrides: { readonly data?: DataModel; readonly document?: ComponentDocument | null } = {},
): Session {
  const result = bootstrapSession({
    catalog: catalogRecord() as unknown as FacetCatalog,
    theme: themeRecord() as unknown as FacetTheme,
  });
  if (!result.ok) {
    throw new Error(`expected bootstrap acceptance, got ${result.code}`);
  }
  const document = overrides.document ?? result.session.document;
  return Object.freeze({
    ...result.session,
    document,
    data: overrides.data ?? result.session.data,
    phase: document === null ? "preparing" : "live",
  });
}

function boundDocument(): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["n1"]),
    nodes: Object.freeze({
      n1: Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: Object.freeze({ kind: "scalar" as const, value: "home" }) }),
        children: Object.freeze(["n2"]),
      }),
      n2: Object.freeze({
        tag: "Text",
        props: Object.freeze({
          value: Object.freeze({
            kind: "reference" as const,
            scheme: "data" as const,
            target: "status",
          }),
        }),
        children: Object.freeze([]),
      }),
    }),
  });
}

function withRevision(session: Session, stageRevision: number): Session {
  return Object.freeze({ ...session, stageRevision });
}

let nextTriggerId = 0;

function admitted(gate: TurnGate): TurnToken {
  nextTriggerId += 1;
  const result = gate.admit(`publish-event-${nextTriggerId}`);
  if (result.outcome !== "admitted") {
    throw new Error(`expected admitted, got ${result.outcome}`);
  }
  return result.token;
}

function turnAuthority(gate: TurnGate): WriteAuthority {
  return { kind: "turn", token: admitted(gate) };
}

function hostAuthority(gate: TurnGate): WriteAuthority {
  return { kind: "host-lease", lease: gate.mintHostLease("host-publish") };
}

function snapshot(session: Session): {
  readonly document: ComponentDocument | null;
  readonly data: DataModel;
  readonly stageRevision: StageRevision;
} {
  return {
    document: session.document,
    data: session.data,
    stageRevision: session.stageRevision,
  };
}

function expectUnchanged(session: Session, before: ReturnType<typeof snapshot>): void {
  expect(snapshot(session)).toEqual(before);
}

function dataAtLimitForB16(): DataModel {
  const shared = Object.freeze({ value: 1 });
  return { rows: Array.from({ length: BOUNDS.dataModelArrayLength - 1 }, () => shared) };
}

function dataNearB15(): DataModel {
  const chunk = "x".repeat(BOUNDS.dataModelStringChars);
  let accepted: readonly string[] = [];
  for (;;) {
    const candidate = { chunks: [...accepted, chunk] };
    const evaluation = evaluateCandidateModel(candidate);
    if (!evaluation.ok) {
      return { chunks: accepted };
    }
    accepted = candidate.chunks;
  }
}

describe("applyDataPublish", () => {
  it("commits a turn publish with a stage-rooted data patch and a value-free descriptor", () => {
    const gate = new TurnGate();
    const session = boot();
    const rows = [{ name: "Ada" }, { name: "Lin" }];

    const result = applyDataPublish(session, at("rows"), rows, 0, turnAuthority(gate), gate);

    expect(result).toMatchObject({ ok: true, stageRevision: 1 });
    if (!result.ok) {
      throw new Error(`expected publish acceptance, got ${result.code}`);
    }
    expect(result.session.data).toEqual({ rows });
    expect(result.session.document).toBe(session.document);
    expect(result.patches).toEqual([{ op: "replace", path: "/data", value: result.data }]);
    expect(result.descriptor).toEqual({
      path: "rows",
      shape: "array",
      fields: ["name"],
      count: 2,
    });
    expect(JSON.stringify(result.descriptor)).not.toContain("Ada");
  });

  it("detaches accepted nested data from caller-owned references", () => {
    const gate = new TurnGate();
    const session = boot();
    const row = { name: "Ada", nested: { score: 1 } };
    const rows = [row];

    const result = applyDataPublish(session, at("rows"), rows, 0, turnAuthority(gate), gate);

    expect(result).toMatchObject({ ok: true, stageRevision: 1 });
    if (!result.ok) {
      throw new Error(`expected publish acceptance, got ${result.code}`);
    }
    rows.push({ name: "Grace", nested: { score: 2 } });
    row.nested.score = 99;

    expect(result.data).toEqual({ rows: [{ name: "Ada", nested: { score: 1 } }] });
    expect(result.patches).toEqual([{ op: "replace", path: "/data", value: result.data }]);
  });

  it("rejects a payload whose keys cannot be enumerated without rereading it for descriptors", () => {
    const gate = new TurnGate();
    const session = boot();
    const hostile = new Proxy(
      { hidden: "payload" },
      {
        ownKeys(): string[] {
          throw new Error("hostile ownKeys trap");
        },
      },
    );

    expect(() =>
      applyDataPublish(session, at("trusted"), hostile, 0, hostAuthority(gate), gate),
    ).not.toThrow();
    const rejectedGate = new TurnGate();
    const result = applyDataPublish(
      session,
      at("trusted"),
      hostile,
      0,
      hostAuthority(rejectedGate),
      rejectedGate,
    );

    expect(result).toMatchObject({ ok: false, code: "data_not_serializable", path: "trusted" });
  });

  it("allows a runtime-minted host lease through the same lane", () => {
    const gate = new TurnGate();
    const session = boot();

    const result = applyDataPublish(
      session,
      at("trusted"),
      "from-host",
      0,
      hostAuthority(gate),
      gate,
    );

    expect(result).toMatchObject({ ok: true, data: { trusted: "from-host" } });
  });

  it("rejects a publish that crosses whole-model B-15 or B-16 even when the payload is small", () => {
    const gateForB15 = new TurnGate();
    const b15Session = boot({ data: dataNearB15() });
    const beforeB15 = snapshot(b15Session);
    const b15 = applyDataPublish(
      b15Session,
      at("extra"),
      "y".repeat(BOUNDS.dataModelStringChars),
      0,
      turnAuthority(gateForB15),
      gateForB15,
    );

    expect(b15).toMatchObject({ ok: false, code: "data_model_chars_exceeded", bound: "B-15" });
    expectUnchanged(b15Session, beforeB15);

    const gateForB16 = new TurnGate();
    const b16Session = boot({ data: dataAtLimitForB16() });
    const beforeB16 = snapshot(b16Session);
    const b16 = applyDataPublish(
      b16Session,
      at("extra"),
      true,
      0,
      turnAuthority(gateForB16),
      gateForB16,
    );

    expect(b16).toMatchObject({ ok: false, code: "data_model_values_exceeded", bound: "B-16" });
    expectUnchanged(b16Session, beforeB16);
  });

  it("rejects affected binding schema mismatches atomically", () => {
    const gate = new TurnGate();
    const session = boot({ document: boundDocument(), data: { status: "ready" } });
    const before = snapshot(session);

    const result = applyDataPublish(session, at("status"), 7, 0, turnAuthority(gate), gate);

    expect(result).toEqual({
      ok: false,
      code: "binding_schema_mismatch",
      at: "data:status",
      detail: "Published data would break a bound Text.value prop.",
    });
    expectUnchanged(session, before);
  });

  it("rejects empty or malformed paths from adversarial JS callers atomically", () => {
    const invalidPaths: readonly unknown[] = Object.freeze([
      Object.freeze([]),
      Object.freeze(["status", ""]),
      Object.freeze(["status", "0"]),
      new Proxy(Object.freeze(["status"]) as readonly string[], {
        get(target, prop, receiver) {
          if (prop === "length") {
            throw new Error("hostile length");
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    ]);

    for (const path of invalidPaths) {
      const gate = new TurnGate();
      const session = boot({ data: { status: "ready" }, document: boundDocument() });
      const before = snapshot(session);

      const result = applyDataPublish(
        session,
        path as DataPath,
        "next",
        0,
        turnAuthority(gate),
        gate,
      );

      expect(result).toMatchObject({
        ok: false,
        code: "invalid_data_path",
        at: "path",
      });
      expectUnchanged(session, before);
    }
  });

  it("rejects cyclic objects structurally without throwing and leaves the lane usable", () => {
    const gate = new TurnGate();
    const throwCheckGate = new TurnGate();
    const session = boot();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() =>
      applyDataPublish(
        session,
        at("cyclic"),
        cyclic,
        0,
        turnAuthority(throwCheckGate),
        throwCheckGate,
      ),
    ).not.toThrow();
    const rejected = applyDataPublish(session, at("cyclic"), cyclic, 0, turnAuthority(gate), gate);
    expect(rejected).toMatchObject({
      ok: false,
      code: "data_not_serializable",
      path: "cyclic.self",
    });

    const retryGate = new TurnGate();
    const accepted = applyDataPublish(
      session,
      at("after"),
      "ok",
      0,
      turnAuthority(retryGate),
      retryGate,
    );
    expect(accepted).toMatchObject({ ok: true, data: { after: "ok" } });
  });

  it("rejects a stale racing publish without merging", () => {
    const gate = new TurnGate();
    const session = withRevision(boot({ data: { winner: true } }), 1);
    const before = snapshot(session);

    const result = applyDataPublish(session, at("loser"), true, 0, turnAuthority(gate), gate);

    expect(result).toEqual({
      ok: false,
      code: "stale_revision",
      at: "expectedRevision",
      detail: "The publish expected revision 0, but the session is at revision 1.",
      currentRevision: 1,
    });
    expectUnchanged(session, before);
  });

  it("rejects a fenced token before reading a hostile payload", () => {
    const gate = new TurnGate();
    const token = admitted(gate);
    const session = boot();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    gate.fence({ kind: "turn", token });

    const result = applyDataPublish(
      session,
      at("cyclic"),
      cyclic,
      0,
      { kind: "turn", token },
      gate,
    );

    expect(result).toEqual({
      ok: false,
      code: "publish_authority_rejected",
      at: "authority",
      detail: "The write authority is not active.",
    });
  });

  it("keeps expectedRevision and authority as required parameters and exports no free publishData", async () => {
    expectTypeOf<typeof applyDataPublish>().parameter(3).toEqualTypeOf<StageRevision>();
    expectTypeOf<typeof applyDataPublish>().parameter(4).toEqualTypeOf<WriteAuthority>();
    expect(applyDataPublish).toHaveLength(6);

    const published = await import("./publish.js");
    expect(Object.keys(published).sort()).toEqual(["applyDataPublish"]);
    expect("publishData" in published).toBe(false);
  });
});
