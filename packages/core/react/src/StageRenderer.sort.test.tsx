// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FacetNode, FacetTree, NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

// Local table sort (WU-3b, DC-001/002/003/004/006/007): clicking a `sortable`
// header cycles asc→desc→unsorted as a PURE render-time reorder of the resolved
// rows. It is browser VIEW-STATE only — it fires ZERO transport/agent events
// (no onAction, no onRecord/`/record`), never mutates `rows`, and re-applies to
// fresh rows after a server `data` patch. The current sort rides only the read-
// only `view` snapshot channel.
describe("StageRenderer table sort (jsdom)", () => {
  const sortTree = (
    rows: readonly Record<string, string | number | boolean>[] = [
      { name: "Charlie", score: 2, note: "c" },
      { name: "Alice", score: 3, note: "a" },
      { name: "Bob", score: 1, note: "b" },
    ],
  ): FacetTree =>
    tree({
      root: { id: "root", type: "box", children: ["tbl"] },
      tbl: {
        id: "tbl",
        type: "table",
        columns: [
          { key: "name", label: "Name", sortable: true },
          { key: "score", label: "Score", sortable: true },
          { key: "note", label: "Note" },
        ],
        rows,
      } as unknown as FacetNode,
    });

  /** First-column text of every rendered body row, in DOM order. */
  const bodyFirstCol = (): string[] =>
    Array.from(
      document.querySelectorAll("tbody tr"),
      (tr) => tr.querySelector("td")?.textContent ?? "",
    );

  const header = (name: RegExp): HTMLElement => screen.getByRole("columnheader", { name });

  it("clicking a sortable header reorders rows and fires ZERO transport (DC-001/DC-007)", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
        tree={sortTree()}
      />,
    );

    expect(bodyFirstCol()).toEqual(["Charlie", "Alice", "Bob"]); // natural order
    fireEvent.click(header(/Name/));

    expect(bodyFirstCol()).toEqual(["Alice", "Bob", "Charlie"]); // ascending
    // The header click is view-state only: no agent event and no record/`/event`.
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    // The sort rides ONLY the read-only view snapshot channel.
    const lastSnapshot = onViewSnapshot.mock.calls.at(-1)?.[0] as {
      sort?: Record<string, unknown>;
    };
    expect(lastSnapshot.sort).toEqual({ tbl: { column: "name", direction: "asc" } });
  });

  it("cycles asc→desc→unsorted and switches column on a different header (DC-002)", () => {
    const onAction = vi.fn();
    const onRecord = vi.fn();
    render(<StageRenderer onAction={onAction} onRecord={onRecord} tree={sortTree()} />);

    fireEvent.click(header(/Name/));
    expect(bodyFirstCol()).toEqual(["Alice", "Bob", "Charlie"]); // asc
    fireEvent.click(header(/Name/));
    expect(bodyFirstCol()).toEqual(["Charlie", "Bob", "Alice"]); // desc
    fireEvent.click(header(/Name/));
    expect(bodyFirstCol()).toEqual(["Charlie", "Alice", "Bob"]); // unsorted (natural)

    // A different sortable header takes over the sort column (score asc: 1,2,3).
    fireEvent.click(header(/Score/));
    expect(bodyFirstCol()).toEqual(["Bob", "Charlie", "Alice"]);

    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("re-applies the current sort after a rows/data patch re-render (DC-003)", () => {
    const { rerender } = render(<StageRenderer tree={sortTree()} />);

    fireEvent.click(header(/Name/)); // sort by name asc
    expect(bodyFirstCol()).toEqual(["Alice", "Bob", "Charlie"]);

    // A server `data` patch swaps the rows; the browser-owned sort re-applies to
    // the fresh set on the next render (the renderer never caches the sorted array).
    rerender(
      <StageRenderer
        tree={sortTree([
          { name: "Zed", score: 9, note: "z" },
          { name: "Ann", score: 8, note: "n" },
          { name: "Mia", score: 7, note: "m" },
        ])}
      />,
    );
    expect(bodyFirstCol()).toEqual(["Ann", "Mia", "Zed"]); // still ascending by name
  });

  it("a click on a non-sortable header is a no-op and mixed-type cells never throw (DC-004)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={sortTree([
          { name: "Charlie", score: 2, note: "c" },
          { name: "Alice", score: "n/a" as unknown as number, note: "a" },
          { name: "Bob", score: 1, note: "b" },
        ])}
      />,
    );

    // The non-sortable "Note" column has no click affordance: clicking is inert.
    expect(() => fireEvent.click(header(/^Note$/))).not.toThrow();
    expect(bodyFirstCol()).toEqual(["Charlie", "Alice", "Bob"]); // unchanged

    // A sortable column with mixed-type cells sorts through the total comparator
    // without throwing (numbers before the string via the closed rank).
    expect(() => fireEvent.click(header(/Score/))).not.toThrow();
    expect(bodyFirstCol()).toEqual(["Bob", "Charlie", "Alice"]);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a table with no sortable columns renders byte-identically (DC-006)", () => {
    const onAction = vi.fn();
    const plainTable = (): FacetTree =>
      tree({
        root: { id: "root", type: "box", children: ["tbl"] },
        tbl: {
          id: "tbl",
          type: "table",
          columns: [
            { key: "name", label: "Name" },
            { key: "note", label: "Note" },
          ],
          rows: [
            { name: "Charlie", note: "c" },
            { name: "Alice", note: "a" },
          ],
        } as unknown as FacetNode,
      });
    const { container } = render(<StageRenderer onAction={onAction} tree={plainTable()} />);

    const before = container.innerHTML;
    // No header is a sort affordance: none carries a cursor pointer and clicking
    // changes nothing (byte-identical markup, natural row order preserved).
    expect(header(/^Name$/).style.cursor).toBe("");
    fireEvent.click(header(/^Name$/));
    fireEvent.click(header(/^Note$/));
    expect(container.innerHTML).toBe(before);
    expect(bodyFirstCol()).toEqual(["Charlie", "Alice"]);
    expect(onAction).not.toHaveBeenCalled();
  });
});
