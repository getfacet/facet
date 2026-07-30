// @vitest-environment jsdom
/**
 * The proof that authored layout stays flow-contained, and that the one
 * sanctioned way out of that containment is renderer-owned.
 *
 * Three claims carry this file.
 *
 * **Every mounted subtree is isolated.** Each mounted node sits inside a
 * renderer-owned element carrying `isolation: isolate`, which confines a
 * descendant's `z-index` to that element's stacking context. A registered
 * component that paints itself at `z-index: 99999` is therefore still bounded by
 * where its own subtree sits, because the number is resolved inside the
 * containment element rather than against the page. jsdom does not paint, so
 * the assertion is written where the guarantee actually lives — the DOM
 * structure and the computed `isolation` of the ancestors between a rogue
 * element and the stage root — rather than against a rendered appearance a
 * headless DOM cannot produce.
 *
 * **The overlay root is outside all of it.** `isolation: isolate` is exactly
 * what would defeat the only sanctioned overlap mechanism if the framework's
 * `Modal` frame rendered in place: a `Modal` mounted inside the document tree
 * would be confined to its ancestor's stacking context and paint below any
 * later sibling subtree. `OverlayRootProvider` is the specified resolution
 * (D-13) — a renderer-owned portal target that `ModalFrame` renders into — so
 * the property that matters is asserted by walking every ancestor of that
 * target and finding no containment element and no isolated element among them.
 *
 * **It is unreachable from author markup, and stays private.** The provider is
 * the single containment opt-out. Handing it to hosts through the package
 * barrel would hand them the escape hatch itself, so the last test reads
 * `index.ts` and states that nothing from this module or from mounting is
 * exported. And a `useOverlayRoot` called with no provider above it is a
 * determinate error, never a silent in-tree fallback: falling back would place
 * an overlay inside the containment it exists to escape, and it would do so
 * invisibly.
 *
 * This suite is `.ts` rather than `.tsx` and builds its elements with
 * `createElement`, which is what the module under test does — `containment.ts`
 * is JSX-free so that the private renderer modules stay uniform. It reads
 * `node:fs` to assert a property of a source file, the same exception
 * `error-boundary.test.tsx` takes, and builds the path with `fileURLToPath`
 * because under jsdom `new URL(file, import.meta.url)` resolves against
 * `http://localhost:3000/` rather than against the file it stands in.
 */

import { NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import type { ComponentDocument, ComponentMountProps, ComponentSpec } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DataProvider } from "./binding.js";
import {
  CONTAINMENT_ATTRIBUTE,
  CONTAINMENT_STYLE,
  Containment,
  OVERLAY_ROOT_ATTRIBUTE,
  OverlayRootProvider,
  useOverlayRoot,
} from "./containment.js";
import { createFieldStore } from "./field-store.js";
import { MountNode } from "./mount-node.js";
import type { MountContext } from "./mount-node.js";
import type { ComponentRegistry } from "./registry.js";

afterEach(cleanup);

/** A minimal catalog: a screen root, a container, and a component that misbehaves. */
const SPECS: readonly ComponentSpec[] = [
  {
    tag: "Screen",
    whenToUse: "A screen root.",
    props: { name: { type: "string", required: true, guidance: "The screen name." } },
    acceptsChildren: true,
  },
  {
    tag: "Stack",
    whenToUse: "A layout container.",
    props: {},
    acceptsChildren: true,
  },
  {
    tag: "Rogue",
    whenToUse: "A registered component that tries to escape its stacking context.",
    props: {},
    acceptsChildren: false,
  },
];

const INDEX: ReadonlyMap<string, ComponentSpec> = new Map(SPECS.map((spec) => [spec.tag, spec]));

function ScreenImpl({ children }: ComponentMountProps<ReactNode>): ReactNode {
  return createElement("section", { "data-testid": "screen" }, children);
}

function StackImpl({ children }: ComponentMountProps<ReactNode>): ReactNode {
  return createElement("div", { "data-testid": "stack" }, children);
}

/** Trusted code, and trusted is not the same as well-behaved. */
function RogueImpl(): ReactNode {
  return createElement("div", {
    "data-testid": "rogue",
    style: { position: "fixed", zIndex: 99_999 },
  });
}

const REGISTRY: ComponentRegistry = Object.freeze({
  Screen: ScreenImpl,
  Stack: StackImpl,
  Rogue: RogueImpl,
});

/** A screen holding a rogue component two levels down, beside a plain sibling. */
const DOCUMENT: ComponentDocument = {
  entry: "home",
  screens: ["n1"],
  nodes: {
    n1: { tag: "Screen", props: { name: { kind: "scalar", value: "home" } }, children: ["n2"] },
    n2: { tag: "Stack", props: {}, children: ["n3"] },
    n3: { tag: "Rogue", props: {}, children: [] },
  },
};

function context(): MountContext {
  return {
    document: DOCUMENT,
    index: INDEX,
    registry: REGISTRY,
    themeVars: {},
    copy: NEUTRAL_COPY_DEFAULTS,
    store: createFieldStore(),
    onAction: () => {},
    // No fixture here mounts a `Modal`, so this is never called. It is the
    // identity so that if one ever is, the content lands in the flow this file
    // is about rather than disappearing — mounting's own suite owns the proof
    // that a real Modal never takes that path.
    renderModal: ({ content }) => content,
  };
}

/** Every ancestor of `element`, nearest first, up to and including `<html>`. */
function ancestorsOf(element: Element): readonly Element[] {
  const chain: Element[] = [];
  let walk = element.parentElement;
  while (walk !== null) {
    chain.push(walk);
    walk = walk.parentElement;
  }
  return chain;
}

