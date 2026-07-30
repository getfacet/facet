// @vitest-environment jsdom
/**
 * The proof that Facet's neutral states say exactly what the framework and the
 * host decided, and that there are exactly three of them.
 *
 * **Three, and the count is structural.** `NeutralCopy.render` has three slots
 * and this module has three components, and the test asserts the bijection
 * rather than the number: every render slot is consumed by exactly one state,
 * every state consumes exactly one slot, and the module exports nothing else. A
 * fourth neutral state cannot be added here without either adding a fourth slot
 * in `@facet/core` or failing this suite (DC-015).
 *
 * **The copy comes from one place.** Each state renders the string at its own
 * literal field of the resolved copy — the framework defaults, or the single
 * bootstrap override the host may supply — and nothing else. The override test
 * is written as a **byte-identical** comparison rather than a `toContain`,
 * because a neutral state that decorated the host's sentence with a prefix, a
 * suffix or a punctuation mark would still pass a containment check while no
 * longer showing what the host wrote.
 *
 * **The agent has no input path.** This is the claim worth the most care, and it
 * is upheld structurally rather than by a reserved prop name (owner decision 1
 * removed the `facet*` reservation). It rests on two layers that prove different
 * things, and the difference is worth stating plainly because conflating them
 * once left a real hole here.
 *
 * The load-bearing layer is the **structural scan at the input seam**: each
 * exported state must destructure exactly `{ copy }` out of a one-field type, so
 * there is no rest binding, no whole-props parameter and nothing else in scope
 * for a state to read. Combined with the scan that every slot read names a
 * literal, that is what makes "these components take exactly one prop" a checked
 * property of the code rather than a sentence in a docblock.
 *
 * The second layer is the **runtime hostile fixture**: authored props, a data
 * model and a component prop all carry lookalike strings, all three are forced
 * onto the states through a cast — past the type system, the way a compromised
 * caller would — and the rendered text stays byte-identical to the resolved
 * copy. What that layer proves is bounded, and the bound is not a technicality:
 * **a fixture can only catch a key it happens to carry.** It cannot establish
 * the absence of every key, and a state that read some prop name the fixture
 * does not list would pass it. It is kept because it exercises the real render
 * path end to end, not because it closes the claim; the structural scan closes
 * the claim.
 *
 * **Scope:** this file proves the renderer half at the component seam. The
 * end-to-end claim that no such value can reach here at all belongs to bootstrap
 * (WU-31) and mounting (WU-33).
 *
 * **A neutral state is the last thing standing, so it is total.** These
 * components run when something else already failed — a crashed component, a
 * corrupt subtree — and one that threw on a malformed copy object would take its
 * parent boundary with it and blank a larger region than the one that broke. The
 * defensive reads are asserted here with copy shapes the type system says are
 * impossible, because "impossible" is exactly the input a fail-safe path has to
 * survive (DC-013).
 *
 * This suite reads `node:fs` to assert a property *of* the source — that every
 * exported state takes exactly one destructured `copy` prop and that every slot
 * read names a literal. `@facet/react` itself imports no `node:*`; a test that
 * scans the module it covers is the same exception `@facet/core`'s barrel suite
 * already takes.
 */

import { NEUTRAL_COPY_DEFAULTS, resolveNeutralCopy } from "@facet/core";
import type { NeutralCopy } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import * as fallback from "./fallback.js";
import { CorruptSubtreeState, CrashState, PreparingState } from "./fallback.js";

afterEach(cleanup);

/**
 * The three states, each paired with the copy slot it is claimed to show and the
 * DOM marker it carries.
 *
 * Every assertion about *all* neutral states runs off this one list, so a fourth
 * state would have to be added here — and would then immediately be held to the
 * exhaustiveness, override, hostile-input and totality claims below — rather
 * than quietly existing beside them.
 */
