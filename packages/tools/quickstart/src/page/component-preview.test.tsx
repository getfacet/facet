// @vitest-environment jsdom

import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { NEUTRAL_COPY_DEFAULTS } from "@facet/core";
import { bootstrapRenderer } from "@facet/react";
import type { RendererBootstrap } from "@facet/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentPreview } from "./component-preview.js";
import type { ComponentPreviewFixtureResult } from "./component-preview-fixtures.js";
import { previewFixtureForTag } from "./component-preview-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AcceptedBootstrap = Extract<RendererBootstrap, { readonly ok: true }>;

let mountedRoots: Root[] = [];

function previewFor(tag: string): ComponentPreviewFixtureResult {
  const result = previewFixtureForTag(tag);
  if (!result.ok) {
    throw new Error(`${tag} preview fixture failed: ${result.error.phase} ${result.error.code}`);
  }
  return result;
}

function invalidPreview(tag: string): ComponentPreviewFixtureResult {
  return Object.freeze({
    ok: false,
    tag,
    source: null,
    data: Object.freeze({}),
    error: Object.freeze({
      phase: "validate",
      code: "preview-invalid",
      detail: "Invalid preview fixture.",
    }),
  });
}

function throwingText(): ReactNode {
  throw new Error("preview text unavailable");
}

function throwingBootstrap(): AcceptedBootstrap {
  const registry = Object.freeze({
    ...DEFAULT_REGISTRY,
    Text: throwingText,
  });
  const result = bootstrapRenderer({
    catalog: DEFAULT_CATALOG,
    registry,
    theme: DEFAULT_THEME,
  });
  if (!result.ok) {
    throw new Error(`throwing bootstrap failed: ${result.code} at ${result.at}`);
  }
  return result;
}

function previews(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-facet-component-preview]")];
}

function renderView(ui: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return host;
}

function renderIntoRoot(ui: ReactNode): Root {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return root;
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  for (const candidate of document.querySelectorAll("button")) {
    if (candidate.textContent === name && candidate instanceof HTMLButtonElement) {
      return candidate;
    }
  }
  throw new Error(`Missing button: ${name}`);
}

function source(): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "component-preview.tsx"),
    "utf8",
  );
}

