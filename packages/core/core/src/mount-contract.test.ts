import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { BindingResolution } from "./data-binding.js";
import * as mountContract from "./mount-contract.js";
import type {
  CollectableMount,
  CollectedValue,
  ComponentMountProps,
  MountedComponent,
} from "./mount-contract.js";

/**
 * The mount contract is types only, so **vitest alone cannot check it**: every
 * `import type` is erased by esbuild before a test runs. Two things follow, and
 * this file does both.
 *
 * 1. The type-level contract is written as *consumer-shaped helpers* that the
 *    runtime tests below actually call. A helper only compiles if the contract
 *    it annotates holds, and calling it proves the fixture is real rather than
 *    a comment. This is the same idiom `data-binding.test.ts` uses.
 * 2. The "imports nothing" claim is checked **twice, mechanically**: once
 *    against the module's own source and once against the declaration `tsc`
 *    emits for it. A source-only check would miss nothing today, but a
 *    type-only import is erased at runtime, so it could pass every runtime
 *    assertion here while still putting a dependency into the emitted `.d.ts` —
 *    which is exactly the surface D-09 depends on.
 */

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

const MODULE_PATH = join(SRC_DIR, "mount-contract.ts");

/** `packages/core/core/src` → the workspace root, four levels up. */
const REPO_ROOT = join(SRC_DIR, "..", "..", "..", "..");

/**
 * Removes comments so the scan below reads *code*, not prose. The module's own
 * doc comments necessarily talk about importing nothing, and a scan that could
 * be defeated — or tripped — by a sentence is not a mechanical check.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every way a module can name something outside itself. */
