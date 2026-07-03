// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAX_FIELD_VALUE_CHARS, type FacetNode, type FacetTree, type NodeId } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";

afterEach(cleanup);

const tree = (nodes: Record<NodeId, FacetNode>, root: NodeId = "root"): FacetTree => ({
  root,
  nodes,
});

/** A two-screen tree: entry "home" (with a navigate button) and "about". */
const screensTree = (): FacetTree => ({
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: ["rootText"] },
    rootText: { id: "rootText", type: "text", value: "plain root content" },
    home: { id: "home", type: "box", children: ["homeText", "goAbout"] },
    homeText: { id: "homeText", type: "text", value: "home content" },
    goAbout: {
      id: "goAbout",
      type: "box",
      onPress: { kind: "navigate", to: "about" },
      children: [],
    },
    about: { id: "about", type: "box", children: ["aboutText"] },
    aboutText: { id: "aboutText", type: "text", value: "about content" },
  },
  screens: { home: "home", about: "about" },
  entry: "home",
});

// renderToStaticMarkup (StageRenderer.test.ts) covers static output + fail-safe.
// These jsdom tests cover the INTERACTION path — clicks reaching onAction — which
// a string render can't exercise. This is the seam the action-vocabulary work builds on.
describe("StageRenderer interactions (jsdom)", () => {
  it("fires onAction with the box's action when a pressable box is clicked", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: {
            id: "root",
            type: "box",
            onPress: { name: "go", payload: { id: "7" } },
            children: ["t"],
          },
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // The renderer stamps the canonical kind on legacy bare {name} actions at emit time.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go", payload: { id: "7" } });
  });

  it("filters non-primitive payload values from a raw-path press", () => {
    const onAction = vi.fn();
    const rootWithNoisyPayload = {
      id: "root",
      type: "box",
      onPress: { name: "go", payload: { ok: 1, bad: { nested: true }, alsoBad: [1] } },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: rootWithNoisyPayload,
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // Only string/number/boolean payload values survive (mirror of core asAction).
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go", payload: { ok: 1 } });
  });

  it("emits no payload for an array payload from a raw-path press", () => {
    const onAction = vi.fn();
    const rootWithArrayPayload = {
      id: "root",
      type: "box",
      onPress: { name: "go", payload: ["a", 5] },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: rootWithArrayPayload,
          t: { id: "t", type: "text", value: "press me" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // An array is not a payload object (mirror of core asAction/isObject) — omit it entirely.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "go" });
  });

  it("does not expose a button for a non-pressable box", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "static" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a field as an input (value capture is a planned feature)", () => {
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["f"] },
          f: { id: "f", type: "field", name: "email", input: "email", placeholder: "you@x.com" },
        })}
      />,
    );
    const input = screen.getByPlaceholderText("you@x.com") as HTMLInputElement;
    expect(input.name).toBe("email");
    expect(input.type).toBe("email");
    // NOTE: typing does NOT yet reach onAction — field-value transport is the
    // planned UI-IN work. When it lands, extend this to assert the captured value.
  });

  it("renders a box with an unknown-kind onPress as non-pressable (never a button)", () => {
    const rootWithAlienPress = {
      id: "root",
      type: "box",
      onPress: { kind: "mystery", name: "x" },
      children: ["t"],
    } as unknown as FacetNode;
    render(
      <StageRenderer
        tree={tree({
          root: rootWithAlienPress,
          t: { id: "t", type: "text", value: "inert" },
        })}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("inert")).toBeTruthy();
  });
});

