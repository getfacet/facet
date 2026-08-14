// @vitest-environment jsdom
/**
 * The proof that Facet — not the component, and not the DOM — owns a collected
 * value.
 *
 * Five claims carry the weight here.
 *
 * **The store is the only path from a field to a payload.** The sharpest form of
 * that is not "typing updates the store" but "writing the DOM behind React's
 * back changes nothing the payload sees": a value scraped from an element would
 * follow the mutation, and the store's does not (D-08, DC-022).
 *
 * **A collectable node that never registered yields its spec default, and is
 * reported as unavailable rather than blank.** Those are two different
 * statements about the same absence — one about what renders, one about what is
 * sent — and both are asserted, because a silent `{}` is exactly what the
 * structured entry exists to prevent.
 *
 * **A sensitive field's value never leaves the store.** The collect-facing read
 * carries no `value` key at all for a sensitive field, so the payload builder
 * cannot leak one even by accident. That is the store's half of the two
 * independent locks; `collect.test.ts` owns the other.
 *
 * **Local input writes no shared state.** The store holds values keyed by node
 * id and has no access to the Data Model at all — asserted structurally, by
 * parsing this module's import surface, and behaviourally, against a deep-frozen
 * model whose resolved props fed the mount.
 *
 * **A remount does not resurrect a stale value.** Unregistration drops the
 * node's value, so a field that comes back comes back seeded, and a disposer
 * that fires after the same node re-registered removes nothing.
 *
 * The suite renders React, so it opens with the jsdom docblock. Its fixtures
 * mirror the landed `FIELD_SPEC` rather than importing it: `@facet/react`
 * imports nothing from `@facet/assets` (D-09), and a test import would create
 * exactly the edge the cut removed.
 */

import type { ComponentSpec, DataModel } from "@facet/core";
import { BOUNDS } from "@facet/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeEvent, ReactNode } from "react";
import { createElement, StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { buildCollectPayload } from "./collect.js";
import type { CollectableSpec, FieldInjection, FieldStore } from "./field-store.js";
import { createFieldStore, FieldHost, isCollectable } from "./field-store.js";
import { errorsDuring } from "../../../../test-support/errors-during.js";

afterEach(cleanup);

/** A value marker that is recognisable anywhere it leaks. */
const SECRET = "hunter2-correct-horse-battery-staple";

/**
 * The collectable fixture, shaped exactly like the landed default `Field`: a
 * `name` that a `Button` writes in its collect list, a `value` prop Facet
 * injects, and a boolean `secret` that withholds it.
 */
const FIELD_SPEC: CollectableSpec = {
  tag: "Field",
  whenToUse: "Ask the visitor for one value.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: {
    name: { type: "string", required: true, guidance: "The collect name." },
    label: { type: "string", required: true, guidance: "What is being asked for." },
    value: { type: "string", default: "", guidance: "The value shown." },
    secret: { type: "boolean", default: false, guidance: "Whether the value is withheld." },
  },
  acceptsChildren: false,
  collect: { collectable: true, valueProp: "value", sensitiveProp: "secret" },
};

/** The same contract with a non-empty declared default, so a default is visible. */
const SEEDED_SPEC: CollectableSpec = {
  ...FIELD_SPEC,
  props: { ...FIELD_SPEC.props, value: { type: "string", default: "north", guidance: "Region." } },
};

/** A component the catalog never declared collectable. */
const BUTTON_SPEC: ComponentSpec = {
  tag: "Button",
  whenToUse: "Give the visitor one control.",
  authoring: {
    role: "display",
    informationTypes: ["test_content"],
    visualEmphasis: "supporting",
  } as const,
  props: { label: { type: "string", required: true, guidance: "The words on the control." } },
  acceptsChildren: false,
};

/** One controlled input, standing in for the trusted `Field` implementation. */
function controlledInput(injection: FieldInjection): ReactNode {
  const value = injection.props["value"];
  return createElement("input", {
    type: injection.props["secret"] === true ? "password" : "text",
    value: typeof value === "string" ? value : "",
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      injection.onValueChange(event.target.value);
    },
  });
}

/**
 * A trusted component written the ordinary way: it **spreads** what Facet hands
 * it onto its element.
 *
 * `controlledInput` reads the two props it knows by name, so it cannot reveal
 * anything extra the injection carries — it would pass against an injection
 * stuffed with renderer-only keys. This one forwards everything, which is how a
 * registered component is most naturally written and therefore the shape the
 * D-08 prohibition has to hold against.
 */
