// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { validateTheme, type FacetTheme, type FacetTree, type ViewSnapshot } from "@facet/core";
import { DEFAULT_THEME } from "@facet/assets";
import { INPUT_TARGET_CSS } from "./brick-style-input.js";
import { INTERACTION_CSS } from "./interaction-style.js";
import { StageRenderer } from "./StageRenderer.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function testTheme(): FacetTheme {
  return {
    ...DEFAULT_THEME,
    name: "test-theme",
    tokens: {
      ...DEFAULT_THEME.tokens,
      space: { ...DEFAULT_THEME.tokens.space, md: "91px" },
      paint: {
        light: {
          ...DEFAULT_THEME.tokens.paint.light,
          color: {
            ...DEFAULT_THEME.tokens.paint.light.color,
            background: "#fefefe",
            foreground: "#111111",
          },
        },
        dark: {
          ...DEFAULT_THEME.tokens.paint.dark,
          color: {
            ...DEFAULT_THEME.tokens.paint.dark.color,
            background: "#020202",
            foreground: "#eeeeee",
          },
        },
      },
    },
  };
}

function borderlessBoxTheme(): FacetTheme {
  const boxDefault: Record<string, unknown> = { ...DEFAULT_THEME.defaults.box };
  delete boxDefault["borderWidth"];
  return {
    ...DEFAULT_THEME,
    name: "borderless-box-theme",
    defaults: {
      ...DEFAULT_THEME.defaults,
      box: boxDefault as FacetTheme["defaults"]["box"],
    },
  };
}

function styledTree(): FacetTree {
  return {
    root: "root",
    nodes: {
      root: {
        id: "root",
        type: "box",
        style: { padding: "md" },
        children: ["text", "input"],
      },
      text: {
        id: "text",
        type: "text",
        value: "survivor",
        style: { color: "foreground" },
      },
      input: { id: "input", type: "input", name: "email", placeholder: "Email" },
    },
  };
}

function rootBox(container: HTMLElement): HTMLElement {
  return container.querySelector("p")?.parentElement as HTMLElement;
}

function textNode(container: HTMLElement): HTMLElement {
  return container.querySelector("p") as HTMLElement;
}

function stubMatchMedia(initialDark: boolean): {
  setDark: (dark: boolean) => void;
  fireDarkChange: () => void;
} {
  let dark = initialDark;
  const darkListeners = new Set<() => void>();
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("prefers-color-scheme") ? dark : false,
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      if (query.includes("prefers-color-scheme")) darkListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => darkListeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  return {
    setDark: (next) => {
      dark = next;
    },
    fireDarkChange: () => {
      for (const listener of darkListeners) listener();
    },
  };
}

describe("StageRenderer Theme and colorMode", () => {
  it("gives an authored focus border a solid style when the valid Theme base omits borderWidth", () => {
    const theme = borderlessBoxTheme();
    expect(validateTheme(theme).theme).toBeDefined();

    const { container } = render(
      <StageRenderer
        theme={theme}
        tree={{
          root: "root",
          nodes: {
            root: {
              id: "root",
              type: "box",
              onPress: { kind: "agent", name: "focus" },
              style: { focus: { borderWidth: "medium" } },
              children: ["label"],
            },
            label: { id: "label", type: "text", value: "Focus me" },
          },
        }}
      />,
    );

    const button = container.querySelector('[role="button"]') as HTMLElement;
    expect(button.style.borderStyle).toBe("");
    expect(button.classList).toContain("facet-focus-borderWidth");
    expect(button.style.getPropertyValue("--facet-focus-borderWidth")).toBe("2px");
    expect(INTERACTION_CSS).toContain(
      ".facet-interaction.facet-focus-borderWidth:focus-visible{border-width:var(--facet-focus-borderWidth)!important;border-style:solid!important}",
    );
  });

  it("falls back hostile Themes and changes only paint", () => {
    const ordinary = testTheme();
    const cyclic = { ...ordinary } as FacetTheme & { self?: unknown };
    cyclic.self = cyclic;
    const throwing = new Proxy(ordinary, {
      get() {
        throw new Error("hostile theme read");
      },
    });
    const hostile: readonly unknown[] = [
      { name: "incomplete" },
      cyclic,
      throwing,
      new Proxy(ordinary, {
        ownKeys() {
          throw new Error("hostile theme keys");
        },
      }),
    ];

    for (const theme of hostile) {
      let container!: HTMLElement;
      expect(() => {
        container = render(
          <StageRenderer tree={styledTree()} theme={theme as FacetTheme} colorMode="dark" />,
        ).container;
      }).not.toThrow();
      expect(rootBox(container).style.padding).toBe(DEFAULT_THEME.tokens.space.md);
      expect(textNode(container).textContent).toBe("survivor");
      expect(container.innerHTML).not.toContain("hostile theme");
      cleanup();
    }

    const onAction = vi.fn();
    const onRecord = vi.fn();
    const onViewSnapshot = vi.fn<(snapshot: ViewSnapshot) => void>();
    const { container, rerender } = render(
      <StageRenderer
        tree={styledTree()}
        theme={ordinary}
        colorMode="light"
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
      />,
    );
    const lightPadding = rootBox(container).style.padding;
    const lightForeground = textNode(container).style.color;
    onViewSnapshot.mockClear();

    rerender(
      <StageRenderer
        tree={styledTree()}
        theme={ordinary}
        colorMode="dark"
        onAction={onAction}
        onRecord={onRecord}
        onViewSnapshot={onViewSnapshot}
      />,
    );

    expect(rootBox(container).style.padding).toBe(lightPadding);
    expect(lightPadding).toBe("91px");
    expect(textNode(container).style.color).not.toBe(lightForeground);
    expect(onAction).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    expect(onViewSnapshot).toHaveBeenCalled();
    expect(onViewSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ colorMode: "dark" });
  });

  it("resolves system mode, ignores media changes when forced, and injects fixed CSS once", () => {
    const media = stubMatchMedia(false);
    const onViewSnapshot = vi.fn<(snapshot: ViewSnapshot) => void>();
    const { container, rerender } = render(
      <StageRenderer
        tree={styledTree()}
        theme={testTheme()}
        colorMode="system"
        onViewSnapshot={onViewSnapshot}
      />,
    );
    expect(onViewSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ colorMode: "light" });

    media.setDark(true);
    act(() => media.fireDarkChange());
    expect(onViewSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ colorMode: "dark" });

    rerender(
      <StageRenderer
        tree={styledTree()}
        theme={testTheme()}
        colorMode="light"
        onViewSnapshot={onViewSnapshot}
      />,
    );
    const forcedCalls = onViewSnapshot.mock.calls.length;
    media.setDark(false);
    act(() => media.fireDarkChange());
    expect(onViewSnapshot.mock.calls).toHaveLength(forcedCalls);
    expect(onViewSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ colorMode: "light" });

    const styleText = Array.from(container.querySelectorAll("style"), (style) => style.textContent);
    expect(
      styleText.filter((text) => text === `${INTERACTION_CSS}\n${INPUT_TARGET_CSS}`),
    ).toHaveLength(1);
  });
});