describe("StageRenderer screens + navigate (jsdom)", () => {
  it("navigate press switches the rendered screen without calling onAction", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={screensTree()} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(screen.queryByText("plain root content")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("navigate to an unknown screen no-ops (stays on the current screen, no emission)", () => {
    const onAction = vi.fn();
    const base = screensTree();
    const withDeadLink: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        goAbout: {
          id: "goAbout",
          type: "box",
          onPress: { kind: "navigate", to: "nowhere" },
          children: [],
        },
      },
    };
    render(<StageRenderer onAction={onAction} tree={withDeadLink} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("falls back to entry when the current screen is deleted by a new tree", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"
    expect(screen.getByText("about content")).toBeTruthy();

    const base = screensTree();
    const aboutDeleted: FacetTree = {
      root: base.root,
      nodes: {
        root: base.nodes["root"] as FacetNode,
        rootText: base.nodes["rootText"] as FacetNode,
        home: base.nodes["home"] as FacetNode,
        homeText: base.nodes["homeText"] as FacetNode,
        goAbout: base.nodes["goAbout"] as FacetNode,
      },
      screens: { home: "home" },
      entry: "home",
    };
    rerender(<StageRenderer onAction={onAction} tree={aboutDeleted} />);

    expect(screen.getByText("home content")).toBeTruthy();
    expect(screen.queryByText("about content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("treats a screen whose target is a NON-box node as not live and falls back (matches sanitizeScreens)", () => {
    // A raw-path patch can point a screen at a text node; sanitizeScreens drops
    // such a target on the stored tree, so the live fail-safe must NOT render the
    // text node as the whole screen — it falls back to the plain root instead.
    const onAction = vi.fn();
    const badScreen: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rootText"] },
        rootText: { id: "rootText", type: "text", value: "plain root content" },
        txt: { id: "txt", type: "text", value: "text screen content" },
      },
      screens: { home: "txt" },
      entry: "home",
    };
    render(<StageRenderer onAction={onAction} tree={badScreen} />);

    expect(screen.getByText("plain root content")).toBeTruthy();
    expect(screen.queryByText("text screen content")).toBeNull();
  });

  it("falls back to the first live screen when the current screen AND entry are both dead", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // currentScreen = "about"

    const bothDead: FacetTree = {
      root: "root",
      nodes: {
        root: { id: "root", type: "box", children: ["rootText"] },
        rootText: { id: "rootText", type: "text", value: "plain root content" },
        c: { id: "c", type: "box", children: ["cText"] },
        cText: { id: "cText", type: "text", value: "third screen content" },
      },
      // "about" (the current screen) and the entry both point at dead nodes.
      screens: { about: "goneNode", zeta: "c" },
      entry: "about",
    };
    rerender(<StageRenderer onAction={onAction} tree={bothDead} />);

    expect(screen.getByText("third screen content")).toBeTruthy();
    expect(screen.queryByText("plain root content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("stays on a live current screen across a rerender with a patched tree (DC-008)", () => {
    const onAction = vi.fn();
    const { rerender } = render(<StageRenderer onAction={onAction} tree={screensTree()} />);
    fireEvent.click(screen.getByRole("button")); // now on "about"

    const base = screensTree();
    const patched: FacetTree = {
      ...base,
      nodes: {
        ...base.nodes,
        about: { id: "about", type: "box", children: ["aboutText", "aboutExtra"] },
        aboutExtra: { id: "aboutExtra", type: "text", value: "fresh about line" },
      },
    };
    rerender(<StageRenderer onAction={onAction} tree={patched} />);

    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.getByText("fresh about line")).toBeTruthy();
    expect(screen.queryByText("home content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("StageRenderer toggle (jsdom)", () => {
  it("toggle hides then shows a visible panel across two clicks, browser-local", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "panel"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "panel" },
            children: [],
          },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "panel content" },
        })}
      />,
    );

    expect(screen.getByText("panel content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("panel content")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("panel content")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle shows then hides an initially-hidden (hidden: true) panel", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "menu"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "menu" },
            children: [],
          },
          menu: { id: "menu", type: "box", hidden: true, children: ["m"] },
          m: { id: "m", type: "text", value: "menu content" },
        })}
      />,
    );

    expect(screen.queryByText("menu content")).toBeNull(); // hidden on first paint
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("menu content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("menu content")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("toggle on an unknown target no-ops (no crash, no emission)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["btn", "t"] },
          btn: {
            id: "btn",
            type: "box",
            onPress: { kind: "toggle", target: "ghost" },
            children: [],
          },
          t: { id: "t", type: "text", value: "steady" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("steady")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });
});