function spreadInput(injection: FieldInjection): ReactNode {
  return createElement("input", {
    ...injection.props,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      injection.onValueChange(event.target.value);
    },
  });
}

/** One mount of a collectable node through the host. */
function host(options: {
  readonly store: FieldStore;
  readonly nodeId?: string;
  readonly spec?: CollectableSpec;
  readonly props?: Readonly<Record<string, string | number | boolean>>;
  readonly mount?: (injection: FieldInjection) => ReactNode;
}): ReactNode {
  return createElement(FieldHost, {
    nodeId: options.nodeId ?? "n4",
    spec: options.spec ?? FIELD_SPEC,
    props: options.props ?? { name: "email", label: "Email" },
    store: options.store,
    mount: options.mount ?? controlledInput,
  });
}

/** The one input the render produced. */
function inputIn(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input");
  if (input === null) throw new Error("the host rendered no input");
  return input;
}

/** An element's own text, excluding whatever its descendants contain. */
function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("");
}

/**
 * Everywhere in `container` that `value` appears other than the one place it is
 * allowed to: `control`'s own `value`.
 *
 * Hidden elements are swept like any other — a mirror is a second channel
 * whether or not it is painted — and each hit is named, so a failure says which
 * element and which attribute carried it rather than only that something did.
 */
function carriersOf(container: HTMLElement, value: string, control: Element): readonly string[] {
  const hits: string[] = [];
  for (const element of container.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (element === control && name === "value") continue;
      if ((element.getAttribute(name) ?? "").includes(value)) {
        hits.push(`${element.tagName}[${name}]`);
      }
    }
    if (ownText(element).includes(value)) {
      hits.push(`${element.tagName}#text`);
    }
  }
  if (ownText(container).includes(value)) {
    hits.push("container#text");
  }
  return hits;
}

/**
 * `source` with its comments removed and its string literals left intact.
 *
 * An import ban that matches its own doc comment is not a ban, and stripping
 * strings as well would take the specifiers with them — so the scanner steps
 * over string literals verbatim and drops only comments. It is checked against
 * a fixture below before it is trusted with the module.
 */
function withoutComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    const char = source[index] ?? "";
    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char) {
        cursor += source[cursor] === "\\" ? 2 : 1;
      }
      out += source.slice(index, cursor + 1);
      index = cursor + 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Every module specifier `source` imports from, comments excluded. */
