import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BOUNDS } from "./bounds.js";
import { deriveMessageId, truncateConversationText } from "./conversation.js";
import type { ConversationMessage } from "./conversation.js";
import type { ComponentDocument } from "./document.js";
import type { AgentEvent } from "./event.js";
import { MAX_PATCH_OPS, applyPatch } from "./patch.js";
import type { JsonPatchOperation } from "./patch.js";
import { collectTurnOutcome, iterateTurnOutcome, validateTurnOutcome } from "./protocol.js";
import type {
  AgentControlFrame,
  AgentEventFrame,
  FacetAgent,
  FacetTransport,
  PatchFrame,
  ServerFrame,
  TurnOutcome,
  TurnOutcomeValidationResult,
} from "./protocol.js";
import type { FacetStage } from "./stage.js";

/**
 * The protocol is mostly *types*, so vitest alone cannot check it: every
 * `import type` is erased by esbuild before a test runs. Three things follow,
 * and this file does all three.
 *
 * 1. The type-level contract is written as **consumer-shaped helpers** that the
 *    runtime assertions actually call. A helper only compiles if the contract it
 *    annotates holds, and calling it proves the fixture is real rather than a
 *    comment. Same idiom as `mount-contract.test.ts`.
 * 2. The deletions — `kind: "say"`, `kind: "reset"` and every `view` member — // style-hard-cut: allowed-negative
 *    are asserted **mechanically, twice**: once over the module's own source and
 *    once over the declaration `tsc` emits for it. A source-only scan would miss
 *    a member reintroduced through a type-only import, because that import is
 *    gone before vitest ever runs.
 * 3. The emitted declaration's import list is pinned, so no public declaration
 *    can come to reference a name a consumer cannot import from `@facet/core`.
 */

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

const MODULE_PATH = join(SRC_DIR, "protocol.ts");

/** `packages/core/core/src` → the workspace root, four levels up. */
const REPO_ROOT = join(SRC_DIR, "..", "..", "..", "..");

/**
 * Removes comments so every scan below reads *code*, not prose. This module's
 * doc comments necessarily name the things it deletes, and `tsc` copies those
 * comments straight into the emitted declaration — a scan a sentence can trip is
 * not a mechanical check.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The declaration `tsc` emits for the module. Cached, because emitting it costs
 * a compiler process and every scan wants the same bytes.
 */
let emittedDeclaration: string | undefined;

function emitDeclaration(): string {
  if (emittedDeclaration !== undefined) {
    return emittedDeclaration;
  }
  const outDir = mkdtempSync(join(tmpdir(), "facet-protocol-"));
  try {
    try {
      execFileSync(
        join(REPO_ROOT, "node_modules", ".bin", "tsc"),
        [
          "--declaration",
          "--emitDeclarationOnly",
          "--strict",
          "--exactOptionalPropertyTypes",
          "--noUncheckedIndexedAccess",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "ESNext",
          "--moduleResolution",
          "Bundler",
          "--outDir",
          outDir,
          MODULE_PATH,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      const output = (error as { readonly stdout?: string }).stdout ?? String(error);
      throw new Error(`tsc declaration emit failed:\n${output}`);
    }
    emittedDeclaration = readFileSync(join(outDir, "protocol.d.ts"), "utf8");
    return emittedDeclaration;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** The retired vocabulary, as patterns that match however it might be spelled. */
const DELETED_VOCABULARY: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'the "say" message', pattern: /say/i },
  { what: 'the "reset" message (D-02)', pattern: /reset/i },
  { what: "ViewSnapshot and every view member", pattern: /view/i }, // style-hard-cut: allowed-negative
];

function expectNoDeletedVocabulary(where: string, source: string): void {
  const code = stripComments(source);
  for (const { what, pattern } of DELETED_VOCABULARY) {
    expect(code, `${where}: ${what} is deleted`).not.toMatch(pattern);
  }
}

/** The exact key set of a rejection — one structured error, never a list. */
const REJECTION_KEYS: readonly string[] = ["at", "code", "detail", "ok"];

/** The exact key set of an acceptance. */
const ACCEPTANCE_KEYS: readonly string[] = ["ok", "outcome"];

/** The complete declared member set of a turn outcome, sorted. */
const OUTCOME_KEYS: readonly string[] = ["conversation", "patches", "stageRevision"];

/** The same set minus the one optional member. */
const REQUIRED_OUTCOME_KEYS: readonly string[] = OUTCOME_KEYS.filter(
  (key) => key !== "conversation",
);

function sortedKeys(value: object): readonly string[] {
  return Object.keys(value).sort();
}

function op(path: string, value: unknown): JsonPatchOperation {
  return { op: "replace", path, value };
}

function ops(count: number): readonly JsonPatchOperation[] {
  return Array.from({ length: count }, (_unused, index) => op(`/data/k${index}`, index));
}

/** A well-formed assistant message, with its id derived rather than restated. */
function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "conversation",
    messageId: deriveMessageId("e-01HZXQ7M9C", "assistant"),
    turnId: "e-01HZXQ7M9C",
    role: "assistant",
    text: "Here is the dashboard.",
    at: 1_700_000_000_000,
    ...overrides,
  };
}

function outcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stageRevision: 7,
    patches: [op("/document/nodes/n4/props/label", "Revenue")],
    ...overrides,
  };
}

function accept(value: unknown): TurnOutcome {
  const result = validateTurnOutcome(value);
  if (!result.ok) {
    throw new Error(`expected acceptance, got ${result.code} at ${result.at}: ${result.detail}`);
  }
  return result.outcome;
}

function rejection(value: unknown): string {
  const result = validateTurnOutcome(value);
  return result.ok ? "accepted" : result.code;
}

function rejectionAt(value: unknown): string {
  const result = validateTurnOutcome(value);
  return result.ok ? "accepted" : result.at;
}

function textOf(length: number): string {
  return "t".repeat(length);
}

// ---------------------------------------------------------------------------
// The module's own surface
// ---------------------------------------------------------------------------

describe("the protocol module's deletions", () => {
  it("names no say frame, no reset frame and no view member, in its own source", () => {
    expectNoDeletedVocabulary("source", readFileSync(MODULE_PATH, "utf8"));
  });

  it("names none of them in the declaration tsc emits either", () => {
    // A type-only member vanishes before vitest runs, so the source scan above
    // cannot stand in for this one: the emitted `.d.ts` is the surface that
    // `@facet/server` and `@facet/agent-client` actually compile against.
    expectNoDeletedVocabulary("emitted declaration", emitDeclaration());
  });

  it("emits declarations for exactly the eleven public names", () => {
    const declaration = emitDeclaration();
    const exported = [
      ...declaration.matchAll(/export\s+(?:declare\s+)?(?:interface|type|function|const)\s+(\w+)/g),
    ]
      .map((match) => match[1])
      .sort();
    expect(exported).toEqual([
      "AgentControlFrame",
      "AgentEventFrame",
      "FacetAgent",
      "FacetTransport",
      "PatchFrame",
      "ServerFrame",
      "TurnOutcome",
      "TurnOutcomeValidationResult",
      "collectTurnOutcome",
      "iterateTurnOutcome",
      "validateTurnOutcome",
    ]);
  });

  it("references only names a consumer can import from the barrel", () => {
    const declaration = emitDeclaration();
    const specifiers = [...declaration.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    // Every module named here is a public core module whose types reach the
    // barrel. A private module appearing in this list would be a declaration a
    // consumer cannot follow.
    expect(specifiers).toEqual(["./conversation.js", "./event.js", "./patch.js", "./revision.js"]);

    const imported = [...declaration.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .sort();
    expect(imported).toEqual([
      "AgentEvent",
      "ConversationMessage",
      "JsonPatchOperation",
      "StageRevision",
    ]);
  });

  it("restates no shape another module owns", () => {
    const code = stripComments(readFileSync(MODULE_PATH, "utf8"));
    // `ConversationMessage` is conversation.ts's, and the fold vocabulary is
    // patch.ts's. A second declaration of either here is the drift this module
    // exists to prevent, so neither `role`/`messageId` nor an operation name may
    // appear as a declared member.
    expect(code).not.toMatch(/messageId\s*:\s*string/);
    expect(code).not.toMatch(/\brole\s*:\s*["']/);
    expect(code).not.toMatch(/\bop\s*:\s*["'](?:add|remove|replace)["']/);
  });
});

// ---------------------------------------------------------------------------
// ServerFrame
// ---------------------------------------------------------------------------

/** A consumer-shaped exhaustive fold. A third union member stops compiling here. */
function describeFrame(frame: ServerFrame): string {
  switch (frame.kind) {
    case "patch":
      return `patch@${frame.stageRevision}x${frame.ops.length}`;
    case "conversation":
      return `conversation:${frame.messageId}`;
    default: {
      const unreachable: never = frame;
      return unreachable;
    }
  }
}

/** Exhaustive over the discriminant: a member added or removed is a compile error. */
const FRAME_KINDS: Readonly<Record<ServerFrame["kind"], true>> = Object.freeze({
  patch: true,
  conversation: true,
});

function patchFrame(overrides: Partial<PatchFrame> = {}): PatchFrame {
  return { kind: "patch", stageRevision: 7, ops: [op("/data/sales/q1", 42)], ...overrides };
}

describe("the ServerFrame union", () => {
  it("is exactly two kinds", () => {
    expect(Object.keys(FRAME_KINDS).sort()).toEqual(["conversation", "patch"]);
  });

  it("narrows a patch frame by its discriminant", () => {
    expect(describeFrame(patchFrame())).toBe("patch@7x1");
  });

  it("narrows a conversation frame by the discriminant conversation.ts already owns", () => {
    const conversation = accept(outcome({ conversation: message() })).conversation;
    expect(conversation).toBeDefined();
    expect(describeFrame(conversation as ConversationMessage)).toBe(
      `conversation:${deriveMessageId("e-01HZXQ7M9C", "assistant")}`,
    );
  });

  it("is literally PatchFrame | ConversationMessage, in both directions", () => {
    const asFrame = (value: PatchFrame | ConversationMessage): ServerFrame => value;
    const asMember = (value: ServerFrame): PatchFrame | ConversationMessage => value;
    expect(asFrame(patchFrame()).kind).toBe("patch");
    expect(asMember(patchFrame()).kind).toBe("patch");
  });
});

describe("a patch frame's ops target the stage (D4)", () => {
  const document: ComponentDocument = {
    entry: "dashboard",
    screens: ["n1"],
    nodes: {
      n1: { tag: "Stack", props: {}, children: ["n4"] },
      n4: { tag: "Text", props: { label: { kind: "scalar", value: "Sales" } }, children: [] },
    },
  };
  const stage: FacetStage = Object.freeze({ document, data: { region: "south" } });

  it("addresses the document half", () => {
    const frame = patchFrame({
      ops: [op("/document/nodes/n4/props/label", { kind: "scalar", value: "Revenue" })],
    });
    const folded = applyPatch(stage, frame.ops);
    expect(folded).not.toBe(stage);
    expect(folded.document?.nodes["n4"]?.props["label"]).toEqual({
      kind: "scalar",
      value: "Revenue",
    });
    expect(folded.data).toEqual({ region: "south" });
  });

  it("addresses the data half", () => {
    const frame = patchFrame({ ops: [op("/data/region", "north")] });
    const folded = applyPatch(stage, frame.ops);
    expect(folded.data).toEqual({ region: "north" });
    expect(folded.document).toEqual(document);
  });

  it("resynchronises data with the document through one root replace", () => {
    const resync: FacetStage = { document: null, data: { region: "north" } };
    const frame = patchFrame({ ops: [op("", resync)] });
    const folded = applyPatch(stage, frame.ops);
    // One frame carries both halves, so a reconnecting browser cannot adopt a
    // document that still reads the model it replaced.
    expect(folded.document).toBeNull();
    expect(folded.data).toEqual({ region: "north" });
  });

  it("carries a stage pointer, never a document-rooted one", () => {
    const frame = patchFrame({ ops: [op("/nodes/n4", "x")] });
    expect(applyPatch(stage, frame.ops)).toBe(stage);
  });
});

// ---------------------------------------------------------------------------
// validateTurnOutcome
// ---------------------------------------------------------------------------

describe("validateTurnOutcome accepts a well-formed outcome", () => {
  it("carries exactly the declared members, with the optional one absent", () => {
    const accepted = accept(outcome());
    expect(sortedKeys(accepted)).toEqual(REQUIRED_OUTCOME_KEYS);
    expect(accepted.stageRevision).toBe(7);
    expect(accepted.patches).toHaveLength(1);
    expect("conversation" in accepted).toBe(false);
  });

  it("carries exactly the declared members when the one message is present", () => {
    const accepted = accept(outcome({ conversation: message() }));
    expect(sortedKeys(accepted)).toEqual(OUTCOME_KEYS);
    expect(accepted.conversation?.text).toBe("Here is the dashboard.");
  });

  it("answers with exactly the acceptance keys", () => {
    expect(sortedKeys(validateTurnOutcome(outcome()))).toEqual(ACCEPTANCE_KEYS);
  });

  it("freezes what it hands back, so nothing widens a payload after the boundary", () => {
    const accepted = accept(outcome({ conversation: message() }));
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.patches)).toBe(true);
    expect(Object.isFrozen(accepted.conversation)).toBe(true);
  });

  it("accepts a turn that changed nothing and said nothing", () => {
    const accepted = accept({ stageRevision: 0, patches: [] });
    expect(accepted.patches).toEqual([]);
  });
});

describe("validateTurnOutcome admits zero or one conversation message", () => {
  it("accepts zero", () => {
    expect(validateTurnOutcome(outcome()).ok).toBe(true);
  });

  it("accepts one", () => {
    expect(validateTurnOutcome(outcome({ conversation: message() })).ok).toBe(true);
  });

  it("rejects two, which is the only way a second one can be stated", () => {
    expect(rejection(outcome({ conversation: [message(), message()] }))).toBe(
      "conversation_not_singular",
    );
    expect(rejectionAt(outcome({ conversation: [message(), message()] }))).toBe("conversation");
  });

  it("rejects a list even when it holds one message — a list is never the form", () => {
    expect(rejection(outcome({ conversation: [message()] }))).toBe("conversation_not_singular");
  });

  it("rejects a second message smuggled in under another key", () => {
    expect(rejection(outcome({ conversation: message(), messages: [message()] }))).toBe(
      "unknown_turn_outcome_key",
    );
    expect(rejectionAt(outcome({ conversation: message(), messages: [message()] }))).toBe(
      "messages",
    );
  });

  it("answers a rejection with exactly one structured error", () => {
    const result = validateTurnOutcome(outcome({ conversation: [message(), message()] }));
    expect(sortedKeys(result)).toEqual(REJECTION_KEYS);
  });
});

describe("validateTurnOutcome checks the outcome's own members", () => {
  it("rejects anything that is not a plain object", () => {
    expect(rejection(null)).toBe("turn_outcome_not_an_object");
    expect(rejection(undefined)).toBe("turn_outcome_not_an_object");
    expect(rejection("outcome")).toBe("turn_outcome_not_an_object");
    expect(rejection(42)).toBe("turn_outcome_not_an_object");
    expect(rejection([outcome()])).toBe("turn_outcome_not_an_object");
  });

  it("closes the member set", () => {
    expect(rejection(outcome({ extra: 1 }))).toBe("unknown_turn_outcome_key");
    expect(rejectionAt(outcome({ extra: 1 }))).toBe("extra");
  });

  it("reports the first unknown key in a fixed order", () => {
    expect(rejectionAt(outcome({ zebra: 1, alpha: 1 }))).toBe("alpha");
  });

  it("rejects a revision that is not a non-negative safe integer", () => {
    expect(rejection(outcome({ stageRevision: -1 }))).toBe("invalid_stage_revision");
    expect(rejection(outcome({ stageRevision: 1.5 }))).toBe("invalid_stage_revision");
    expect(rejection(outcome({ stageRevision: Number.NaN }))).toBe("invalid_stage_revision");
    expect(rejection(outcome({ stageRevision: "7" }))).toBe("invalid_stage_revision");
    expect(rejectionAt(outcome({ stageRevision: 0 }))).toBe("accepted");
  });

  it("rejects patches that are not a list", () => {
    expect(rejection(outcome({ patches: undefined }))).toBe("invalid_patches");
    expect(rejection(outcome({ patches: { 0: op("/data/a", 1) } }))).toBe("invalid_patches");
  });

  it("rejects an operation that is not even an object", () => {
    expect(rejection(outcome({ patches: ["/data/a"] }))).toBe("invalid_patch_operation");
    expect(rejectionAt(outcome({ patches: [op("/data/a", 1), 7] }))).toBe("patches.1");
  });

  it("rejects raw markup strings at the document root", () => {
    const rawMarkup = '<Facet entry="home"><Screen name="home" /></Facet>';
    const rawMarkupPatch = op("/document", rawMarkup);
    const rawMarkupAdd = { op: "add", path: "/document", value: rawMarkup };

    expect(rejection(outcome({ patches: [rawMarkupPatch] }))).toBe("invalid_patch_operation");
    expect(rejectionAt(outcome({ patches: [rawMarkupPatch] }))).toBe("patches.0");
    expect(rejection(outcome({ patches: [rawMarkupAdd] }))).toBe("invalid_patch_operation");
    expect(rejectionAt(outcome({ patches: [rawMarkupAdd] }))).toBe("patches.0");
    expect(rejection(outcome({ patches: [op("/document/nodes/n1/props/value", "copy")] }))).toBe(
      "accepted",
    );
  });
});

describe("the patch-batch bound is patch.ts's, read and never re-typed", () => {
  it("accepts a batch of exactly MAX_PATCH_OPS", () => {
    expect(accept(outcome({ patches: ops(MAX_PATCH_OPS) })).patches).toHaveLength(MAX_PATCH_OPS);
  });

  it("rejects the very next one", () => {
    expect(rejection(outcome({ patches: ops(MAX_PATCH_OPS + 1) }))).toBe(
      "too_many_patch_operations",
    );
    expect(rejectionAt(outcome({ patches: ops(MAX_PATCH_OPS + 1) }))).toBe("patches");
  });
});

describe("the one conversation message a turn may carry", () => {
  it("must be the conversation frame, closed over its own members", () => {
    expect(rejection(outcome({ conversation: "hello" }))).toBe("invalid_conversation");
    expect(rejection(outcome({ conversation: message({ kind: "patch" }) }))).toBe(
      "invalid_conversation_kind",
    );
    expect(rejection(outcome({ conversation: { ...message(), extra: 1 } }))).toBe(
      "unknown_conversation_key",
    );
    expect(rejectionAt(outcome({ conversation: { ...message(), extra: 1 } }))).toBe(
      "conversation.extra",
    );
  });

  it("is the assistant's half — an agent cannot author the visitor's", () => {
    const visitor = message({
      role: "visitor",
      messageId: deriveMessageId("e-01HZXQ7M9C", "visitor"),
    });
    expect(rejection(outcome({ conversation: visitor }))).toBe("invalid_conversation_role");
    expect(rejectionAt(outcome({ conversation: visitor }))).toBe("conversation.role");
  });

  it("derives its id rather than asserting one, so idempotent collapse holds", () => {
    expect(rejection(outcome({ conversation: message({ messageId: "made-up" }) }))).toBe(
      "conversation_id_not_derived",
    );
    expect(accept(outcome({ conversation: message() })).conversation?.messageId).toBe(
      deriveMessageId("e-01HZXQ7M9C", "assistant"),
    );
  });

  it("rejects a turn id that is not a non-empty string", () => {
    expect(rejection(outcome({ conversation: message({ turnId: "" }) }))).toBe("invalid_turn_id");
    expect(rejection(outcome({ conversation: message({ turnId: 7 }) }))).toBe("invalid_turn_id");
  });

  it("rejects a timestamp that is not a finite non-negative number", () => {
    expect(rejection(outcome({ conversation: message({ at: -1 }) }))).toBe(
      "invalid_conversation_at",
    );
    expect(rejection(outcome({ conversation: message({ at: Number.POSITIVE_INFINITY }) }))).toBe(
      "invalid_conversation_at",
    );
    expect(rejection(outcome({ conversation: message({ at: "now" }) }))).toBe(
      "invalid_conversation_at",
    );
  });

  it("rejects text that is not a string", () => {
    expect(rejection(outcome({ conversation: message({ text: 7 }) }))).toBe(
      "invalid_conversation_text",
    );
  });
});

describe("B-25 is conversation.ts's answer, applied and not re-decided", () => {
  const limit = BOUNDS.conversationMessageChars;

  it("passes a message of exactly the bound through byte-identical", () => {
    const text = textOf(limit);
    const accepted = accept(outcome({ conversation: message({ text }) }));
    expect(accepted.conversation?.text).toBe(text);
  });

  it("clamps the very next character rather than throwing the turn's work away", () => {
    const text = textOf(limit + 1);
    const accepted = accept(outcome({ conversation: message({ text }) }));
    expect(accepted.conversation?.text).toBe(truncateConversationText(text));
    expect(accepted.conversation?.text).toHaveLength(limit);
  });
});

describe("validateTurnOutcome is total", () => {
  it("never throws on a value with a throwing getter", () => {
    const hostile = {
      stageRevision: 1,
      get patches(): never {
        throw new Error("nope");
      },
    };
    expect(rejection(hostile)).toBe("turn_outcome_read_failed");
    expect(rejectionAt(hostile)).toBe("");
  });

  it("never throws on a throwing getter inside the conversation", () => {
    const hostile = outcome({
      conversation: {
        ...message(),
        get text(): never {
          throw new Error("nope");
        },
      },
    });
    expect(rejection(hostile)).toBe("turn_outcome_read_failed");
  });

  it("never throws on a proxy that refuses its own keys", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error("nope");
        },
      },
    );
    expect(rejection(hostile)).toBe("turn_outcome_read_failed");
  });

  it("never throws on a cyclic patches value", () => {
    const operation: Record<string, unknown> = { op: "replace", path: "/data/a" };
    const cyclic: Record<string, unknown>[] = [operation];
    operation["value"] = cyclic;
    expect(validateTurnOutcome(outcome({ patches: cyclic })).ok).toBe(true);
  });

  it("never throws on any of a scattershot corpus", () => {
    const corpus: readonly unknown[] = [
      Symbol("x"),
      () => undefined,
      new Map(),
      new Date(),
      Object.create(null),
      { stageRevision: 1n },
      { stageRevision: 1, patches: [], conversation: null },
    ];
    for (const value of corpus) {
      expect(() => validateTurnOutcome(value)).not.toThrow();
    }
  });

  it("names a result type a consumer can import and store", () => {
    const stored: TurnOutcomeValidationResult = validateTurnOutcome(outcome());
    expect(stored.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// iterateTurnOutcome / collectTurnOutcome
// ---------------------------------------------------------------------------

/** Each entry pins the frames one outcome produces — not merely that runs agree. */
const PROJECTION_CORPUS: readonly {
  readonly name: string;
  readonly outcome: TurnOutcome;
  readonly frames: readonly string[];
}[] = [
  {
    name: "a stage change with a reply",
    outcome: accept(outcome({ conversation: message() })),
    frames: ["patch@7x1", `conversation:${deriveMessageId("e-01HZXQ7M9C", "assistant")}`],
  },
  {
    name: "a stage change with nothing said",
    outcome: accept(outcome()),
    frames: ["patch@7x1"],
  },
  {
    name: "a reply that changed nothing",
    outcome: accept({ stageRevision: 3, patches: [], conversation: message() }),
    frames: [`conversation:${deriveMessageId("e-01HZXQ7M9C", "assistant")}`],
  },
  {
    name: "a turn that did nothing at all",
    outcome: accept({ stageRevision: 3, patches: [] }),
    frames: [],
  },
];

describe("projecting a turn outcome to frames", () => {
  it("pins the frames of every corpus entry", () => {
    for (const entry of PROJECTION_CORPUS) {
      expect(collectTurnOutcome(entry.outcome).map(describeFrame), entry.name).toEqual(
        entry.frames,
      );
    }
  });

  it("puts the stage change before the words about it", () => {
    const frames = collectTurnOutcome(accept(outcome({ conversation: message() })));
    expect(frames.map((frame) => frame.kind)).toEqual(["patch", "conversation"]);
  });

  it("emits no patch frame for a turn that changed nothing", () => {
    const frames = collectTurnOutcome(accept({ stageRevision: 3, patches: [] }));
    expect(frames.map((frame) => frame.kind)).toEqual([]);
  });

  it("stamps the outcome's revision on the patch frame it emits", () => {
    const [frame] = collectTurnOutcome(accept(outcome({ stageRevision: 11 })));
    expect(frame?.kind).toBe("patch");
    expect((frame as PatchFrame).stageRevision).toBe(11);
    expect((frame as PatchFrame).ops).toEqual([op("/document/nodes/n4/props/label", "Revenue")]);
  });

  it("is byte-identical across repeat runs", () => {
    for (const entry of PROJECTION_CORPUS) {
      const first = JSON.stringify(collectTurnOutcome(entry.outcome));
      const second = JSON.stringify(collectTurnOutcome(entry.outcome));
      expect(second, entry.name).toBe(first);
    }
  });

  it("collects exactly what the iterator yields", () => {
    for (const entry of PROJECTION_CORPUS) {
      expect([...iterateTurnOutcome(entry.outcome)], entry.name).toEqual(
        collectTurnOutcome(entry.outcome),
      );
    }
  });

  it("hands back frames that cannot be edited into the outcome", () => {
    const validated = accept(outcome());
    const [frame] = collectTurnOutcome(validated);
    expect(Object.isFrozen(frame)).toBe(true);
    // The frame carries its own list. Aliasing the outcome's would let a later
    // edit of one show up in the other, which is the wire disagreeing with the
    // fold that produced it.
    expect((frame as PatchFrame).ops).not.toBe(validated.patches);
    expect((frame as PatchFrame).ops).toEqual(validated.patches);
    expect(Object.isFrozen((frame as PatchFrame).ops)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The two link contracts
// ---------------------------------------------------------------------------

describe("FacetTransport", () => {
  it("delivers frames to a subscriber and stops on unsubscribe", () => {
    const subscribers = new Set<(frame: ServerFrame) => void>();
    const transport: FacetTransport = {
      subscribe(onFrame) {
        subscribers.add(onFrame);
        return () => subscribers.delete(onFrame);
      },
    };
    const seen: string[] = [];
    const unsubscribe = transport.subscribe((frame) => seen.push(describeFrame(frame)));
    for (const subscriber of subscribers) {
      subscriber(patchFrame());
    }
    unsubscribe();
    for (const subscriber of subscribers) {
      subscriber(patchFrame());
    }
    expect(seen).toEqual(["patch@7x1"]);
  });
});

describe("the agent link", () => {
  const event: AgentEvent = Object.freeze({
    eventId: "e-01HZXQ7M9C",
    eventName: "refresh",
    sourceNodeId: "n4",
    screen: "dashboard",
    stageRevision: 7,
    collect: {},
  });

  const eventFrame: AgentEventFrame = { kind: "agent_event", event };

  it("carries the event whole, restating neither its id nor its revision", () => {
    expect(sortedKeys(eventFrame)).toEqual(["event", "kind"]);
    expect(eventFrame.event.eventId).toBe("e-01HZXQ7M9C");
    expect(eventFrame.event.stageRevision).toBe(7);
  });

  it("answers one event with one control frame carrying one outcome", async () => {
    const agent: FacetAgent = {
      async handleEvent(frame) {
        return accept(
          outcome({
            stageRevision: frame.event.stageRevision + 1,
            conversation: message({ turnId: frame.event.eventId }),
          }),
        );
      },
    };
    const control: AgentControlFrame = {
      kind: "agent_control",
      eventId: eventFrame.event.eventId,
      outcome: await agent.handleEvent(eventFrame),
    };
    expect(control.outcome.stageRevision).toBe(8);
    expect(collectTurnOutcome(control.outcome).map((frame) => frame.kind)).toEqual([
      "patch",
      "conversation",
    ]);
  });
});
