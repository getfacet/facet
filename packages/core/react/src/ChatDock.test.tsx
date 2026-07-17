// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatDock } from "./ChatDock.js";
import { COLOR } from "./theme.js";

describe("ChatDock palette usage", () => {
  it("maps renderer chrome to the current shared paint tokens", () => {
    const { container } = render(
      <ChatDock messages={[]} onSend={() => undefined} pending={true} />,
    );
    const dock = container.firstElementChild as HTMLElement | null;
    const log = dock?.firstElementChild as HTMLElement | null;
    const pending = container.querySelector("[style*='font-style: italic']") as HTMLElement | null;
    const input = container.querySelector("input");
    const inputRow = input?.parentElement ?? null;
    const button = container.querySelector("button");
    const surface = document.createElement("div");
    surface.style.background = COLOR.surface;
    const foreground = document.createElement("div");
    foreground.style.color = COLOR.foreground;
    const mutedForeground = document.createElement("div");
    mutedForeground.style.color = COLOR.mutedForeground;
    const mutedSurface = document.createElement("div");
    mutedSurface.style.borderTop = `1px solid ${COLOR.mutedSurface}`;
    const accentForeground = document.createElement("div");
    accentForeground.style.color = COLOR.accentForeground;

    expect(dock).not.toBeNull();
    expect(dock!.style.background).toBe(surface.style.background);
    expect(log).not.toBeNull();
    expect(log!.style.color).toBe(foreground.style.color);
    expect(pending).not.toBeNull();
    expect(pending!.style.color).toBe(mutedForeground.style.color);
    expect(inputRow).not.toBeNull();
    expect(inputRow!.style.borderTop).toBe(mutedSurface.style.borderTop);
    expect(button).not.toBeNull();
    expect(button!.style.color).toBe(accentForeground.style.color);
  });

  it("form controls inherit the host page font", () => {
    const { container } = render(<ChatDock messages={[]} onSend={() => undefined} />);
    const input = container.querySelector("input");
    const button = container.querySelector("button");

    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    expect(input!.style.fontFamily).toBe("inherit");
    expect(button!.style.fontFamily).toBe("inherit");
  });
});
