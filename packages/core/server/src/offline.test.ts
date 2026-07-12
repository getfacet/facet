import { describe, expect, it } from "vitest";
import { validateTree, type ClientEvent, type FacetSession, type FacetTree } from "@facet/core";
import { DEFAULT_OFFLINE_FACE, offlineFor } from "./offline.js";

// =========================================================================
// WU-7 / RISK-API-1 (DC-007): the offline gate is a behavior-changed consumer
// of core's `treeHasContent` (via the private `hasBuiltStage`, exercised here
// through `offlineFor`). A RETURNING visitor's built page must NEVER be
// overwritten by the offline face. WU-2 corrected the content predicate to
// resolve `from` against `tree.data`, so a page whose content is data-bound is
// now correctly recognized as "built".
//
// Why they genuinely exercise the data path — the built stage below carries its
// content ONLY in `data.sales` (inline `rows` omitted). Pre-WU-2, `validateTree`
// stripped `data` and the gate read inline arrays only, so this page scored as
// EMPTY: `offlineFor` would have OVERWRITTEN it with the offline face and the
// no-overwrite assertion here would have FAILED.
// =========================================================================

const visit: ClientEvent = { kind: "visit", visitor: { visitorId: "v" } };

const session = (stage: FacetTree): FacetSession => ({
  agentId: "a",
  visitor: { visitorId: "v" },
  stage,
});

/** A built page whose only content is a table bound to a populated dataset. */
const dataBoundStage = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t"] },
      t: {
        id: "t",
        type: "table",
        columns: [
          { key: "month", label: "Month" },
          { key: "revenue", label: "Revenue" },
        ],
        from: "sales",
      },
    },
    data: { sales: [{ month: "Jan", revenue: 100 }] },
  }).tree;

/** A from-bound page whose dataset is absent — no real content. */
const danglingStage = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: {
      root: { id: "root", type: "box", children: ["t"] },
      t: {
        id: "t",
        type: "table",
        columns: [{ key: "month", label: "Month" }],
        from: "sales",
      },
    },
    data: { other: [{ month: "Jan" }] },
  }).tree;

/** A structurally-empty page — an empty root box, no content. */
const emptyStage = (): FacetTree =>
  validateTree({
    root: "root",
    nodes: { root: { id: "root", type: "box", children: [] } },
  }).tree;

const OVERWRITE = [
  { kind: "patch", patches: [{ op: "replace", path: "", value: DEFAULT_OFFLINE_FACE }] },
];

describe("offlineFor preserves a data-bound built stage (WU-7 / DC-007)", () => {
  it("does NOT overwrite a populated data-bound built page", () => {
    const stage = dataBoundStage();
    // Guard the fixture: the warehouse survived validation.
    expect(stage.data?.["sales"]).toEqual([{ month: "Jan", revenue: 100 }]);

    const msgs = offlineFor(DEFAULT_OFFLINE_FACE, visit, session(stage));
    // A built page is preserved: a short note, never a stage-replacing patch.
    expect(msgs.every((m) => m.kind !== "patch")).toBe(true);
    expect(msgs[0]?.kind).toBe("say");
  });

  it("still overwrites a dangling-only from page with the offline face", () => {
    const msgs = offlineFor(DEFAULT_OFFLINE_FACE, visit, session(danglingStage()));
    expect(msgs).toEqual(OVERWRITE);
  });

  it("still overwrites a structurally-empty page (unchanged behavior)", () => {
    const msgs = offlineFor(DEFAULT_OFFLINE_FACE, visit, session(emptyStage()));
    expect(msgs).toEqual(OVERWRITE);
  });

  it("overwrites for a fresh visitor with no session at all (unchanged behavior)", () => {
    const msgs = offlineFor(DEFAULT_OFFLINE_FACE, visit, undefined);
    expect(msgs).toEqual(OVERWRITE);
  });
});