function importedModules(source: string): readonly string[] {
  const specifiers: string[] = [];
  const pattern = /\bfrom\s*["']([^"']+)["']/g;
  for (const match of withoutComments(source).matchAll(pattern)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

describe("isCollectable", () => {
  it("answers from the catalog declaration, never from the tag or the props", () => {
    expect(isCollectable(FIELD_SPEC)).toBe(true);
    expect(isCollectable(BUTTON_SPEC)).toBe(false);
    // A component cannot opt itself in by declaring a prop that looks the part.
    expect(
      isCollectable({
        ...BUTTON_SPEC,
        props: { value: { type: "string", guidance: "Not a collect declaration." } },
      }),
    ).toBe(false);
  });
});

describe("createFieldStore", () => {
  it("is per-session: two stores share nothing", () => {
    const first = createFieldStore();
    const second = createFieldStore();
    first.register({ nodeId: "n4", name: "email", sensitive: false, seed: "ada@example.com" });

    expect(first.collectSource("email")).toEqual({ kind: "value", value: "ada@example.com" });
    expect(second.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("reports an unregistered name as unavailable, never as a blank value", () => {
    const store = createFieldStore();

    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
    expect(store.readValue("n4")).toBeUndefined();
  });

  it("holds the seed until the visitor writes, then the written value", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "seeded" });

    expect(store.collectSource("email")).toEqual({ kind: "value", value: "seeded" });

    store.write("n4", "typed");

    expect(store.readValue("n4")).toBe("typed");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "typed" });
  });

  it("treats a repeated collect name as no source rather than guessing one", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "first" });
    store.register({ nodeId: "n9", name: "email", sensitive: false, seed: "second" });

    // Two live fields answering to one name is ambiguous, and the closed entry
    // union has no "ambiguous" kind. Answering "unavailable" is order
    // independent and states the absence; picking one would be a silent guess
    // that changes with mount order.
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("collects nothing by name from a registration that has no name", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", sensitive: false, seed: "held" });

    expect(store.readValue("n4")).toBe("held");
    expect(store.collectSource("")).toEqual({ kind: "unavailable" });
    expect(store.collectSource("undefined")).toEqual({ kind: "unavailable" });
  });

  it("re-points a live field's address and keeps its value", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "" });
    store.write("n4", "typed");

    store.setName("n4", "emailAddress");

    expect(store.collectSource("emailAddress")).toEqual({ kind: "value", value: "typed" });
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
    expect(store.readValue("n4")).toBe("typed");
  });

  it("treats an empty or absent address as no address, and ignores an unregistered node", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "held" });

    store.setName("n4", "");
    store.setName("n9", "orphan");

    expect(store.readValue("n4")).toBe("held");
    expect(store.collectSource("")).toEqual({ kind: "unavailable" });
    expect(store.collectSource("orphan")).toEqual({ kind: "unavailable" });
    expect(store.readValue("n9")).toBeUndefined();

    store.setName("n4", undefined);

    expect(store.readValue("n4")).toBe("held");
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("clamps a written value to B-23, so the store cannot hold an uncollectable one", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "" });

    store.write("n4", "v".repeat(BOUNDS.collectedValueChars + 500));

    expect(store.readValue("n4")).toHaveLength(BOUNDS.collectedValueChars);
  });

  it("ignores a write to a node that is not registered", () => {
    const store = createFieldStore();

    store.write("n4", "orphan");

    expect(store.readValue("n4")).toBeUndefined();
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("drops the value when the node unregisters", () => {
    const store = createFieldStore();
    const dispose = store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "" });
    store.write("n4", "typed");

    dispose();

    expect(store.readValue("n4")).toBeUndefined();
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("lets a stale disposer remove nothing", () => {
    const store = createFieldStore();
    const stale = store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "old" });
    store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "new" });

    stale();

    expect(store.collectSource("email")).toEqual({ kind: "value", value: "new" });
  });

  it("notifies subscribers on a change and stops on unsubscribe", () => {
    const store = createFieldStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    const dispose = store.register({ nodeId: "n4", name: "email", sensitive: false, seed: "" });
    store.write("n4", "typed");
    dispose();
    const afterSubscribed = notifications;
    unsubscribe();
    store.register({ nodeId: "n7", name: "region", sensitive: false, seed: "" });

    expect(afterSubscribed).toBe(3);
    expect(notifications).toBe(afterSubscribed);
  });
});

