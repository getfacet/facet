// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentDocument } from "@facet/core";

import { AssetExplorer } from "./asset-explorer.js";
import { Page } from "./main.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubEventSource {
  static instances: StubEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = StubEventSource.CONNECTING;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    StubEventSource.instances.push(this);
  }

  addEventListener(): void {
    // no-op
  }

  removeEventListener(): void {
    // no-op
  }

  dispatchEvent(): boolean {
    return false;
  }

  close(): void {
    this.readyState = StubEventSource.CLOSED;
  }
}

let mountedRoots: Root[] = [];
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  StubEventSource.instances = [];
  const globals = globalThis as {
    EventSource?: unknown;
    fetch?: unknown;
  };
  globals.EventSource = StubEventSource;
  globals.fetch = (input: RequestInfo | URL): Promise<Response> => {
    fetchCalls.push(String(input));
    return Promise.resolve(new Response("{}", { status: 202, headers: {} }));
  };
});

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots = [];
  document.body.replaceChildren();
  document.body.style.overflow = "";
  delete window.__FACET_INITIAL_STAGE__;
  delete window.__FACET_THEME__;
  delete window.__FACET_POST_TIMEOUT_MS__;
  vi.restoreAllMocks();
});

function scalar(value: string): ComponentDocument["nodes"][string]["props"][string] {
  return Object.freeze({ kind: "scalar" as const, value });
}

function modalDocument(): ComponentDocument {
  return Object.freeze({
    entry: "home",
    screens: Object.freeze(["home", "details"]),
    nodes: Object.freeze({
      home: Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("home") }),
        children: Object.freeze(["go"]),
      }),
      go: Object.freeze({
        tag: "Button",
        props: Object.freeze({
          label: scalar("View details"),
          action: scalar("nav:details"),
        }),
        children: Object.freeze([]),
      }),
      details: Object.freeze({
        tag: "Screen",
        props: Object.freeze({ name: scalar("details") }),
        children: Object.freeze(["modal"]),
      }),
      modal: Object.freeze({
        tag: "Modal",
        props: Object.freeze({
          triggerLabel: scalar("Open details"),
          title: scalar("Live modal"),
          description: scalar("Modal opened before visiting Assets."),
        }),
        children: Object.freeze(["field"]),
      }),
      field: Object.freeze({
        tag: "Field",
        props: Object.freeze({
          name: scalar("region"),
          label: scalar("Region"),
          value: scalar(""),
        }),
        children: Object.freeze([]),
      }),
    }),
  });
}

function render(ui: ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  act(() => root.render(ui));
  return host;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openLatestStream(): Promise<void> {
  const source = StubEventSource.instances[StubEventSource.instances.length - 1];
  if (source === undefined) {
    throw new Error("Expected quickstart page to subscribe to the event stream");
  }
  act(() => {
    source.readyState = StubEventSource.OPEN;
    source.onopen?.({});
  });
  await flushEffects();
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function keyDown(element: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }),
    );
  });
}

function documentKeyDown(key: string): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  });
}

function firstTextInput(container: ParentNode): HTMLInputElement {
  const input = container.querySelector('input[type="text"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Missing text input");
  }
  return input;
}

function changeInput(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("Missing HTMLInputElement value setter");
  }
  act(() => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  });
}

function changeTextArea(input: HTMLTextAreaElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("Missing HTMLTextAreaElement value setter");
  }
  act(() => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  });
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  for (const candidate of container.querySelectorAll("button")) {
    if (candidate.textContent?.includes(name) === true && candidate instanceof HTMLButtonElement) {
      return candidate;
    }
  }
  throw new Error(`Missing button: ${name}`);
}