// Collect (DC-001/002/003): a press whose agent action declares `collect` snapshots
// the VISIBLE, MOUNTED field values inside that box's subtree into a second
// onAction argument. Inputs stay uncontrolled (invariant #6): the DOM owns the
// text, nothing writes values into the tree, and typing alone emits no traffic.
describe("StageRenderer collect (jsdom)", () => {
  /** name+email form in box "form"; a submit button collecting it. */
  const formTree = (): FacetTree =>
    tree({
      root: { id: "root", type: "box", children: ["form", "submit"] },
      form: { id: "form", type: "box", children: ["nameF", "emailF"] },
      nameF: { id: "nameF", type: "field", name: "name", placeholder: "your name" },
      emailF: { id: "emailF", type: "field", name: "email", placeholder: "your email" },
      submit: {
        id: "submit",
        type: "box",
        onPress: { kind: "agent", name: "submit", collect: "form" },
        children: ["st"],
      },
      st: { id: "st", type: "text", value: "Send" },
    });

  it("collect press delivers the typed field values alongside the action", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "ada@lovelace.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { name: "Ada", email: "ada@lovelace.dev" },
    );
  });

  it("typing alone emits nothing (field text is browser view-state)", () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    const input = screen.getByPlaceholderText("your name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ada" } });

    expect(input.value).toBe("Ada"); // uncontrolled input keeps the text
    expect(onAction).not.toHaveBeenCalled();
  });

  it("captures a visible field's value even when an earlier same-named field is hidden", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["hiddenBox", "visibleF", "submit"] },
          hiddenBox: { id: "hiddenBox", type: "box", hidden: true, children: ["dupHidden"] },
          dupHidden: { id: "dupHidden", type: "field", name: "email", placeholder: "hidden dup" },
          visibleF: { id: "visibleF", type: "field", name: "email", placeholder: "visible email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "root" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("visible email"), {
      target: { value: "typed@x.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The earlier (hidden) same-named field must NOT shadow the visible one.
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { email: "typed@x.dev" },
    );
  });

  it("never harvests a password field's value", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["userF", "passF"] },
          userF: { id: "userF", type: "field", name: "user", placeholder: "user" },
          passF: {
            id: "passF",
            type: "field",
            name: "password",
            input: "password",
            placeholder: "secret",
          },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "login", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Log in" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("user"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("secret"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    // The password value is excluded outright; only the non-secret field rides.
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "login" }, { user: "ada" });
  });

  it("unknown collect id degrades to empty fields, never a throw", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["submit"] },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "ghost" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("collect on a target with zero fields delivers {}", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["panel", "submit"] },
          panel: { id: "panel", type: "box", children: ["p"] },
          p: { id: "p", type: "text", value: "no inputs here" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "panel" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("non-field nodes in the collect subtree contribute nothing", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["heading", "pic", "inner"] },
          heading: { id: "heading", type: "text", value: "Sign up" },
          pic: { id: "pic", type: "image", src: "https://example.com/a.png", alt: "pic" },
          inner: { id: "inner", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "field", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "a@b.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "a@b.dev" });
  });

  it("does not collect a same-named field OUTSIDE the collect subtree", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["outsideF", "form", "submit"] },
          outsideF: { id: "outsideF", type: "field", name: "email", placeholder: "outside" },
          form: { id: "form", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "field", name: "email", placeholder: "inside" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("outside"), { target: { value: "evil@x" } });
    fireEvent.change(screen.getByPlaceholderText("inside"), { target: { value: "good@x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "good@x" });
  });

  it("duplicate field names inside the subtree: the first in walk order wins", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["first", "inner"] },
          first: { id: "first", type: "field", name: "email", placeholder: "first" },
          inner: { id: "inner", type: "box", children: ["second"] },
          second: { id: "second", type: "field", name: "email", placeholder: "second" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("first"), { target: { value: "first@x" } });
    fireEvent.change(screen.getByPlaceholderText("second"), { target: { value: "second@x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { email: "first@x" });
  });

  it(`truncates a value longer than the cap to MAX_FIELD_VALUE_CHARS`, () => {
    const onAction = vi.fn();
    render(<StageRenderer onAction={onAction} tree={formTree()} />);

    fireEvent.change(screen.getByPlaceholderText("your name"), {
      target: { value: "x".repeat(MAX_FIELD_VALUE_CHARS + 25) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    const fields = onAction.mock.calls[0]?.[1] as Record<string, string>;
    expect(fields["name"]).toBe("x".repeat(MAX_FIELD_VALUE_CHARS));
    expect(fields["email"]).toBe("");
  });

  it(`caps a field NAME longer than the cap so the server never rejects the submit`, () => {
    const onAction = vi.fn();
    const longName = "n".repeat(MAX_FIELD_VALUE_CHARS + 25);
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["f"] },
          f: { id: "f", type: "field", name: longName, placeholder: "x" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const fields = onAction.mock.calls[0]?.[1] as Record<string, string>;
    const key = Object.keys(fields)[0] ?? "";
    expect(key.length).toBe(MAX_FIELD_VALUE_CHARS); // capped, so isFieldsRecord accepts it
    expect(fields[key]).toBe("v");
  });

  it("terminates on a cyclic collect subtree and keeps the fields it reached", () => {
    const onAction = vi.fn();
    // form → loop → form (cycle); the raw live-patch path can produce this.
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["nameF", "loop"] },
          nameF: { id: "nameF", type: "field", name: "name", placeholder: "your name" },
          loop: { id: "loop", type: "box", children: ["form", "extraF"] },
          extraF: { id: "extraF", type: "field", name: "extra", placeholder: "extra" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByPlaceholderText("extra"), { target: { value: "more" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { name: "Ada", extra: "more" },
    );
  });

  it("an action without collect passes no fields argument at all", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: { id: "form", type: "box", children: ["nameF"] },
          nameF: { id: "nameF", type: "field", name: "name", placeholder: "your name" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "go" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    // Exactly ONE argument — today's emission, byte-for-byte (fields undefined).
    expect(onAction.mock.calls[0]).toEqual([{ kind: "agent", name: "go" }]);
    expect(onAction.mock.calls[0]).toHaveLength(1);
  });

  it("collect target living on a NON-current screen delivers {} (only mounted fields)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: [] },
            home: { id: "home", type: "box", children: ["submit"] },
            submit: {
              id: "submit",
              type: "box",
              onPress: { kind: "agent", name: "submit", collect: "aboutForm" },
              children: ["st"],
            },
            st: { id: "st", type: "text", value: "Send" },
            about: { id: "about", type: "box", children: ["aboutForm"] },
            aboutForm: { id: "aboutForm", type: "box", children: ["secretF"] },
            secretF: { id: "secretF", type: "field", name: "secret", placeholder: "secret" },
          },
          screens: { home: "home", about: "about" },
          entry: "home",
        }}
      />,
    );

    // The form's screen is not current, so its input is not in the DOM at all.
    expect(screen.queryByPlaceholderText("secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, {});
  });

  it("omits a toggled-hidden field inside the collect subtree", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["hideBtn", "form", "submit"] },
          hideBtn: {
            id: "hideBtn",
            type: "box",
            onPress: { kind: "toggle", target: "emailF" },
            children: ["ht"],
          },
          ht: { id: "ht", type: "text", value: "Hide" },
          form: { id: "form", type: "box", children: ["nameF", "emailF"] },
          nameF: { id: "nameF", type: "field", name: "name", placeholder: "your name" },
          emailF: { id: "emailF", type: "field", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "form" },
            children: ["st"],
          },
          st: { id: "st", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide" })); // unmounts the email input
    expect(screen.queryByPlaceholderText("your email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { name: "Ada" });
  });

  it("navigate and toggle stay browser-local in a collect-bearing tree (unchanged)", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={{
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: [] },
            home: { id: "home", type: "box", children: ["toggleBtn", "panel", "form", "goBtn"] },
            toggleBtn: {
              id: "toggleBtn",
              type: "box",
              onPress: { kind: "toggle", target: "panel" },
              children: ["tt"],
            },
            tt: { id: "tt", type: "text", value: "Toggle" },
            panel: { id: "panel", type: "box", children: ["pt"] },
            pt: { id: "pt", type: "text", value: "panel content" },
            form: { id: "form", type: "box", children: ["nameF"] },
            nameF: { id: "nameF", type: "field", name: "name", placeholder: "your name" },
            goBtn: {
              id: "goBtn",
              type: "box",
              onPress: { kind: "navigate", to: "about" },
              children: ["gt"],
            },
            gt: { id: "gt", type: "text", value: "Go" },
            about: { id: "about", type: "box", children: ["at"] },
            at: { id: "at", type: "text", value: "about content" },
          },
          screens: { home: "home", about: "about" },
          entry: "home",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.queryByText("panel content")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText("about content")).toBeTruthy();
    expect(screen.queryByPlaceholderText("your name")).toBeNull();

    expect(onAction).not.toHaveBeenCalled();
  });
});