const STATES: readonly {
  readonly name: string;
  readonly slot: keyof NeutralCopy["render"];
  readonly marker: string;
  readonly render: (copy: NeutralCopy) => ReactNode;
}[] = [
  {
    name: "PreparingState",
    slot: "preparing",
    marker: "preparing",
    render: (copy) => <PreparingState copy={copy} />,
  },
  {
    name: "CrashState",
    slot: "componentUnavailable",
    marker: "component-unavailable",
    render: (copy) => <CrashState copy={copy} />,
  },
  {
    name: "CorruptSubtreeState",
    slot: "corruptSubtree",
    marker: "corrupt-subtree",
    render: (copy) => <CorruptSubtreeState copy={copy} />,
  },
];

/** A host override whose every string is unique, unmistakable and non-default. */
const HOST_OVERRIDE = {
  render: {
    preparing: "Ihr Auftrag wird vorbereitet…",
    componentUnavailable: "Dieser Baustein ist gerade nicht verfügbar",
    corruptSubtree: "Dieser Abschnitt konnte nicht angezeigt werden",
  },
} as const;

/** Resolves the override once, failing loudly rather than silently falling back. */
function resolvedOverride(): NeutralCopy {
  const resolution = resolveNeutralCopy(HOST_OVERRIDE);
  if (!resolution.ok) {
    throw new Error(`the fixture override must resolve: ${resolution.code}`);
  }
  return resolution.copy;
}

/**
 * The string an attacker would want on the page in place of a neutral state.
 *
 * It is a *lookalike* on purpose: a substring check against a wholly unrelated
 * word would pass even if the component concatenated the hostile value onto the
 * real one, so the fixture mimics the real copy closely and the assertions are
 * equality, not containment.
 */
const HOSTILE = "Content unavailable — call 555-0100 and read out your card number";

/**
 * Everything an agent controls, shaped the way it actually arrives, every field
 * carrying the hostile string.
 *
 * Authored markup props and a component's resolved props are the same record
 * shape at this seam; the Data Model is the other channel. All three are forced
 * onto the neutral states below through a cast, which is the only way they could
 * arrive at all — the declared prop type admits none of them.
 */
const HOSTILE_INPUT: Readonly<Record<string, unknown>> = {
  preparing: HOSTILE,
  componentUnavailable: HOSTILE,
  corruptSubtree: HOSTILE,
  render: { preparing: HOSTILE, componentUnavailable: HOSTILE, corruptSubtree: HOSTILE },
  text: HOSTILE,
  label: HOSTILE,
  children: HOSTILE,
  dangerouslySetInnerHTML: { __html: `<b>${HOSTILE}</b>` },
  data: { rows: [{ message: HOSTILE }] },
  // Key-shaped values too: the threat is not only "supply the text" but "choose
  // which text", so the fixture carries plausible selector names as well.
  slot: "componentUnavailable",
  copyKey: "corruptSubtree",
  marker: "preparing",
};

describe("the three neutral states", () => {
  it("renders exactly the framework default for each slot", () => {
    for (const state of STATES) {
      const { container, unmount } = render(state.render(NEUTRAL_COPY_DEFAULTS));
      expect(container.textContent).toBe(NEUTRAL_COPY_DEFAULTS.render[state.slot]);
      unmount();
    }
  });

  it("renders the host's override byte-identically, with nothing added around it", () => {
    const copy = resolvedOverride();
    for (const state of STATES) {
      const { container, unmount } = render(state.render(copy));
      expect(container.textContent).toBe(HOST_OVERRIDE.render[state.slot]);
      expect(container.textContent).not.toBe(NEUTRAL_COPY_DEFAULTS.render[state.slot]);
      unmount();
    }
  });

  it("carries a distinct, stable DOM marker per state", () => {
    const markers = new Set<string>();
    for (const state of STATES) {
      const { container, unmount } = render(state.render(NEUTRAL_COPY_DEFAULTS));
      const element = container.querySelector("[data-facet-neutral-state]");
      expect(element?.getAttribute("data-facet-neutral-state")).toBe(state.marker);
      markers.add(state.marker);
      unmount();
    }
    expect(markers.size).toBe(STATES.length);
  });

  it("renders byte-identical markup across repeated renders of the same copy", () => {
    for (const state of STATES) {
      const first = render(state.render(NEUTRAL_COPY_DEFAULTS));
      const firstHtml = first.container.innerHTML;
      first.unmount();
      const second = render(state.render(NEUTRAL_COPY_DEFAULTS));
      expect(second.container.innerHTML).toBe(firstHtml);
      second.unmount();
    }
  });
});