function expectNoDependency(what: string, source: string): void {
  const code = stripComments(source);
  expect(code, `${what}: no import`).not.toMatch(/\bimport\b/);
  expect(code, `${what}: no require`).not.toMatch(/\brequire\b/);
  expect(code, `${what}: no from`).not.toMatch(/\bfrom\b/);
  expect(code, `${what}: no dynamic import`).not.toMatch(/\bimport\s*\(/);
  expect(code, `${what}: no triple-slash reference`).not.toMatch(/\/\/\/\s*<reference/);
}

/**
 * The declaration `tsc` emits for the module, compiled in isolation. The module
 * imports nothing, so it needs no program around it — which is itself part of
 * the claim being checked.
 */
let declaration: string | undefined;

function emitDeclaration(): string {
  // Compiled once per file: several assertions below read the same declaration,
  // and spawning the compiler for each of them would buy nothing.
  if (declaration !== undefined) {
    return declaration;
  }
  const outDir = mkdtempSync(join(tmpdir(), "facet-mount-contract-"));
  try {
    execFileSync(
      join(REPO_ROOT, "node_modules", ".bin", "tsc"),
      [
        "--declaration",
        "--emitDeclarationOnly",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--outDir",
        outDir,
        MODULE_PATH,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );
    declaration = readFileSync(join(outDir, "mount-contract.d.ts"), "utf8");
    return declaration;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * The one value vocabulary a resolved prop can hold, taken from the mount
 * contract's own declaration rather than restated.
 *
 * `Exclude<…, undefined>` is not a widening: `noUncheckedIndexedAccess` adds
 * `undefined` to any index-signature read, and the question here is what a
 * *present* prop holds.
 */
type MountValue = Exclude<ComponentMountProps["props"][string], undefined>;

/** The same vocabulary as the binding resolver states it. */
type ResolvedBindingValue = Extract<BindingResolution, { readonly ok: true }>["value"];

/**
 * The bidirectional pin. A resolved prop is either an authored scalar or a value
 * the Data Model handed back through `resolveBinding`, so the two declarations
 * describe **one** vocabulary. Both directions are written out, because a
 * one-way check would still accept a mount contract that grew a value the
 * resolver can never produce (or lost one it does).
 */
function asMountValue(value: ResolvedBindingValue): MountValue {
  return value;
}

function asResolvedBindingValue(value: MountValue): ResolvedBindingValue {
  return value;
}

/**
 * A stand-in for the element type a renderer works in. The mount contract is
 * React-free, so the *shape of a rendered thing* is the consumer's to supply —
 * this fixture supplies a trivial one, exactly as `@facet/assets/react` will
 * supply React's.
 */
interface FakeElement {
  readonly rendered: string;
}

/** A trusted component, written the way a registered implementation is written. */
const Card: MountedComponent<readonly FakeElement[], FakeElement> = (props) => {
  const title = props.props["title"];
  const tone = props.themeVars["--facet-semantic-surface-default"] ?? "";
  return { rendered: `${String(title)}|${tone}|${props.children.length}` };
};

const Structured: MountedComponent<readonly FakeElement[], FakeElement> = (props) => ({
  rendered: Object.keys(props.slots).sort().join("|"),
});

/** A collectable component: Facet owns the value and hands back a way to change it. */
const Field = (props: CollectableMount<readonly FakeElement[]>): FakeElement => {
  props.onValueChange(props.props["value"] as CollectedValue);
  return { rendered: `field:${String(props.props["value"])}` };
};

/** An actionable component. Every mount carries `onAction`; the prop names which. */
const Button: MountedComponent<readonly FakeElement[], FakeElement> = (props) => {
  props.onAction("action");
  return { rendered: `button:${String(props.props["label"])}` };
};

/** A mount payload built the way the renderer builds one. */
function mountProps(
  overrides: Partial<ComponentMountProps<readonly FakeElement[]>> = {},
): ComponentMountProps<readonly FakeElement[]> {
  return {
    props: { title: "Revenue", label: "Refresh", value: "north" },
    children: [],
    slots: {},
    themeVars: { "--facet-semantic-surface-default": "#fff" },
    onAction: () => undefined,
    ...overrides,
  };
}

describe("the mount contract is a types-only module", () => {
  it("imports nothing at all, in its own source", () => {
    expectNoDependency("source", readFileSync(MODULE_PATH, "utf8"));
  });

  it("imports nothing at all, in the declaration tsc emits for it", () => {
    // The emitted `.d.ts` is the surface `@facet/assets/react` consumes. A
    // type-only import vanishes before vitest ever runs, so the source scan
    // above cannot stand in for this one.
    expectNoDependency("emitted declaration", emitDeclaration());
  }, 60_000);

  it("emits declarations for exactly the five public names", () => {
    const declaration = emitDeclaration();
    expect(declaration).toMatch(/export\s+interface\s+ComponentMountProps\b/);
    expect(declaration).toMatch(/export\s+type\s+CollectableMount\b/);
    expect(declaration).toMatch(/export\s+type\s+MountedComponent\b/);
    expect(declaration).toMatch(/export\s+type\s+CollectedValue\b/);
    expect(declaration).toMatch(/export\s+type\s+CollectedValueKind\b/);
    const exported = [
      ...declaration.matchAll(/export\s+(?:declare\s+)?(?:interface|type)\s+(\w+)/g),
    ]
      .map((match) => match[1])
      .sort();
    expect(exported).toEqual([
      "CollectableMount",
      "CollectedValue",
      "CollectedValueKind",
      "ComponentMountProps",
      "MountedComponent",
    ]);
  });

  it("contributes no runtime code, so no value can be mounted from it", () => {
    expect(Object.keys(mountContract)).toEqual([]);
  });

  it("carries no React and no DOM", () => {
    // Read the *code*: the module's prose necessarily explains why React lives
    // on the far side of this contract, and a scan a sentence can trip is not a
    // check. What must not appear is a reference in the declarations themselves.
    const code = stripComments(readFileSync(MODULE_PATH, "utf8"));
    expect(code).not.toMatch(/\bReact\w*\b|\bJSX\b/);
    expect(code).not.toMatch(/\b(?:document|window|navigator|globalThis)\s*[.[]/);
    expect(stripComments(emitDeclaration())).not.toMatch(/\bReact\w*\b|\bJSX\b/);
  });
});

describe("the resolved prop vocabulary", () => {
  it("is the same set the binding resolver produces, in both directions", () => {
    const scalars: readonly ResolvedBindingValue[] = ["north", 42, true];
    for (const value of scalars) {
      expect(asMountValue(value)).toBe(value);
      expect(asResolvedBindingValue(value)).toBe(value);
    }
  });

  it("carries the two structured branches a binding can select", () => {
    const rows: ResolvedBindingValue = [{ region: "north" }];
    const record: ResolvedBindingValue = { region: "north" };
    expect(asMountValue(rows)).toEqual([{ region: "north" }]);
    expect(asMountValue(record)).toEqual({ region: "north" });
    expect(asResolvedBindingValue(asMountValue(rows))).toBe(rows);
  });
});

describe("a trusted component mounted through the contract", () => {
  it("reads resolved props, theme variables and children", () => {
    expect(Card(mountProps()).rendered).toBe("Revenue|#fff|0");
  });

  it("renders the children the renderer handed it", () => {
    const children: readonly FakeElement[] = [{ rendered: "a" }, { rendered: "b" }];
    expect(Card(mountProps({ children })).rendered).toBe("Revenue|#fff|2");
  });

  it("receives named slots separately from ordinary children", () => {
    expect(
      Structured(
        mountProps({
          children: [],
          slots: {
            actions: [{ rendered: "save" }],
            body: [{ rendered: "content" }],
          },
        }),
      ).rendered,
    ).toBe("actions|body");
  });

  it("reports an interaction through the injected callback, naming the prop", () => {
    const fired: string[] = [];
    expect(Button(mountProps({ onAction: (prop) => fired.push(prop) })).rendered).toBe(
      "button:Refresh",
    );
    expect(fired).toEqual(["action"]);
  });
});

describe("a collectable component", () => {
  it("receives a guaranteed onValueChange, and its value through the declared prop", () => {
    const seen: CollectedValue[] = [];
    const mount: CollectableMount<readonly FakeElement[]> = {
      ...mountProps(),
      onValueChange: (value) => seen.push(value),
    };
    expect(Field(mount).rendered).toBe("field:north");
    expect(seen).toEqual(["north"]);
  });

  it("accepts exactly strings, booleans, and immutable string arrays", () => {
    const seen: CollectedValue[] = [];
    const mount: CollectableMount<readonly FakeElement[]> = {
      ...mountProps(),
      onValueChange: (value) => seen.push(value),
    };
    mount.onValueChange("north");
    mount.onValueChange(true);
    mount.onValueChange(Object.freeze(["north", "south"]));
    expect(seen).toEqual(["north", true, ["north", "south"]]);
  });

  it("is a narrowing of the ordinary mount payload, not a separate shape", () => {
    // A collectable mount is usable anywhere an ordinary mount is: the two are
    // one declaration, so a component that ignores collection still mounts.
    const mount: CollectableMount<readonly FakeElement[]> = {
      ...mountProps(),
      onValueChange: () => undefined,
    };
    const asOrdinary: ComponentMountProps<readonly FakeElement[]> = mount;
    expect(Card(asOrdinary).rendered).toBe("Revenue|#fff|0");
  });
});
