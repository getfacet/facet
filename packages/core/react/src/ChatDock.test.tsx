// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatDock } from "./ChatDock.js";
import { COLOR } from "./theme.js";

describe("ChatDock palette usage", () => {
  it("ChatDock uses shared palette values instead of stale literal hexes", () => {
    const { container } = render(<ChatDock messages={[]} onSend={() => undefined} />);
    const dock = container.firstElementChild as HTMLElement | null;
    const surface = document.createElement("div");
    surface.style.background = COLOR.surface;

    expect(dock).not.toBeNull();
    expect(dock!.style.background).toBe(surface.style.background);
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
