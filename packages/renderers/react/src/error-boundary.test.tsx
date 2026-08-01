// @vitest-environment jsdom
/**
 * The proof that one registered component's crash costs exactly that component.
 *
 * Four claims carry this file, and each is a claim about a **boundary** rather
 * than about a rendered appearance.
 *
 * **A crash is contained and says nothing.** A registered component whose React
 * code throws is replaced by the framework's crash state, and the document that
 * results carries no trace of what happened: not the message, not a stack frame,
 * not the component's own name. The assertion is written against the whole
 * serialised document rather than the visible text, because an attribute, a
 * comment node or a `title` would leak just as effectively as a paragraph would
 * (DC-014). This is the assertion the deleted Lab boundary carried, brought here
 * with the boundary itself.
 *
 * **A crash is local.** Siblings keep rendering *and* keep working — a sibling
 * that still paints but no longer responds to a click has not been isolated, it
 * has been frozen, so the sibling assertion drives a real interaction.
 *
 * **Reset is node-local, and latching is one-way.** The boundary's reset input
 * is a token derived from that node's own resolved input, never the
 * authoritative `stageRevision`. Two behaviours follow and both are asserted: a
 * **healthy** boundary ignores token changes entirely — it does not remount its
 * children, which is what protects unrelated `Field` state, focus and open
 * `Modal` state on every accepted mutation — and a **latched** boundary clears
 * only when **its own** token changes, never when a neighbour's does.
 *
 * **The scope is render and lifecycle, and the gap is closed explicitly.** React
 * boundaries do not see a throw from an event handler, so the boundary alone
 * would leave that path uncontained. The two tests at the end state both halves:
 * the raw handler escapes, and the same handler behind `safeInvoke` does not.
 *
 * **On asserting that a handler did not throw.** `expect(() => fireEvent.…())
 * .not.toThrow()` cannot fail for a React event handler: React catches a
 * throwing handler at its dispatch boundary and reports it to the environment,
 * so the throw never unwinds `fireEvent` and the assertion passes whatever
 * happens. `errorsDuring` below is the shape that can fail — it listens for the
 * window `error` event across the dispatch, cancels it so a deliberately
 * provoked error is not also charged as unhandled, and folds in a synchronous
 * throw. Render throws are different in kind and are exercised directly: a
 * throw during render *does* unwind synchronously unless a boundary intercepts
 * it, which is precisely what these tests are measuring.
 *
 * This suite reads `node:fs` to assert a property *of* the source — that the
 * boundary's code names no part of the error and no stage revision. `@facet/react`
 * itself imports no `node:*`; a test that scans the module it covers is the same
 * exception `@facet/core`'s barrel suite already takes.
 */

import { NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boundaryIdentity, safeInvoke, SubtreeBoundary } from "./error-boundary.js";
import { errorsDuring } from "../../../../test-support/errors-during.js";

afterEach(cleanup);

/** The copy every mount below runs with: the framework defaults, unmodified. */
const COPY = NEUTRAL_COPY_DEFAULTS;

/** The internal detail a crashing component is made to carry. */
const CRASH_MESSAGE = "boom: internal detail 0xdeadbeef at row 7 of the private ledger";

/**
 * Silences React's own report of a caught error for the duration of `run`.
 *
 * React logs every error a boundary catches, by design. These tests provoke
 * those errors deliberately, so the log is noise — but it is silenced only
 * around the provoking call, never for a whole file, so an unrelated React
 * warning still surfaces.
 */
function withSilencedReactReport<Result>(run: () => Result): Result {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

/** The error the crashing component below threw, kept so its stack can be checked. */
let thrown: Error | undefined;

/** A registered component whose React code throws while rendering. */
function ExplodingWidget(): ReactNode {
  thrown = new Error(CRASH_MESSAGE);
  throw thrown;
}

/** A component that throws only while `shouldThrow` says so. */
function Flaky({ shouldThrow }: { readonly shouldThrow: boolean }): ReactNode {
  if (shouldThrow) {
    throw new Error(CRASH_MESSAGE);
  }
  return <p>recovered</p>;
}

/** Counts how many times each named subtree has been mounted from scratch. */
const mounts = new Map<string, number>();

/** A healthy child that records its mounts, so a remount is observable. */
function MountCounted({ name }: { readonly name: string }): ReactNode {
  useEffect(() => {
    mounts.set(name, (mounts.get(name) ?? 0) + 1);
  }, [name]);
  return <p>{`healthy ${name}`}</p>;
}

/** A sibling that is only proved isolated if it still responds to a visitor. */
function Counter(): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((current) => current + 1)}>
      {`clicked ${count}`}
    </button>
  );
}