describe("FieldHost", () => {
  it("injects the authored value under the catalog-declared value prop", () => {
    const store = createFieldStore();
    let seen: FieldInjection | undefined;

    render(
      host({
        store,
        props: { name: "email", label: "Email", value: "ada@example.com" },
        mount: (injection) => {
          seen = injection;
          return controlledInput(injection);
        },
      }),
    );

    expect(seen?.props["value"]).toBe("ada@example.com");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "ada@example.com" });
  });

  it("injects the spec default when the author wrote no value", () => {
    const store = createFieldStore();

    const { container } = render(
      host({ store, spec: SEEDED_SPEC, props: { name: "region", label: "Region" } }),
    );

    expect(inputIn(container).value).toBe("north");
    expect(store.collectSource("region")).toEqual({ kind: "value", value: "north" });
  });

  it("reports a collectable node that never registered as unavailable", () => {
    const store = createFieldStore();

    // The node is in the document — its subtree simply never mounted, so nothing
    // registered. The event still names it, and the answer is structured.
    const built = buildCollectPayload("region", store.collectSource);

    expect(built.collect["region"]).toEqual({ kind: "collect_source_unavailable" });
  });

  it("routes the visitor's keystroke through the store and back as a prop", () => {
    const store = createFieldStore();
    const { container } = render(host({ store }));

    fireEvent.change(inputIn(container), { target: { value: "ada@example.com" } });

    expect(inputIn(container).value).toBe("ada@example.com");
    expect(store.readValue("n4")).toBe("ada@example.com");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "ada@example.com" });
  });

  it("does not resurrect a stale value across a remount", () => {
    const store = createFieldStore();
    const first = render(host({ store }));
    fireEvent.change(inputIn(first.container), { target: { value: "typed" } });

    first.unmount();

    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });

    const second = render(host({ store }));

    expect(inputIn(second.container).value).toBe("");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "" });
  });

  it("re-seeds when the server authors a new value for the node", () => {
    const store = createFieldStore();
    const { container, rerender } = render(host({ store }));
    fireEvent.change(inputIn(container), { target: { value: "typed" } });

    rerender(host({ store, props: { name: "email", label: "Email", value: "authored" } }));

    expect(inputIn(container).value).toBe("authored");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "authored" });
  });

  it("keeps the visitor's value across a re-render that does not change the seed", () => {
    const store = createFieldStore();
    const { container, rerender } = render(host({ store }));
    fireEvent.change(inputIn(container), { target: { value: "typed" } });

    rerender(host({ store, props: { name: "email", label: "Email address" } }));

    expect(inputIn(container).value).toBe("typed");
  });

  it("moves the collect address without disturbing the visitor's value", () => {
    const store = createFieldStore();
    const { container, rerender } = render(host({ store }));
    fireEvent.change(inputIn(container), { target: { value: "typed@example.com" } });

    rerender(host({ store, props: { name: "emailAddress", label: "Email" } }));

    // Values are keyed by the stable node id, so re-authoring **only** the
    // address re-points it. Discarding what the visitor typed because the agent
    // renamed the field around them would be a data loss with no cause the
    // visitor can see.
    expect(store.readValue("n4")).toBe("typed@example.com");
    expect(inputIn(container).value).toBe("typed@example.com");
    expect(store.collectSource("emailAddress")).toEqual({
      kind: "value",
      value: "typed@example.com",
    });
    // And the old address stops resolving, so the move is a move.
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("keeps the value but makes it unaddressable when the address is dropped", () => {
    const store = createFieldStore();
    const { container, rerender } = render(host({ store }));
    fireEvent.change(inputIn(container), { target: { value: "typed" } });

    rerender(host({ store, props: { label: "Email" } }));

    expect(store.readValue("n4")).toBe("typed");
    expect(inputIn(container).value).toBe("typed");
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("drops the visitor's value when the field's sensitivity changes, in either direction", () => {
    // The flip: type into a sensitive field, then re-author it non-sensitive so
    // the value becomes collectable. Sensitivity is part of the registration's
    // identity, so the value does not survive the change — which is what makes
    // the flip yield nothing rather than the secret. Losing a value on this
    // change is deliberate, and is the opposite call from the address move
    // above: there the value is safe, here it is not.
    const store = createFieldStore();
    const secretProps = { name: "token", label: "API token", secret: true };
    const { container, rerender } = render(host({ store, props: secretProps }));
    fireEvent.change(inputIn(container), { target: { value: SECRET } });

    rerender(host({ store, props: { ...secretProps, secret: false } }));

    expect(store.collectSource("token")).toEqual({ kind: "value", value: "" });
    expect(JSON.stringify(buildCollectPayload("token", store.collectSource))).not.toContain(SECRET);

    // The other direction resets too, so nothing carries across the boundary.
    fireEvent.change(inputIn(container), { target: { value: "public" } });
    rerender(host({ store, props: secretProps }));

    expect(store.readValue("n4")).toBe("");
  });

  it("survives StrictMode's double-invoked mount", () => {
    // A store driven by effects is exactly where StrictMode bites: React mounts,
    // tears down and remounts, so a disposer that removed the *node* rather than
    // its own registration would leave a live field unregistered and every
    // collect of it unavailable.
    const store = createFieldStore();
    const { container } = render(createElement(StrictMode, null, host({ store })));

    fireEvent.change(inputIn(container), { target: { value: "ada@example.com" } });

    expect(inputIn(container).value).toBe("ada@example.com");
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "ada@example.com" });
  });

  it("stays inert when a component reports a value after unmounting", () => {
    const store = createFieldStore();
    let escapedCallback: ((value: string) => void) | undefined;
    const view = render(
      host({
        store,
        mount: (injection) => {
          escapedCallback = injection.onValueChange;
          return controlledInput(injection);
        },
      }),
    );
    view.unmount();

    const escaped = errorsDuring(() => {
      escapedCallback?.("late");
    });

    expect(escaped).toEqual([]);
    expect(store.readValue("n4")).toBeUndefined();
    expect(store.collectSource("email")).toEqual({ kind: "unavailable" });
  });

  it("writes nothing into the Data Model the props were resolved from", () => {
    const store = createFieldStore();
    const model: DataModel = Object.freeze({
      visitor: Object.freeze({ email: "ada@example.com" }),
    });
    const before = JSON.stringify(model);
    const resolved = { name: "email", label: "Email", value: "ada@example.com" };

    const { container } = render(host({ store, props: resolved }));
    const escaped = errorsDuring(() => {
      fireEvent.change(inputIn(container), { target: { value: "typed" } });
    });

    expect(escaped).toEqual([]);
    expect(JSON.stringify(model)).toBe(before);
    expect(resolved).toEqual({ name: "email", label: "Email", value: "ada@example.com" });
    expect(store.readValue("n4")).toBe("typed");
  });
});

