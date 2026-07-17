// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAX_FIELD_VALUE_CHARS, type FacetTree } from "@facet/core";
import { StageRenderer } from "./StageRenderer.js";
import { interactionTree as tree } from "./StageRenderer.test-support.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StageRenderer collect (jsdom)", () => {
  /** name+email form in box "form"; a submit button collecting it. */
  const formTree = (): FacetTree =>
    tree({
      root: { id: "root", type: "box", children: ["form", "submit"] },
      form: { id: "form", type: "box", children: ["nameF", "emailF"] },
      nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
      emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
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

  it("collects fields from a native box target via a pressable box", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["panel", "submit"] },
          panel: {
            id: "panel",
            type: "box",
            children: ["emailF"],
          },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
          submit: {
            id: "submit",
            type: "box",
            onPress: { kind: "agent", name: "submit", collect: "panel" },
            children: ["submit-label"],
          },
          "submit-label": { id: "submit-label", type: "text", value: "Send" },
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("your email"), {
      target: { value: "ada@lovelace.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { email: "ada@lovelace.dev" },
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
          dupHidden: { id: "dupHidden", type: "input", name: "email", placeholder: "hidden dup" },
          visibleF: { id: "visibleF", type: "input", name: "email", placeholder: "visible email" },
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
          userF: { id: "userF", type: "input", name: "user", placeholder: "user" },
          passF: {
            id: "passF",
            type: "input",
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
          pic: {
            id: "pic",
            type: "media",
            kind: "image",
            src: "https://example.com/a.png",
            alt: "pic",
          },
          inner: { id: "inner", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
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

  it("brick-vocab v1 collects select, checkbox, switch, and the checked radio member", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: {
            id: "form",
            type: "box",
            children: ["plan", "agree", "alerts", "size"],
          },
          plan: {
            id: "plan",
            type: "input",
            name: "plan",
            input: "select",
            options: ["Free", "Pro"],
          },
          agree: { id: "agree", type: "input", name: "agree", input: "checkbox" },
          alerts: { id: "alerts", type: "input", name: "alerts", input: "switch" },
          size: {
            id: "size",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Small", "Large"],
          },
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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Pro" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByDisplayValue("Large"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith(
      { kind: "agent", name: "submit" },
      { plan: "Pro", agree: true, alerts: true, size: "Large" },
    );
  });

  it("collects the first defined same-name radio value when an earlier radio group is unchecked", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["form", "submit"] },
          form: {
            id: "form",
            type: "box",
            children: ["emptySize", "chosenSize"],
          },
          emptySize: {
            id: "emptySize",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Small", "Medium"],
          },
          chosenSize: {
            id: "chosenSize",
            type: "input",
            name: "size",
            input: "radio",
            options: ["Large", "XL"],
          },
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

    fireEvent.click(screen.getByDisplayValue("XL"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith({ kind: "agent", name: "submit" }, { size: "XL" });
  });

  it("does not collect a same-named field OUTSIDE the collect subtree", () => {
    const onAction = vi.fn();
    render(
      <StageRenderer
        onAction={onAction}
        tree={tree({
          root: { id: "root", type: "box", children: ["outsideF", "form", "submit"] },
          outsideF: { id: "outsideF", type: "input", name: "email", placeholder: "outside" },
          form: { id: "form", type: "box", children: ["emailF"] },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "inside" },
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
          first: { id: "first", type: "input", name: "email", placeholder: "first" },
          inner: { id: "inner", type: "box", children: ["second"] },
          second: { id: "second", type: "input", name: "email", placeholder: "second" },
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
          f: { id: "f", type: "input", name: longName, placeholder: "x" },
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

  it("keeps long radio field DOM names distinct past the label cap", () => {
    const leftName = `${"n".repeat(220)}left`;
    const rightName = `${"n".repeat(220)}right`;
    render(
      <StageRenderer
        tree={tree({
          root: { id: "root", type: "box", children: ["left", "right"] },
          left: {
            id: "left",
            type: "input",
            name: leftName,
            input: "radio",
            options: ["Yes"],
          },
          right: {
            id: "right",
            type: "input",
            name: rightName,
            input: "radio",
            options: ["Yes"],
          },
        })}
      />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute("name")).toBe(leftName);
    expect(radios[1]?.getAttribute("name")).toBe(rightName);
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
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
          loop: { id: "loop", type: "box", children: ["form", "extraF"] },
          extraF: { id: "extraF", type: "input", name: "extra", placeholder: "extra" },
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
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
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
            secretF: { id: "secretF", type: "input", name: "secret", placeholder: "secret" },
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
          nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
          emailF: { id: "emailF", type: "input", name: "email", placeholder: "your email" },
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
            nameF: { id: "nameF", type: "input", name: "name", placeholder: "your name" },
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