function withSilencedReactReport<Result>(run: () => Result): Result {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

function withFetchSpy(run: (spy: ReturnType<typeof vi.fn>) => void): void {
  const original = globalThis.fetch;
  const spy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  globalThis.fetch = spy as unknown as typeof fetch;
  try {
    run(spy);
  } finally {
    globalThis.fetch = original;
  }
}

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots = [];
  document.body.replaceChildren();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("ComponentPreview", () => {
  it("renders a validated mini document through the trusted default renderer", () => {
    renderView(<ComponentPreview result={previewFor("Text")} />);

    expect(document.body.textContent).toContain("Readable body copy for the preview.");
    expect(previews()).toHaveLength(1);
    expect(previews()[0]?.getAttribute("data-facet-component-preview")).toBe("Text");
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("ready");
    expect(document.querySelector("[data-facet-overlay-root]")).toBeTruthy();
  });

  it("isolates a throwing preview without sending an event", () => {
    withFetchSpy((fetchSpy) => {
      withSilencedReactReport(() => {
        renderView(
          <>
            <ComponentPreview result={previewFor("Text")} rendererBootstrap={throwingBootstrap()} />
            <ComponentPreview result={previewFor("Empty")} />
          </>,
        );
      });

      expect(previews()).toHaveLength(2);
      expect(previews()[0]?.textContent).toContain(
        NEUTRAL_COPY_DEFAULTS.render.componentUnavailable,
      );
      expect(previews()[0]?.textContent).not.toContain("preview text unavailable");
      expect(previews()[1]?.textContent).toContain("No records");

      click(buttonNamed("Refresh"));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("keeps an invalid preview fallback bounded to one preview", () => {
    renderView(
      <>
        <ComponentPreview result={invalidPreview("Broken")} />
        <ComponentPreview result={previewFor("Badge")} />
      </>,
    );

    expect(previews()).toHaveLength(2);
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("fallback");
    expect(previews()[0]?.textContent).toBe("Preview unavailable");
    expect(previews()[1]?.getAttribute("data-facet-component-preview-state")).toBe("ready");
    expect(previews()[1]?.textContent).toContain("Healthy");
  });

  it("isolates a wrapper render failure to the preview fallback", () => {
    withSilencedReactReport(() => {
      renderView(
        <>
          <ComponentPreview
            result={previewFor("Text")}
            renderContent={() => {
              throw new Error("preview wrapper exploded");
            }}
          />
          <ComponentPreview result={previewFor("Badge")} />
        </>,
      );
    });

    expect(previews()).toHaveLength(2);
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("fallback");
    expect(previews()[0]?.getAttribute("data-facet-component-preview-fallback")).toBe("render");
    expect(previews()[1]?.getAttribute("data-facet-component-preview-state")).toBe("ready");
    expect(previews()[1]?.textContent).toContain("Healthy");
  });

  it("recovers a failed preview boundary when the selected preview changes", () => {
    const root = withSilencedReactReport(() =>
      renderIntoRoot(
        <ComponentPreview
          result={previewFor("Text")}
          renderContent={() => {
            throw new Error("preview wrapper exploded");
          }}
        />,
      ),
    );

    expect(previews()).toHaveLength(1);
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("fallback");
    expect(previews()[0]?.getAttribute("data-facet-component-preview-fallback")).toBe("render");

    act(() => root.render(<ComponentPreview result={previewFor("Badge")} />));

    expect(previews()).toHaveLength(1);
    expect(previews()[0]?.getAttribute("data-facet-component-preview")).toBe("Badge");
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("ready");
    expect(previews()[0]?.textContent).toContain("Healthy");
  });

  it("recovers when two Screen patterns share the same tag and target node id", () => {
    const first = previewFor("Screen");
    if (!first.ok) throw new Error("Expected a valid Screen preview.");
    const second: ComponentPreviewFixtureResult = Object.freeze({
      ...first,
      fixture: Object.freeze({
        ...first.fixture,
        source: `${first.fixture.source}\n`,
      }),
    });
    expect(first.fixture.targetNodeId).toBe(second.fixture.targetNodeId);
    expect(first.fixture.source).not.toBe(second.fixture.source);

    const root = withSilencedReactReport(() =>
      renderIntoRoot(
        <ComponentPreview
          result={first}
          renderContent={() => {
            throw new Error("preview wrapper exploded");
          }}
        />,
      ),
    );
    expect(previews()[0]?.getAttribute("data-facet-component-preview-fallback")).toBe("render");

    act(() => root.render(<ComponentPreview result={second} />));

    expect(previews()[0]?.getAttribute("data-facet-component-preview")).toBe("Screen");
    expect(previews()[0]?.getAttribute("data-facet-component-preview-state")).toBe("ready");
  });

  it("does not wire preview actions to transport or live facet events", () => {
    withFetchSpy((fetchSpy) => {
      renderView(<ComponentPreview result={previewFor("Empty")} />);

      click(buttonNamed("Refresh"));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(source()).not.toMatch(
        /\b(?:fetch|SseTransport|LocalTransport|sendEvent|sendMessage|useFacet)\b/,
      );
      expect(source()).not.toMatch(/["']@facet\/(?:server|client|runtime|agent-client)["']/);
    });
  });

  it("keeps modal previews on the trusted modal frame path", () => {
    renderView(<ComponentPreview result={previewFor("Modal")} />);

    expect(document.querySelector('[data-facet-modal="frame"]')).toBeNull();
    click(buttonNamed("Open details"));

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Preview modal");
    expect(document.querySelectorAll('[data-facet-modal="frame"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-facet-modal="scrim"]')).toHaveLength(1);
    expect(source()).toContain("StageRenderer");
    expect(source()).not.toMatch(
      /\b(?:createPortal|ModalFrame|OverlayRootProvider|MODAL_PART_ATTRIBUTE|OVERLAY_Z_BAND)\b/,
    );
    expect(source()).not.toMatch(/\b(?:zIndex|position)\b/);
  });
});