/**
 * The first half of the corrected D-08: there is **no collection stamp and no
 * collection channel** other than the store.
 *
 * A controlled control reflecting its value in its **own** `value` is settled,
 * correct behaviour and is asserted as such below, not as a defect. What must
 * not exist is a second, DOM-side way to identify or read the value: a `name`
 * attribute, a `data-*` marker, a hidden mirror element, or a payload assembled
 * by querying the page.
 *
 * This group is deliberately separate from the sensitive-exclusion group that
 * follows. The two are independently falsifiable — an implementation could
 * exclude every secret while still stamping a `name` attribute on every field,
 * or scrape the DOM for values none of which happen to be sensitive — and one
 * assertion covering both would let a regression in either half hide behind the
 * other.
 */
describe("the collection channel: no stamp, no mirror, no scraping", () => {
  it("hands the component the declared props and Facet's value, and no address", () => {
    const store = createFieldStore();
    let seen: FieldInjection | undefined;

    render(
      host({
        store,
        props: { name: "email", label: "Email", value: "ada@example.com", secret: false },
        mount: (injection) => {
          seen = injection;
          return controlledInput(injection);
        },
      }),
    );

    // The property is stated about **the injection**, which is the object this
    // module controls, rather than about whatever a component chose to render.
    // A component can only put in the DOM what it was given, so the own-key set
    // here is the upper bound on every DOM assertion below: declared component
    // props plus the declared value prop, and nothing else. The exact lowercase
    // `name` is consumed by `FieldHost` to register the renderer-owned address
    // and stops here.
    expect(Object.keys(seen ?? {}).sort()).toEqual(["onValueChange", "props"]);
    expect(Object.keys(seen?.props ?? {}).sort()).toEqual(["label", "secret", "value"]);
    expect(seen?.props["value"]).toBe("ada@example.com");
    // The address reached the store, and only the store.
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "ada@example.com" });
  });

  it("carries no collection stamp: no wrapper, no name attribute, no data-* marker", () => {
    const store = createFieldStore();
    const { container } = render(host({ store }));

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("INPUT");
    expect(
      inputIn(container)
        .getAttributeNames()
        .filter((attribute) => attribute === "name" || attribute.startsWith("data-")),
    ).toEqual([]);
  });

  it("puts no address in the DOM even when the component spreads what it is given", () => {
    // The second of the two layers. `controlledInput` names the props it reads,
    // so it cannot show what the injection carries beyond them; this component
    // forwards everything, which is how a registered component is most
    // naturally written. Both layers, because the injection assertion above
    // could be edited away and this one would still hold the DOM, and this one
    // could be satisfied by a component that happened not to spread.
    const store = createFieldStore();
    const { container } = render(
      host({ store, props: { name: "email", label: "Email" }, mount: spreadInput }),
    );

    const attributes = inputIn(container).getAttributeNames().sort();

    expect(attributes).toEqual(["label", "value"]);
    expect(
      attributes.filter((attribute) => attribute === "name" || attribute.startsWith("data-")),
    ).toEqual([]);
    // The address is still live where it belongs.
    expect(store.collectSource("email")).toEqual({ kind: "value", value: "" });
  });

  it("renders no hidden mirror of the value anywhere in the subtree", () => {
    // The sweep is over the whole rendered subtree, hidden elements included:
    // every attribute of every other element, every element's own text, and the
    // control's own attributes apart from the one `value` it is allowed. A
    // mirror is a second channel whether or not it is visible, and whether or
    // not it is marked.
    for (const secret of [false, true]) {
      const store = createFieldStore();
      const { container, unmount } = render(
        host({ store, props: { name: "token", label: "API token", secret } }),
      );
      fireEvent.change(inputIn(container), { target: { value: SECRET } });

      expect(carriersOf(container, SECRET, inputIn(container))).toEqual([]);
      // The control's own value is the settled, correct reflection.
      expect(inputIn(container).value).toBe(SECRET);
      unmount();
    }
  });

  it("assembles the payload from the store, never by reading the DOM", () => {
    const store = createFieldStore();
    const { container } = render(host({ store }));
    const input = inputIn(container);
    fireEvent.change(input, { target: { value: "typed" } });

    input.value = "scraped-from-the-dom";
    input.setAttribute("value", "scraped-from-the-dom");

    // A payload assembled by querying the page would follow the mutation. This
    // one comes from the store, so it does not.
    const built = buildCollectPayload("email", store.collectSource);

    expect(built.collect["email"]).toEqual({ kind: "value", value: "typed" });
  });
});