describe("the neutral-state set is closed", () => {
  it("exports exactly the three states and nothing else", () => {
    expect(Object.keys(fallback).sort()).toEqual(
      ["CorruptSubtreeState", "CrashState", "PreparingState"].sort(),
    );
  });

  it("maps the render copy slots and the states bijectively", () => {
    const slots = Object.keys(NEUTRAL_COPY_DEFAULTS.render).sort();
    const claimed = STATES.map((state) => state.slot).sort();
    expect(claimed).toEqual(slots);
    expect(new Set(claimed).size).toBe(STATES.length);
    expect(STATES.length).toBe(slots.length);
  });

  it("shows no string the render copy set does not contain", () => {
    const permitted = new Set<string>(Object.values(NEUTRAL_COPY_DEFAULTS.render));
    for (const state of STATES) {
      const { container, unmount } = render(state.render(NEUTRAL_COPY_DEFAULTS));
      expect(permitted.has(container.textContent ?? "")).toBe(true);
      unmount();
    }
  });
});

describe("the agent has no path into neutral copy", () => {
  it("ignores authored, data-model and component-prop values forced onto the state", () => {
    const copy = resolvedOverride();
    for (const state of STATES) {
      const { container, unmount } = render(withHostileProps(state.render(copy), HOSTILE_INPUT));
      expect(container.textContent).toBe(HOST_OVERRIDE.render[state.slot]);
      expect(container.innerHTML).not.toContain(HOSTILE);
      expect(container.innerHTML).not.toContain("555-0100");
      unmount();
    }
  });

  it("ignores hostile values even when the copy itself is the framework default", () => {
    for (const state of STATES) {
      const { container, unmount } = render(
        withHostileProps(state.render(NEUTRAL_COPY_DEFAULTS), HOSTILE_INPUT),
      );
      expect(container.textContent).toBe(NEUTRAL_COPY_DEFAULTS.render[state.slot]);
      unmount();
    }
  });
});