describe("SubtreeBoundary", () => {
  it("replaces a crashing component with the crash state and leaks nothing about it", () => {
    const { container } = withSilencedReactReport(() =>
      render(
        <SubtreeBoundary copy={COPY} resetToken="token-a">
          <ExplodingWidget />
        </SubtreeBoundary>,
      ),
    );

    expect(container.textContent).toBe(COPY.render.componentUnavailable);

    const serialised = document.body.innerHTML;
    expect(serialised).not.toContain(CRASH_MESSAGE);
    expect(serialised).not.toContain("0xdeadbeef");
    expect(serialised).not.toContain("ExplodingWidget");
    expect(serialised).not.toMatch(/error/i);
    expect(serialised).not.toMatch(/\bat\s/);

    const stackFrames = (thrown?.stack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(stackFrames.length).toBeGreaterThan(0);
    for (const frame of stackFrames) {
      expect(serialised).not.toContain(frame);
    }
  });

  it("leaves sibling subtrees rendering and interactive", () => {
    const { container, getByRole } = withSilencedReactReport(() =>
      render(
        <div>
          <SubtreeBoundary copy={COPY} resetToken="token-a">
            <ExplodingWidget />
          </SubtreeBoundary>
          <SubtreeBoundary copy={COPY} resetToken="token-b">
            <Counter />
          </SubtreeBoundary>
        </div>,
      ),
    );

    expect(container.textContent).toContain(COPY.render.componentUnavailable);

    const button = getByRole("button");
    expect(button.textContent).toBe("clicked 0");
    fireEvent.click(button);
    expect(button.textContent).toBe("clicked 1");
  });

  it("does not remount a healthy subtree when its resetToken changes", () => {
    mounts.clear();
    const { rerender } = render(
      <SubtreeBoundary copy={COPY} resetToken="token-1">
        <MountCounted name="healthy" />
      </SubtreeBoundary>,
    );
    expect(mounts.get("healthy")).toBe(1);

    rerender(
      <SubtreeBoundary copy={COPY} resetToken="token-2">
        <MountCounted name="healthy" />
      </SubtreeBoundary>,
    );
    rerender(
      <SubtreeBoundary copy={COPY} resetToken="token-3">
        <MountCounted name="healthy" />
      </SubtreeBoundary>,
    );

    expect(mounts.get("healthy")).toBe(1);
  });

  it("stays latched while its own resetToken is unchanged, even once the child is healthy", () => {
    const { container, rerender } = withSilencedReactReport(() =>
      render(
        <SubtreeBoundary copy={COPY} resetToken="token-a">
          <Flaky shouldThrow />
        </SubtreeBoundary>,
      ),
    );
    expect(container.textContent).toBe(COPY.render.componentUnavailable);

    rerender(
      <SubtreeBoundary copy={COPY} resetToken="token-a">
        <Flaky shouldThrow={false} />
      </SubtreeBoundary>,
    );

    expect(container.textContent).toBe(COPY.render.componentUnavailable);
  });

  it("clears when its own resetToken changes, and not when a neighbour's does", () => {
    const tree = (
      crashedToken: string,
      neighbourToken: string,
      shouldThrow: boolean,
    ): ReactNode => (
      <div>
        <SubtreeBoundary copy={COPY} resetToken={crashedToken}>
          <Flaky shouldThrow={shouldThrow} />
        </SubtreeBoundary>
        <SubtreeBoundary copy={COPY} resetToken={neighbourToken}>
          <p>neighbour</p>
        </SubtreeBoundary>
      </div>
    );

    const { container, rerender } = withSilencedReactReport(() =>
      render(tree("crashed-1", "neighbour-1", true)),
    );
    expect(container.textContent).toContain(COPY.render.componentUnavailable);

    // The neighbour's own input changed. Nothing about the crashed node did.
    rerender(tree("crashed-1", "neighbour-2", false));
    expect(container.textContent).toContain(COPY.render.componentUnavailable);
    expect(container.textContent).not.toContain("recovered");

    // Now the crashed node's own input changed.
    rerender(tree("crashed-2", "neighbour-2", false));
    expect(container.textContent).toContain("recovered");
    expect(container.textContent).not.toContain(COPY.render.componentUnavailable);
  });

  it("revives a subtree that crashes again after recovering", () => {
    const { container, rerender } = withSilencedReactReport(() =>
      render(
        <SubtreeBoundary copy={COPY} resetToken="token-1">
          <Flaky shouldThrow />
        </SubtreeBoundary>,
      ),
    );
    expect(container.textContent).toBe(COPY.render.componentUnavailable);

    rerender(
      <SubtreeBoundary copy={COPY} resetToken="token-2">
        <Flaky shouldThrow={false} />
      </SubtreeBoundary>,
    );
    expect(container.textContent).toBe("recovered");

    withSilencedReactReport(() =>
      rerender(
        <SubtreeBoundary copy={COPY} resetToken="token-3">
          <Flaky shouldThrow />
        </SubtreeBoundary>,
      ),
    );
    expect(container.textContent).toBe(COPY.render.componentUnavailable);
  });

  it("does not catch a throw from an event handler — that is safeInvoke's job", () => {
    function HandlerThrows(): ReactNode {
      return (
        <button
          type="button"
          onClick={() => {
            throw new Error(CRASH_MESSAGE);
          }}
        >
          raw
        </button>
      );
    }

    const { getByRole } = render(
      <SubtreeBoundary copy={COPY} resetToken="token-a">
        <HandlerThrows />
      </SubtreeBoundary>,
    );

    const escaped = withSilencedReactReport(() =>
      errorsDuring(() => {
        fireEvent.click(getByRole("button"));
      }),
    );

    expect(escaped).toContain(CRASH_MESSAGE);
    // The boundary never saw it, so the subtree is still the live one.
    expect(getByRole("button").textContent).toBe("raw");
  });

  it("contains a throwing injected handler behind safeInvoke, leaving the subtree live", () => {
    function HandlerWrapped(): ReactNode {
      const onAction = safeInvoke((prop: string) => {
        throw new Error(`${CRASH_MESSAGE} ${prop}`);
      });
      return (
        <button type="button" onClick={() => onAction("action")}>
          wrapped
        </button>
      );
    }

    const { container, getByRole } = render(
      <SubtreeBoundary copy={COPY} resetToken="token-a">
        <HandlerWrapped />
      </SubtreeBoundary>,
    );

    const escaped = errorsDuring(() => {
      fireEvent.click(getByRole("button"));
    });

    expect(escaped).toEqual([]);
    expect(getByRole("button").textContent).toBe("wrapped");
    expect(container.textContent).not.toContain(COPY.render.componentUnavailable);
    expect(document.body.innerHTML).not.toContain(CRASH_MESSAGE);
  });

  it("returns the handler's own result when nothing throws, and undefined when one does", () => {
    const succeeds = safeInvoke((value: number) => value * 2);
    expect(succeeds(21)).toBe(42);

    const fails = safeInvoke((): number => {
      throw new Error(CRASH_MESSAGE);
    });
    expect(fails(undefined)).toBeUndefined();
  });
});

describe("the boundary has nothing to leak and no revision to read", () => {
  /**
   * The module's own source with every comment removed.
   *
   * The stripping is the point, not a tidiness measure: the docblocks in
   * `error-boundary.tsx` discuss the error's message, its stack and
   * `stageRevision` at length — they are what explains the design — so a scan of
   * the raw text would match its own prose and pass for the wrong reason. The
   * path is built with `fileURLToPath` and `join` because this suite runs under
   * jsdom, where `new URL(file, import.meta.url)` resolves against
   * `http://localhost:3000/` rather than the file it is standing in.
   */
  const source = withoutComments(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "error-boundary.tsx"), "utf8"),
  );

  it("strips its own comments before scanning, so the scan can actually fail", () => {
    expect(source).not.toContain("stageRevision");
    // The raw file does discuss all of it — which is exactly why the scan runs
    // over the stripped text.
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "error-boundary.tsx"),
      "utf8",
    );
    expect(raw).toContain("stageRevision");
    expect(raw).toContain("stack");
  });

  it("names no part of the caught error, and no stage revision, in its code", () => {
    for (const banned of ["message", "stack", "revision", "console"]) {
      expect(source.toLowerCase()).not.toContain(banned);
    }
  });

  it("is handed the error and declines to take it", () => {
    // A boundary that captured the error would have to accept it first. The
    // arity is the structural form of "there is nothing to leak".
    expect(SubtreeBoundary.getDerivedStateFromError.length).toBe(0);
    expect(SubtreeBoundary.getDerivedStateFromError()).toEqual({ crashed: true });
  });
});

/** Source text with block and line comments removed, leaving the code alone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("boundaryIdentity", () => {
  it("is the node id and tag, and is stable across repeated derivations", () => {
    expect(boundaryIdentity("n7", "Text")).toBe("n7:Text");
    expect(boundaryIdentity("n7", "Text")).toBe(boundaryIdentity("n7", "Text"));
  });

  it("separates two nodes that differ in either half", () => {
    expect(boundaryIdentity("n7", "Text")).not.toBe(boundaryIdentity("n8", "Text"));
    expect(boundaryIdentity("n7", "Text")).not.toBe(boundaryIdentity("n7", "Metric"));
  });
});