/**
 * The second half of the corrected D-08: the sensitive exclusion is enforced by
 * the **collection logic** — this store and `collect.ts` — and not as a side
 * effect of what the trusted component renders.
 *
 * The control still shows the visitor what they typed; the store still holds it
 * so the control can. What never happens is the value reaching the payload that
 * leaves the browser.
 */
describe("the sensitive exclusion: enforced by the collection logic", () => {
  it("never lets a sensitive value reach the payload that leaves the browser", () => {
    const store = createFieldStore();
    const { container } = render(
      host({ store, props: { name: "token", label: "API token", secret: true } }),
    );

    fireEvent.change(inputIn(container), { target: { value: SECRET } });
    const source = store.collectSource("token");
    const built = buildCollectPayload("token", store.collectSource);

    expect(built.collect["token"]).toEqual({ kind: "omitted_sensitive" });
    // The sweep covers the source **and** the payload in one statement. Over the
    // payload alone it would be vacuous here: the store's sensitive source hands
    // out no value, so a builder that leaked one would have nothing to leak, and
    // the assertion would pass under either module's failure. Including the
    // source makes the same line fail the moment either lock is edited away.
    expect(JSON.stringify({ source, built })).not.toContain(SECRET);
  });

  it("hands out no value at all for a sensitive field", () => {
    const store = createFieldStore();
    store.register({ nodeId: "n4", name: "token", sensitive: true, seed: SECRET });

    const source = store.collectSource("token");

    expect(source).toEqual({ kind: "sensitive" });
    expect(Object.hasOwn(source, "value")).toBe(false);
    expect(JSON.stringify(source)).not.toContain(SECRET);
  });

  it("still shows a sensitive field its own value, which is settled behaviour", () => {
    const store = createFieldStore();
    const { container } = render(
      host({ store, props: { name: "token", label: "API token", secret: true } }),
    );

    fireEvent.change(inputIn(container), { target: { value: SECRET } });

    // A controlled password input reflecting its own value is correct, not a
    // leak: the prohibition is the collection channel, not the control.
    expect(inputIn(container).type).toBe("password");
    expect(inputIn(container).value).toBe(SECRET);
    expect(store.readValue("n4")).toBe(SECRET);
  });

  it("treats any truthy sensitive prop as sensitive", () => {
    const store = createFieldStore();
    render(
      host({
        store,
        props: { name: "token", label: "API token", secret: "false" as unknown as boolean },
      }),
    );

    // The declared prop is a boolean, so a non-boolean is already off-contract.
    // Erring toward withholding is the only safe direction to fold it.
    expect(store.collectSource("token")).toEqual({ kind: "sensitive" });
  });
});

describe("the module's reach", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "field-store.ts"),
    "utf8",
  );

  it("has a comment scanner that reads code and not prose", () => {
    // The tool is checked before it is trusted: a specifier mentioned only in a
    // comment must disappear, and one inside a string literal must survive.
    const fixture = [
      '// import nothing from "@facet/assets";',
      '/* import nothing from "@facet/assets"; */',
      'const marker = "// still code";',
      'import { real } from "@facet/core";',
    ].join("\n");

    expect(importedModules(fixture)).toEqual(["@facet/core"]);
    expect(withoutComments(fixture)).toContain("// still code");
  });

  it("reaches only the contract, React, and its own payload builder", () => {
    // No Data Model, no binding resolver, no store of any other kind: the field
    // store cannot write shared state it cannot name. `@facet/assets` is absent
    // for a second reason — the renderer imports nothing from it (D-09).
    expect([...new Set(importedModules(source))].sort()).toEqual([
      "./collect.js",
      "@facet/core",
      "react",
    ]);
  });
});