function buttonWithLabel(container: ParentNode, label: string): HTMLButtonElement {
  const candidate = container.querySelector(`button[aria-label="${label}"]`);
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Missing button with label: ${label}`);
  }
  return candidate;
}

describe("AssetExplorer", () => {
  it("does not send an automatic visit turn when a boot seed is already visible", async () => {
    window.__FACET_INITIAL_STAGE__ = modalDocument();
    const container = render(<Page assetExplorer={<div data-facet-asset-explorer />} />);
    await openLatestStream();
    await flushEffects();

    expect(container.querySelector("[data-facet-stage]")).toBeInstanceOf(HTMLElement);
    expect(fetchCalls.filter((url) => url.endsWith("/event"))).toHaveLength(0);
    click(buttonWithLabel(container, "Open chat"));
    const textarea = container.querySelector('textarea[aria-label="Message"]');
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    changeTextArea(textarea as HTMLTextAreaElement, "change the visible page");
    expect(buttonNamed(container, "Send").disabled).toBe(false);
  });

  it("keeps live chat in a polished floating composer", async () => {
    const container = render(<Page assetExplorer={<div data-facet-asset-explorer />} />);
    await openLatestStream();
    await flushEffects();

    const toggle = buttonWithLabel(container, "Open chat");
    const drawer = container.querySelector("[data-facet-chat-drawer]");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(drawer).toBeInstanceOf(HTMLElement);
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
    expect((drawer as HTMLElement).style.visibility).toBe("hidden");
    expect((drawer as HTMLElement).style.opacity).toBe("0");
    expect((toggle as HTMLElement).style.position).toBe("fixed");
    expect((toggle as HTMLElement).style.right).toBe("1.5rem");
    expect((toggle as HTMLElement).style.bottom).toBe("1.5rem");

    click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(drawer?.getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector("[data-facet-message-form]")).toBeInstanceOf(HTMLFormElement);
    expect((drawer as HTMLElement).style.position).toBe("fixed");
    expect((drawer as HTMLElement).style.right).toBe("1.5rem");
    expect((drawer as HTMLElement).style.bottom).toBe("5.25rem");
    expect((drawer as HTMLElement).style.transformOrigin).toBe("bottom right");
    expect((drawer as HTMLElement).style.opacity).toBe("1");
    expect(container.querySelector("[data-facet-chat-conversation]")).toBeNull();
    expect(container.querySelector("[data-facet-chat-status]")?.textContent).toBe("Ready");
    expect(buttonNamed(container, "Send").disabled).toBe(true);

    const textarea = container.querySelector('textarea[aria-label="Message"]');
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    changeTextArea(textarea as HTMLTextAreaElement, "support triage");
    expect(buttonNamed(container, "Send").disabled).toBe(false);

    click(buttonWithLabel(container, "Close chat"));

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(drawer?.getAttribute("aria-hidden")).toBe("true");
    expect((drawer as HTMLElement).style.visibility).toBe("hidden");
  });

  it("submits the live chat with Enter and preserves Shift+Enter for drafts", async () => {
    const container = render(<Page assetExplorer={<div data-facet-asset-explorer />} />);
    await openLatestStream();
    await flushEffects();

    click(buttonWithLabel(container, "Open chat"));
    const textarea = container.querySelector('textarea[aria-label="Message"]');
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);

    changeTextArea(textarea as HTMLTextAreaElement, "hello quickstart");
    keyDown(textarea as HTMLTextAreaElement, "Enter", { shiftKey: true });
    await flushEffects();

    expect(fetchCalls.filter((url) => url.endsWith("/message"))).toHaveLength(0);
    expect((textarea as HTMLTextAreaElement).value).toBe("hello quickstart");

    keyDown(textarea as HTMLTextAreaElement, "Enter");
    await flushEffects();

    expect(fetchCalls.filter((url) => url.endsWith("/message"))).toHaveLength(1);
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("uses the boot-provided POST timeout for live chat messages", async () => {
    window.__FACET_INITIAL_STAGE__ = modalDocument();
    window.__FACET_POST_TIMEOUT_MS__ = 77_000;
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const container = render(<Page assetExplorer={<div data-facet-asset-explorer />} />);
    await openLatestStream();
    await flushEffects();

    click(buttonWithLabel(container, "Open chat"));
    const textarea = container.querySelector('textarea[aria-label="Message"]');
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);

    changeTextArea(textarea as HTMLTextAreaElement, "hello quickstart");
    keyDown(textarea as HTMLTextAreaElement, "Enter");
    await flushEffects();

    expect(timeout).toHaveBeenCalledWith(77_000);
    expect(fetchCalls.filter((url) => url.endsWith("/message"))).toHaveLength(1);
  });

  it("keeps inspector interactions local to the asset explorer", async () => {
    const container = render(
      <Page
        assetExplorer={
          <div data-facet-asset-explorer>
            <div data-facet-theme-inspector />
          </div>
        }
      />,
    );
    await openLatestStream();
    await flushEffects();
    fetchCalls = [];

    const stage = container.querySelector("[data-facet-stage]");
    expect(stage).toBeInstanceOf(HTMLElement);
    const revisionBefore = stage?.getAttribute("data-facet-stage-revision");

    expect(container.querySelector("[data-facet-chat-drawer]")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-facet-message-form]")).toBeInstanceOf(HTMLFormElement);

    click(buttonNamed(container, "Assets"));
    expect(container.querySelector("[data-facet-asset-explorer]")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-facet-theme-inspector]")).toBeInstanceOf(HTMLElement);

    expect(fetchCalls).toEqual([]);
    expect(
      container.querySelector("[data-facet-stage]")?.getAttribute("data-facet-stage-revision"),
    ).toBe(revisionBefore);
    expect(container.querySelector("[data-facet-chat-drawer]")).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-facet-message-form]")).toBeInstanceOf(HTMLFormElement);
  });

  it("preserves asset explorer state after returning from Live", async () => {
    const container = render(
      <Page
        assetExplorer={
          <div data-facet-asset-explorer>
            <input data-facet-assets-filter type="text" />
          </div>
        }
      />,
    );
    await openLatestStream();
    await flushEffects();

    click(buttonNamed(container, "Assets"));
    const input = container.querySelector("[data-facet-assets-filter]");
    expect(input).toBeInstanceOf(HTMLInputElement);

    changeInput(input as HTMLInputElement, "button");
    click(buttonNamed(container, "Live"));
    await flushEffects();
    click(buttonNamed(container, "Assets"));

    const restoredInput = container.querySelector("[data-facet-assets-filter]");
    expect(restoredInput).toBe(input);
    expect((restoredInput as HTMLInputElement).value).toBe("button");
  });

  it("releases live modal scroll locks without resetting local live state", async () => {
    document.body.style.overflow = "scroll";
    window.__FACET_INITIAL_STAGE__ = modalDocument();
    const container = render(<Page assetExplorer={<div data-facet-asset-explorer />} />);
    await openLatestStream();
    await flushEffects();

    click(buttonNamed(container, "View details"));
    click(buttonNamed(container, "Open details"));
    changeInput(firstTextInput(document), "emea");

    expect(document.querySelector('[role="dialog"]')).toBeInstanceOf(HTMLElement);
    expect(firstTextInput(document).value).toBe("emea");
    expect(document.body.style.overflow).toBe("hidden");
    const tabShell = container.querySelector('[aria-label="Quickstart spaces"]')?.parentElement;
    expect(tabShell).toBeInstanceOf(HTMLElement);
    expect((tabShell as HTMLElement).style.position).toBe("");
    expect((tabShell as HTMLElement).style.order).toBe("");
    expect(
      (tabShell as HTMLElement).compareDocumentPosition(
        container.querySelector("[data-facet-live-space]") as HTMLElement,
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      (tabShell as HTMLElement).compareDocumentPosition(
        container.querySelector("[data-facet-assets-space]") as HTMLElement,
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const assetsButton = buttonNamed(container, "Assets");
    const modalAssetsButton = buttonNamed(container, "Open Assets");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    firstTextInput(document).focus();
    keyDown(firstTextInput(document), "Tab");
    expect(document.activeElement).toBe(modalAssetsButton);
    click(modalAssetsButton);
    await flushEffects();

    expect(container.querySelector("[data-facet-asset-explorer]")).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(true);
    expect(buttonNamed(container, "Open details").getAttribute("aria-expanded")).toBe("false");
    expect(document.body.style.overflow).toBe("scroll");
    expect(container.querySelector("[data-facet-stage]")).toBeInstanceOf(HTMLElement);
    expect(firstTextInput(document).value).toBe("emea");
    expect(document.activeElement).toBe(assetsButton);

    click(buttonNamed(container, "Live"));

    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
    expect(firstTextInput(document).value).toBe("emea");
  });

  it("suppresses hidden asset preview modals when returning to Live", async () => {
    document.body.style.overflow = "scroll";
    const container = render(<Page />);
    await openLatestStream();
    await flushEffects();

    click(buttonNamed(container, "Assets"));
    click(buttonNamed(container, "Components"));
    click(buttonNamed(container, "Modal"));
    click(buttonNamed(document, "Open details"));
    await flushEffects();

    const previewDialog = document.querySelector('[role="dialog"]');
    expect(previewDialog).toBeInstanceOf(HTMLElement);
    expect(previewDialog?.hasAttribute("hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
    expect(buttonNamed(document, "Open details").getAttribute("aria-expanded")).toBe("true");

    click(buttonNamed(container, "Live"));
    await flushEffects();

    expect(previewDialog?.hasAttribute("hidden")).toBe(true);
    expect(document.body.style.overflow).toBe("scroll");

    documentKeyDown("Escape");
    await flushEffects();
    click(buttonNamed(container, "Assets"));
    await flushEffects();

    expect(previewDialog?.hasAttribute("hidden")).toBe(false);
    expect(buttonNamed(document, "Open details").getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
  }, 60_000);

  it("mounts Design System, Components, and Screens without adding a primary Catalog tab", () => {
    const container = render(
      <AssetExplorer
        themeInspector={<div data-facet-theme-inspector />}
        componentInspector={<div data-facet-component-inspector />}
        screenGallery={<div data-facet-screen-gallery />}
      />,
    );
    const explorer = container.querySelector("[data-facet-asset-explorer]");

    expect(explorer).toBeInstanceOf(HTMLElement);
    expect(container.querySelector("[data-facet-theme-inspector]")).toBeInstanceOf(HTMLElement);
    expect(
      [...container.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent === "Catalog"),
    ).toBe(false);
    const themeTab = container.querySelector('[data-facet-asset-tab="theme"]');
    const componentsTab = container.querySelector('[data-facet-asset-tab="components"]');
    const screensTab = container.querySelector('[data-facet-asset-tab="screens"]');
    const panel = container.querySelector("[data-facet-asset-explorer-body]");
    expect(themeTab).toBeInstanceOf(HTMLButtonElement);
    expect(componentsTab).toBeInstanceOf(HTMLButtonElement);
    expect(screensTab).toBeInstanceOf(HTMLButtonElement);
    expect(themeTab?.textContent).toBe("Design System");
    expect(componentsTab?.textContent).toBe("Components");
    expect(screensTab?.textContent).toBe("Screens");
    expect(panel).toBeInstanceOf(HTMLElement);
    expect(themeTab?.getAttribute("aria-selected")).toBe("true");
    expect(componentsTab?.getAttribute("aria-selected")).toBe("false");
    expect(screensTab?.getAttribute("aria-selected")).toBe("false");
    const themePanel = container.querySelector('[data-facet-asset-panel="theme"]');
    const componentsPanel = container.querySelector('[data-facet-asset-panel="components"]');
    const screensPanel = container.querySelector('[data-facet-asset-panel="screens"]');
    expect(themePanel).toBeInstanceOf(HTMLElement);
    expect(componentsPanel).toBeInstanceOf(HTMLElement);
    expect(screensPanel).toBeInstanceOf(HTMLElement);
    expect(themePanel?.hasAttribute("hidden")).toBe(false);
    expect(componentsPanel?.hasAttribute("hidden")).toBe(true);
    expect(screensPanel?.hasAttribute("hidden")).toBe(true);
    expect(themeTab?.getAttribute("aria-controls")).toBe(themePanel?.id);
    expect(componentsTab?.getAttribute("aria-controls")).toBe(componentsPanel?.id);
    expect(screensTab?.getAttribute("aria-controls")).toBe(screensPanel?.id);
    expect(themePanel?.getAttribute("aria-labelledby")).toBe(themeTab?.id);
    expect(componentsPanel?.getAttribute("aria-labelledby")).toBe(componentsTab?.id);
    expect(screensPanel?.getAttribute("aria-labelledby")).toBe(screensTab?.id);
    for (const tab of [themeTab, componentsTab, screensTab]) {
      const controlled = tab?.getAttribute("aria-controls");
      expect(controlled).not.toBeNull();
      expect(document.getElementById(controlled ?? "")?.getAttribute("role")).toBe("tabpanel");
    }

    click(buttonNamed(container, "Components"));

    expect(container.querySelector("[data-facet-component-inspector]")).toBeInstanceOf(HTMLElement);
    expect(themeTab?.getAttribute("aria-selected")).toBe("false");
    expect(componentsTab?.getAttribute("aria-selected")).toBe("true");
    expect(themePanel?.hasAttribute("hidden")).toBe(true);
    expect(componentsPanel?.hasAttribute("hidden")).toBe(false);
    expect(componentsTab?.getAttribute("aria-controls")).toBe(componentsPanel?.id);
    expect(componentsPanel?.getAttribute("aria-labelledby")).toBe(componentsTab?.id);

    click(buttonNamed(container, "Screens"));

    expect(container.querySelector("[data-facet-screen-gallery]")).toBeInstanceOf(HTMLElement);
    expect(screensTab?.getAttribute("aria-selected")).toBe("true");
    expect(componentsPanel?.hasAttribute("hidden")).toBe(true);
    expect(screensPanel?.hasAttribute("hidden")).toBe(false);
  });

  it("uses stable responsive containers for the asset space", () => {
    const container = render(<AssetExplorer themeInspector={<div data-facet-theme-inspector />} />);
    const explorer = container.querySelector("[data-facet-asset-explorer]");
    const body = container.querySelector("[data-facet-asset-explorer-body]");

    expect(explorer).toBeInstanceOf(HTMLElement);
    expect((explorer as HTMLElement).style.minWidth).toBe("0px");
    expect((explorer as HTMLElement).style.overflowWrap).toBe("anywhere");
    expect(body).toBeInstanceOf(HTMLElement);
    expect((body as HTMLElement).style.minWidth).toBe("0px");
  }, 60_000);

  it("keeps asset shell free of transport and stage APIs", () => {
    const source = readFileSync("packages/tools/quickstart/src/page/asset-explorer.tsx", "utf8");

    expect(source).not.toMatch(
      /\b(?:fetch|SseTransport|LocalTransport|StageRenderer|useFacet|sendEvent|sendMessage)\b/,
    );
    expect(source).not.toMatch(/["']@facet\/(?:server|client|runtime|react|agent-client)["']/);
  });
});
