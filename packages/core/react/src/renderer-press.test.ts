// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { collectFieldValues } from "./renderer-press.js";

// Focused sibling unit test on the press-time value-harvest seam
// (`collectFieldValues`). It EXTENDS — does not replace — the authoritative
// integration coverage in StageRenderer.interaction.test.tsx / .budget.test.tsx.
// These three cases are the RISK-INV-1 (silent UI-in value loss on the
// field→input rename) and RISK-INV-2 (password secret-leak) regression locks.

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

// Stamp a DOM input the way the input brick renderer does — `data-facet-field-id`
// carries the node id, and collectFieldValues' DOM pass matches on that attribute.
function mountField(root: HTMLElement, nodeId: string, value: string, type = "text"): void {
  const el = document.createElement("input");
  el.type = type;
  el.setAttribute("data-facet-field-id", nodeId);
  el.value = value;
  root.appendChild(el);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("collectFieldValues — input-consolidation seam (RISK-INV-1/2)", () => {
  it("harvests a mounted `input` node's typed value (field→input type-guard)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const t = tree(
      {
        form: { id: "form", type: "box", children: ["emailF"] },
        emailF: { id: "emailF", type: "input", name: "email" },
      },
      "form",
    );
    mountField(root, "emailF", "ada@lovelace.dev");

    expect(collectFieldValues(t, "form", root)).toEqual({ email: "ada@lovelace.dev" });
  });

  it("EXCLUDES an `input:\"password\"` value from the harvest (secret never leaks)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const t = tree(
      {
        form: { id: "form", type: "box", children: ["userF", "passF"] },
        userF: { id: "userF", type: "input", name: "user" },
        passF: { id: "passF", type: "input", input: "password", name: "password" },
      },
      "form",
    );
    mountField(root, "userF", "ada");
    mountField(root, "passF", "hunter2", "password");

    const out = collectFieldValues(t, "form", root);
    expect(out).toEqual({ user: "ada" });
    expect(out).not.toHaveProperty("password");
  });

  it('yields {} cleanly for a stale `type:"search"` node (search brick removed)', () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const t = tree(
      {
        form: { id: "form", type: "box", children: ["searchF"] },
        // `search` is no longer a brick; its subtree contributes nothing and never throws.
        searchF: { id: "searchF", type: "search", name: "q" } as unknown as FacetNode,
      },
      "form",
    );
    mountField(root, "searchF", "hello");

    expect(collectFieldValues(t, "form", root)).toEqual({});
  });
});