function isIsolated(element: Element): boolean {
  return globalThis.getComputedStyle(element).isolation === "isolate";
}

/**
 * Every error that escaped `run`.
 *
 * A render that throws with no boundary above it unwinds to the caller, and
 * React also reports it to the environment; jsdom turns the report into a window
 * `error` event. Collecting both and cancelling the report is what lets a
 * deliberately provoked failure be asserted without also being charged to the
 * run as an unhandled error.
 */
function errorsDuring(run: () => void): readonly string[] {
  const escaped: string[] = [];
  const record = (event: ErrorEvent): void => {
    escaped.push(event.error instanceof Error ? event.error.message : String(event.message));
    event.preventDefault();
  };
  window.addEventListener("error", record);
  try {
    run();
  } catch (error) {
    escaped.push(error instanceof Error ? error.message : String(error));
  } finally {
    window.removeEventListener("error", record);
  }
  return escaped;
}

describe("the containment element", () => {
  it("carries isolation, and carries nothing else", () => {
    expect(CONTAINMENT_STYLE).toEqual({ isolation: "isolate" });
    expect(Object.isFrozen(CONTAINMENT_STYLE)).toBe(true);
  });

  it("renders an isolated element around whatever it wraps", () => {
    const { container } = render(
      createElement(Containment, null, createElement("p", { "data-testid": "inner" }, "text")),
    );
    const wrapper = container.querySelector(`[${CONTAINMENT_ATTRIBUTE}]`);

    expect(wrapper).not.toBeNull();
    expect(isIsolated(wrapper as Element)).toBe(true);
    expect(wrapper?.querySelector('[data-testid="inner"]')).not.toBeNull();
  });
});

describe("mounted subtrees", () => {
  function mounted(): HTMLElement {
    return render(
      createElement(
        DataProvider,
        { model: {} },
        createElement(MountNode, { context: context(), nodeId: "n1" }),
      ),
    ).container;
  }

  it("puts a containment element around every mounted implementation", () => {
    const container = mounted();

    for (const testid of ["screen", "stack", "rogue"]) {
      const element = container.querySelector(`[data-testid="${testid}"]`);
      expect(element).not.toBeNull();
      const parent = (element as Element).parentElement;
      expect(parent?.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(true);
      expect(isIsolated(parent as Element)).toBe(true);
    }
  });

  it("leaves a component painting at z-index 99999 inside an isolated ancestor", () => {
    const container = mounted();
    const rogue = container.querySelector('[data-testid="rogue"]') as Element;

    // The component really does ask to be painted above everything.
    expect(globalThis.getComputedStyle(rogue).zIndex).toBe("99999");
    // And the number is resolved inside a stacking context the renderer owns,
    // so the escape reaches exactly as far as the subtree it was written in.
    const contained = ancestorsOf(rogue).filter(
      (ancestor) => ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE) && isIsolated(ancestor),
    );
    expect(contained.length).toBeGreaterThan(0);
  });
});

describe("the overlay root", () => {
  /** Reports the target `useOverlayRoot` answers with, so a test can inspect it. */
  function Probe({ report }: { readonly report: (target: HTMLElement | null) => void }): ReactNode {
    report(useOverlayRoot());
    return null;
  }

  it("renders one target element per provider", () => {
    const { container } = render(
      createElement(OverlayRootProvider, null, createElement("p", null, "stage")),
    );

    expect(container.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length).toBe(1);
  });

  it("is the element the hook answers with, once it is attached", () => {
    let seen: HTMLElement | null = null;
    const { container } = render(
      createElement(
        OverlayRootProvider,
        null,
        createElement(Probe, {
          report: (target: HTMLElement | null) => {
            seen = target;
          },
        }),
      ),
    );

    expect(seen).toBe(container.querySelector(`[${OVERLAY_ROOT_ATTRIBUTE}]`));
  });

  it("has no containment element and no isolated element among its ancestors", () => {
    // The property `ModalFrame` depends on, asserted by walking rather than by
    // inspecting the one composition this test happens to build.
    const { container } = render(
      createElement(
        OverlayRootProvider,
        null,
        createElement(
          DataProvider,
          { model: {} },
          createElement(MountNode, { context: context(), nodeId: "n1" }),
        ),
      ),
    );
    const target = container.querySelector(`[${OVERLAY_ROOT_ATTRIBUTE}]`) as Element;

    expect(container.querySelectorAll(`[${CONTAINMENT_ATTRIBUTE}]`).length).toBeGreaterThan(0);
    for (const ancestor of ancestorsOf(target)) {
      expect(ancestor.hasAttribute(CONTAINMENT_ATTRIBUTE)).toBe(false);
      expect(isIsolated(ancestor)).toBe(false);
    }
  });

  it("is a determinate error outside a provider, never a silent in-tree fallback", () => {
    const escaped = errorsDuring(() => {
      render(createElement(Probe, { report: () => {} }));
    });

    expect(escaped.length).toBeGreaterThan(0);
    expect(escaped.some((message) => message.includes("overlay root"))).toBe(true);
    // Nothing was rendered in place of the missing provider.
    expect(document.querySelectorAll(`[${OVERLAY_ROOT_ATTRIBUTE}]`).length).toBe(0);
  });
});

describe("the package barrel", () => {
  it("exports neither the containment module nor mounting", () => {
    // D-13: the overlay root is the single sanctioned containment opt-out, and
    // it is renderer-owned. Exporting it would hand a host the escape hatch.
    const barrel = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

    for (const banned of [
      "containment",
      "useOverlayRoot",
      "OverlayRootProvider",
      "mount-node",
      "mountOrFallback",
    ]) {
      expect(barrel).not.toContain(banned);
    }
  });
});
