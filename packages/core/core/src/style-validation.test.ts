import { describe, expect, it } from "vitest";

import {
  BRICK_CONTRACT,
  BRICK_TYPES,
  type BrickStylePropertyContract,
  type BrickStyleTargetContract,
  type BrickType,
  type InputKind,
} from "./brick-contract.js";
import { STYLE_VALUE_CONTRACT } from "./style-value-contract.js";
import { sanitizeBrickStyle } from "./style-validation.js";

interface DomainView {
  readonly values: readonly { readonly name: unknown }[];
}

const tokenDomains = STYLE_VALUE_CONTRACT.tokens as Readonly<Record<string, DomainView>>;
const fixedDomains = STYLE_VALUE_CONTRACT.fixed as Readonly<Record<string, DomainView>>;

function firstAllowed(property: BrickStylePropertyContract): unknown {
  const domains = property.source === "token" ? tokenDomains : fixedDomains;
  return domains[property.domain]?.values[0]?.name;
}

function directProperties(
  properties: Readonly<Record<string, BrickStylePropertyContract>>,
  names: readonly string[] = Object.keys(properties),
): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => [name, firstAllowed(properties[name] as BrickStylePropertyContract)]),
  );
}

function targetStyle(target: BrickStyleTargetContract): Record<string, unknown> {
  const result = directProperties(target.properties);
  for (const [state, names] of Object.entries(target.states ?? {})) {
    result[state] = directProperties(target.properties, names);
  }
  return result;
}

function options(brick: BrickType, inputKind?: InputKind) {
  const issues: string[] = [];
  return {
    issues,
    context:
      inputKind === undefined ? { nodeId: brick, issues } : { nodeId: brick, issues, inputKind },
  };
}

describe("fail-soft Brick style validation", () => {
  it("sanitizes every style path from the Core vocabulary", () => {
    for (const brick of BRICK_TYPES) {
      const contract = BRICK_CONTRACT[brick];
      const root = targetStyle(contract.style.root);
      const rootRun = options(brick);
      expect(sanitizeBrickStyle(brick, root, rootRun.context)).toEqual(root);
      expect(rootRun.issues).toEqual([]);

      for (const [targetName, target] of Object.entries(contract.style.targets)) {
        const inputKind = target.applicableTo?.[0];
        const style = { [targetName]: targetStyle(target) };
        const targetRun = options(brick, inputKind);
        expect(sanitizeBrickStyle(brick, style, targetRun.context)).toEqual(style);
        expect(targetRun.issues).toEqual([]);
      }
    }

    for (const brick of ["box", "text"] as const) {
      const { issues, context } = options(brick);
      const active = directProperties(BRICK_CONTRACT[brick].style.root.properties);
      expect(
        sanitizeBrickStyle(
          brick,
          { preset: "navigationItem", active: { preset: "selectedItem", ...active } },
          context,
        ),
      ).toEqual({ preset: "navigationItem", active: { preset: "selectedItem", ...active } });
      expect(issues).toEqual([]);
    }
  });

  it("drops raw, legacy, state, and inapplicable pieces independently", () => {
    const boxRun = options("box");
    expect(
      sanitizeBrickStyle(
        "box",
        {
          preset: "panel",
          gap: "md",
          padding: "16px",
          background: "magenta",
          hover: { background: "accent", borderWidth: "thin", color: "foreground" },
          bg: "surface",
          pad: "lg",
          scheme: "dark", // style-hard-cut: allowed-negative
          variant: "card", // style-hard-cut: allowed-negative
          activeStyle: { color: "danger" }, // style-hard-cut: allowed-negative
          activeVariant: "selected", // style-hard-cut: allowed-negative
          active: { color: "success", hover: { color: "danger" } },
        },
        boxRun.context,
      ),
    ).toEqual({
      preset: "panel",
      gap: "md",
      hover: { background: "accent", color: "foreground" },
      active: { color: "success" },
    });
    expect(boxRun.issues.length).toBeGreaterThan(0);

    const inputRun = options("input", "text");
    expect(
      sanitizeBrickStyle(
        "input",
        {
          width: "full",
          control: { padding: "sm", focus: { borderColor: "focusRing", color: "danger" } },
          indicator: { indicatorSize: "md" },
          option: { color: "accent" },
          placeholder: { color: "mutedForeground" },
        },
        inputRun.context,
      ),
    ).toEqual({
      width: "full",
      control: { padding: "sm", focus: { borderColor: "focusRing" } },
      placeholder: { color: "mutedForeground" },
    });
  });

  it("is total for cyclic, deep, throwing, and revoked style values", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 10_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor["unknown"] = next;
      cursor = next;
    }
    deep["cycle"] = deep;
    deep["gap"] = "md";

    const throwing = new Proxy(
      { gap: "lg", padding: "sm" },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === "padding") throw new Error("hostile descriptor");
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const { proxy: revoked, revoke } = Proxy.revocable({ gap: "xl" }, {});
    revoke();

    const deepRun = options("box");
    expect(() => sanitizeBrickStyle("box", deep, deepRun.context)).not.toThrow();
    expect(sanitizeBrickStyle("box", deep, deepRun.context)).toEqual({ gap: "md" });

    const throwingRun = options("box");
    expect(() => sanitizeBrickStyle("box", throwing, throwingRun.context)).not.toThrow();
    expect(sanitizeBrickStyle("box", throwing, throwingRun.context)).toEqual({ gap: "lg" });

    const revokedRun = options("box");
    expect(() => sanitizeBrickStyle("box", revoked, revokedRun.context)).not.toThrow();
    expect(sanitizeBrickStyle("box", revoked, revokedRun.context)).toBeUndefined();
  });
});