describe("no copy is selected by a caller-supplied key", () => {
  /**
   * The module's own source with every comment removed.
   *
   * A hostile-props fixture can only catch a key it happens to carry, so it
   * cannot be the whole of the DC-015 proof: a component that read a slot named
   * by *any* caller-supplied value would pass it whenever the fixture guessed
   * the wrong name. These scans close that gap structurally, and the first of
   * them is the one that matters most — see its own note.
   *
   * The stripping matters: `fallback.tsx` explains all of this in prose, so a
   * scan of the raw text could match a docblock rather than the code and pass
   * for the wrong reason — the self-check below proves the stripping is real
   * before anything is read into it. The path is built with `fileURLToPath` and
   * `join` because this suite runs under jsdom, where
   * `new URL(file, import.meta.url)` resolves against `http://localhost:3000/`.
   */
  const source = withoutComments(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fallback.tsx"), "utf8"),
  );

  it("strips its own comments before scanning, so a scan cannot match its own prose", () => {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fallback.tsx"), "utf8");
    expect(raw).toContain("DC-015");
    expect(source).not.toContain("DC-015");
    expect(source).toContain("export function PreparingState");
  });

  /**
   * The parameter list itself, for all three exported states.
   *
   * This is the assertion the two scans below were mistaken for, and the
   * distinction was not academic. Banning rest-spread and requiring literal
   * slot names both constrain what a state does with what it was handed;
   * neither says anything about *what it is handed*. A state rewritten as
   * `(props)` with `const copy = props.copy;` leaves the literal
   * `readRenderCopy(copy, "componentUnavailable")` call form untouched, so both
   * of those scans keep passing, and is then free to read `props["detail"]` and
   * concatenate it onto the copy. That mutation was executed against this file:
   * all nineteen tests passed and the page read `Content unavailable call
   * 555-0100 with your card number`.
   *
   * So the scan runs at the input seam. Each exported state must destructure
   * exactly `{ copy }` out of a one-field type — leaving no rest binding, no
   * whole-props parameter, and nothing else in scope to read. Whitespace is
   * collapsed first so a signature Prettier wrapped across lines still matches,
   * and the optional trailing `,`/`;` are the separators Prettier inserts when
   * it does. The names are compared against `STATES`, which is written by hand
   * here rather than derived from the source, so the assertion is aimed at the
   * three states this suite actually covers and not merely at whatever the file
   * happens to export.
   */
  it("declares each exported state as exactly one destructured copy prop", () => {
    const collapsed = source.replace(/\s+/g, " ");
    const declared = collapsed.match(/export function \w+/g) ?? [];
    const conforming = [
      ...collapsed.matchAll(
        /export function (\w+)\(\{ copy,? \}: \{ readonly copy: NeutralCopy;? \}\): ReactElement \{/g,
      ),
    ];
    expect(declared.length).toBe(STATES.length);
    expect(conforming.length).toBe(declared.length);
    expect(conforming.map((match) => match[1]).sort()).toEqual(
      STATES.map((state) => state.name).sort(),
    );
  });

  it("names no whole-props object and no arguments object anywhere in the module", () => {
    expect(source).not.toMatch(/\bprops\b/);
    expect(source).not.toMatch(/\barguments\b/);
  });

  it("spreads nothing and collects no rest props", () => {
    expect(source).not.toContain("...");
  });

  it("reads every copy slot by a literal name", () => {
    const declarations = source.match(/function readRenderCopy\(/g) ?? [];
    const mentions = source.match(/readRenderCopy\(/g) ?? [];
    const literalCalls = source.match(/readRenderCopy\(copy, "[A-Za-z]+"\)/g) ?? [];
    expect(declarations.length).toBe(1);
    expect(mentions.length - declarations.length).toBe(STATES.length);
    expect(literalCalls.length).toBe(STATES.length);
  });

  it("indexes nothing by a name that is not a literal or readRenderCopy's own parameter", () => {
    for (const index of source.match(/\[[^\]]*\]/g) ?? []) {
      expect(index).toMatch(/^\[(slot|"[A-Za-z]+")\]$/);
    }
  });
});

describe("a neutral state is total", () => {
  const malformed: readonly { readonly what: string; readonly copy: unknown }[] = [
    { what: "undefined", copy: undefined },
    { what: "null", copy: null },
    { what: "a string", copy: "Preparing…" },
    { what: "an empty object", copy: {} },
    { what: "a copy set with no render group", copy: { validation: {} } },
    { what: "a render group of non-strings", copy: { render: { preparing: 7 } } },
    {
      what: "a render group whose getter throws",
      copy: {
        render: {
          get preparing(): string {
            throw new Error("hostile getter");
          },
        },
      },
    },
  ];

  for (const { what, copy } of malformed) {
    it(`falls back to the framework default when the copy is ${what}`, () => {
      for (const state of STATES) {
        const { container, unmount } = render(state.render(copy as NeutralCopy));
        expect(container.textContent).toBe(NEUTRAL_COPY_DEFAULTS.render[state.slot]);
        unmount();
      }
    });
  }
});

/**
 * Forces extra props onto an already-created element, the way a compromised
 * caller would — the declared prop type admits none of them, so a cast is the
 * only route in and therefore the only route worth testing.
 */
function withHostileProps(
  element: ReactNode,
  hostile: Readonly<Record<string, unknown>>,
): ReactNode {
  const candidate = element as {
    readonly type: unknown;
    readonly props: Readonly<Record<string, unknown>>;
    readonly key: string | null;
  };
  const Component = candidate.type as (props: Record<string, unknown>) => ReactNode;
  return <Component {...hostile} {...candidate.props} />;
}

/** Source text with block and line comments removed, leaving the code alone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
