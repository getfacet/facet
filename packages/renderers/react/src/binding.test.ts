// @vitest-environment jsdom
/**
 * The proof that a bound component reads the Data Model and nothing else.
 *
 * Four claims carry this suite, and each is a claim about what resolution
 * *cannot* do.
 *
 * **A publish refreshes; it never rewrites.** The markup is authored once. When
 * new data lands, every component bound to it shows the new value without a
 * single node, prop or child id changing — asserted by observing the document
 * for writes while the model is replaced underneath it (DC-019).
 *
 * **A missing path is not an empty value.** `resolveBinding` already draws that
 * line in core; the renderer has to keep it. A path the model no longer selects
 * leaves the prop **absent** with a structured issue, never `""`, and a value
 * that resolved a moment ago does not survive the publish that removed it.
 *
 * **The mount contract is honoured exactly.** A trusted component is handed
 * declared props only: an undeclared prop a corrupt persisted document carries
 * is refused rather than forwarded, an out-of-domain scalar is refused rather
 * than coerced, and `"3"`/`"true"` arrive as `3`/`true` because the mount
 * contract's value union has no place for a stringly-typed number.
 *
 * **Resolution is total.** Any node, any spec, any model — including a model
 * whose getter throws — yields a resolution rather than an exception, because
 * the alternative is unwinding a subtree over data the host published.
 */

import { BOUNDS } from "@facet/core";
import type { ComponentMountProps, ComponentNode, ComponentSpec, DataModel } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DataProvider, resolveProps, useDataModel, useResolvedProps } from "./binding.js";

afterEach(cleanup);

/** One stored prop value, named from the document rather than restated. */
type StoredValue = ComponentNode["props"][string];

function scalar(value: string): StoredValue {
  return { kind: "scalar", value };
}

function reference(scheme: "data" | "nav" | "agent", target: string): StoredValue {
  return { kind: "reference", scheme, target };
}

function node(tag: string, props: Readonly<Record<string, StoredValue>>): ComponentNode {
  return { tag, props, children: [] };
}

/**
 * A fixture spec exercising every branch a resolution has: the two structured
 * bindable types, a bindable scalar, a domain-restricted scalar, a defaulted
 * scalar, a required scalar, and a string prop that may carry an action.
 */
const SPEC: ComponentSpec = {
  tag: "Panel",
  whenToUse: "A fixture, not a real component.",
  props: {
    caption: { type: "string", required: true, guidance: "The required one." },
    rows: { type: "array", bindable: true, guidance: "Bound rows." },
    meta: { type: "object", bindable: true, guidance: "A bound record." },
    total: { type: "number", bindable: true, guidance: "A bound number." },
    limit: { type: "number", default: 10, minimum: 1, maximum: 50, guidance: "A bounded count." },
    // Bindable **and** ranged, which is what the core-to-renderer mapping test
    // needs: core rejects the out-of-range bound value, and the renderer has to
    // surface that rejection rather than mount anything.
    percent: {
      type: "number",
      bindable: true,
      minimum: 0,
      maximum: 100,
      guidance: "A bound percentage.",
    },
    dense: { type: "boolean", default: false, guidance: "A flag." },
    tone: { type: "string", enum: ["primary", "quiet"], default: "quiet", guidance: "A domain." },
    arg: { type: "string", guidance: "The event argument." },
    action: { type: "string", guidance: "May carry an action reference." },
    plain: { type: "string", guidance: "An ordinary optional string, no default." },
  },
  acceptsChildren: false,
};

const MODEL: DataModel = {
  sales: {
    rows: [{ region: "north" }, { region: "south" }],
    total: 42,
    label: "Sales",
    meta: { currency: "USD" },
    share: 40,
    overShare: 500,
    negativeShare: -1,
  },
};

/** Every write attempted against a value or anything reachable from it. */
interface Observation {
  readonly value: unknown;
  readonly writes: readonly string[];
}

/**
 * Wraps `value` in a recursive Proxy that records every attempted write.
 *
 * This is the patch observer in its most direct form: a patch is a write to the
 * document or the model, so a resolution that performs none cannot have applied
 * one. Freezing alone would not do — a frozen write throws, and a caller that
 * swallowed the throw would look clean. The proxy records the *attempt*.
 */
function observed(value: unknown): Observation {
  const writes: string[] = [];
  const wrap = (target: unknown, path: string): unknown => {
    if (typeof target !== "object" || target === null) {
      return target;
    }
    return new Proxy(target as Record<string, unknown>, {
      get(holder, key, receiver): unknown {
        const read: unknown = Reflect.get(holder, key, receiver);
        return typeof key === "string" ? wrap(read, path === "" ? key : `${path}.${key}`) : read;
      },
      set(_holder, key): boolean {
        writes.push(`set ${path}.${String(key)}`);
        return true;
      },
      defineProperty(_holder, key): boolean {
        writes.push(`define ${path}.${String(key)}`);
        return true;
      },
      deleteProperty(_holder, key): boolean {
        writes.push(`delete ${path}.${String(key)}`);
        return true;
      },
    });
  };
  return { value: wrap(value, ""), writes };
}

/** The issue reasons for one prop name, so an assertion names both halves. */
function issuesFor(resolution: ReturnType<typeof resolveProps>, prop: string): readonly string[] {
  return resolution.issues
    .filter((issue) => issue.scope === "prop" && issue.prop === prop)
    .map((issue) => issue.reason);
}

/** Every issue about the node itself rather than about one of its declared props. */
function nodeIssues(resolution: ReturnType<typeof resolveProps>): readonly string[] {
  return resolution.issues.filter((issue) => issue.scope === "node").map((issue) => issue.reason);
}

describe("resolveProps hands a trusted component declared props only", () => {
  it("resolves an authored scalar into the mount contract's own value types", () => {
    const resolution = resolveProps(
      node("Panel", {
        caption: scalar("Revenue"),
        limit: scalar("25"),
        dense: scalar("true"),
        tone: scalar("primary"),
      }),
      SPEC,
      MODEL,
    );

    expect(resolution.issues).toEqual([]);
    expect(resolution.props["caption"]).toBe("Revenue");
    expect(resolution.props["limit"]).toBe(25);
    expect(resolution.props["dense"]).toBe(true);
    expect(resolution.props["tone"]).toBe("primary");
  });

  it("fills a declared default for a prop the author omitted", () => {
    const resolution = resolveProps(node("Panel", { caption: scalar("Revenue") }), SPEC, MODEL);

    expect(resolution.issues).toEqual([]);
    expect(resolution.props["limit"]).toBe(10);
    expect(resolution.props["dense"]).toBe(false);
    expect(resolution.props["tone"]).toBe("quiet");
    expect("plain" in resolution.props).toBe(false);
  });

  it("fills a declared default the catalog validated, domain and all, without re-checking it", () => {
    // The declared domain is enforced once, by `validateComponentSpec` at
    // bootstrap (`default_outside_domain`). The renderer does not re-read it,
    // so a default outside its own declared range is filled here — that is the
    // catalog's fault to have refused, not this module's to re-litigate.
    const spec: ComponentSpec = {
      tag: "Panel",
      whenToUse: "A fixture.",
      props: {
        caption: { type: "string", required: true, guidance: "The required one." },
        limit: { type: "number", minimum: 1, maximum: 50, default: 999, guidance: "Bounded." },
        tone: { type: "string", enum: ["primary"], default: "elsewhere", guidance: "A domain." },
      },
      acceptsChildren: false,
    };
    const resolution = resolveProps(node("Panel", { caption: scalar("Revenue") }), spec, MODEL);

    expect(resolution.props["limit"]).toBe(999);
    expect(resolution.props["tone"]).toBe("elsewhere");
    expect(resolution.issues).toEqual([]);
  });

  it("still narrows a default to its declared runtime type — a type guard, not a domain check", () => {
    // What survives on this path, and the only thing that does: the mount
    // contract's value union admits a string, a boolean or a **finite** number,
    // so a default that is none of those cannot be handed to a component. This
    // asserts types, never domains — the test above is what proves the domain
    // is no longer consulted.
    const spec: ComponentSpec = {
      tag: "Panel",
      whenToUse: "A fixture.",
      props: {
        caption: { type: "string", required: true, guidance: "The required one." },
        limit: { type: "number", default: Number.NaN, guidance: "Not a finite number." },
        tone: { type: "string", default: 7, guidance: "Not a string." },
        dense: { type: "boolean", default: "yes", guidance: "Not a boolean." },
      },
      acceptsChildren: false,
    } as unknown as ComponentSpec;
    const resolution = resolveProps(node("Panel", { caption: scalar("Revenue") }), spec, MODEL);

    expect("limit" in resolution.props).toBe(false);
    expect("tone" in resolution.props).toBe(false);
    expect("dense" in resolution.props).toBe(false);
    expect(resolution.props["caption"]).toBe("Revenue");
  });

  it("refuses a prop the spec does not declare instead of forwarding it", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("Revenue"), onClick: scalar("alert(1)") }),
      SPEC,
      MODEL,
    );

    expect("onClick" in resolution.props).toBe(false);
    expect(issuesFor(resolution, "onClick")).toEqual(["unknown_prop"]);
  });

  it("reports a required prop the document does not carry", () => {
    const resolution = resolveProps(node("Panel", {}), SPEC, MODEL);

    expect("caption" in resolution.props).toBe(false);
    expect(issuesFor(resolution, "caption")).toEqual(["missing_required"]);
  });

  it("refuses a scalar outside the declared domain rather than passing it on", () => {
    const outOfEnum = resolveProps(
      node("Panel", { caption: scalar("x"), tone: scalar("loud") }),
      SPEC,
      MODEL,
    );
    const overMaximum = resolveProps(
      node("Panel", { caption: scalar("x"), limit: scalar("51") }),
      SPEC,
      MODEL,
    );
    const underMinimum = resolveProps(
      node("Panel", { caption: scalar("x"), limit: scalar("0") }),
      SPEC,
      MODEL,
    );
    const notANumber = resolveProps(
      node("Panel", { caption: scalar("x"), limit: scalar("1e3") }),
      SPEC,
      MODEL,
    );
    const notABoolean = resolveProps(
      node("Panel", { caption: scalar("x"), dense: scalar("yes") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(outOfEnum, "tone")).toEqual(["invalid_value"]);
    expect(issuesFor(overMaximum, "limit")).toEqual(["invalid_value"]);
    expect(issuesFor(underMinimum, "limit")).toEqual(["invalid_value"]);
    expect(issuesFor(notANumber, "limit")).toEqual(["invalid_value"]);
    expect(issuesFor(notABoolean, "dense")).toEqual(["invalid_value"]);
    expect("tone" in outOfEnum.props).toBe(false);
    expect("limit" in overMaximum.props).toBe(false);
  });

  it("reports an exact lowercase resolved arg past B-23 as a node-scoped issue", () => {
    const overBound = "x".repeat(BOUNDS.collectedValueChars + 1);
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), arg: scalar(overBound) }),
      SPEC,
      MODEL,
    );

    expect(resolution.props["arg"]).toBe(overBound);
    expect(nodeIssues(resolution)).toEqual(["event_arg_too_long"]);
    expect(resolution.issues.filter((issue) => issue.scope === "prop")).toEqual([]);
  });

  it("does not substitute the declared default for a prop that failed", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), tone: scalar("loud") }),
      SPEC,
      MODEL,
    );

    expect("tone" in resolution.props).toBe(false);
  });

  it("refuses a structured prop written inline as a scalar", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), rows: scalar("[]") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "rows")).toEqual(["invalid_value"]);
    expect("rows" in resolution.props).toBe(false);
  });
});

describe("resolveProps reads the Data Model through the declared schema", () => {
  it("selects the bound array, object and number the path names", () => {
    const resolution = resolveProps(
      node("Panel", {
        caption: scalar("x"),
        rows: reference("data", "sales.rows"),
        meta: reference("data", "sales.meta"),
        total: reference("data", "sales.total"),
      }),
      SPEC,
      MODEL,
    );

    expect(resolution.issues).toEqual([]);
    expect(resolution.props["rows"]).toEqual([{ region: "north" }, { region: "south" }]);
    expect(resolution.props["meta"]).toEqual({ currency: "USD" });
    expect(resolution.props["total"]).toBe(42);
  });

  it("leaves a dangling path absent rather than rendering it as empty", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), rows: reference("data", "sales.missing") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "rows")).toEqual(["unresolved_binding"]);
    expect("rows" in resolution.props).toBe(false);
    expect(Object.values(resolution.props)).not.toContain("");
  });

  it("refuses a bound value whose shape disagrees with the declared type", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), rows: reference("data", "sales.label") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "rows")).toEqual(["unresolved_binding"]);
  });

  it("refuses a binding on a prop the spec does not declare bindable", () => {
    const resolution = resolveProps(
      node("Panel", { caption: reference("data", "sales.label") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "caption")).toEqual(["binding_not_allowed"]);
    expect("caption" in resolution.props).toBe(false);
  });

  it("refuses a reference that is not a data path", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), rows: reference("data", "sales.0.rows") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "rows")).toEqual(["invalid_value"]);
  });

  it("never descends into a collection, so a length read is not published data", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), total: reference("data", "sales.rows.length") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "total")).toEqual(["unresolved_binding"]);
  });

  it("CONTRACT (core→renderer): an out-of-range bound value maps to an issue and is not mounted", () => {
    // **Core-to-renderer contract mapping, not renderer range enforcement** —
    // the name carries that distinction because the test cannot. The range is
    // enforced once, by `resolveBinding`; the renderer neither re-checks it nor
    // could, and the duplicate reader that used to sit here was removed for
    // exactly that reason. What is this module's to get right is the *mapping*:
    // core's `schema_mismatch` has to surface as `unresolved_binding`, and the
    // prop must not reach the mount. That is the whole of what this asserts.
    const overMaximum = resolveProps(
      node("Panel", { caption: scalar("x"), percent: reference("data", "sales.overShare") }),
      SPEC,
      MODEL,
    );
    const underMinimum = resolveProps(
      node("Panel", { caption: scalar("x"), percent: reference("data", "sales.negativeShare") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(overMaximum, "percent")).toEqual(["unresolved_binding"]);
    expect("percent" in overMaximum.props).toBe(false);
    expect(issuesFor(underMinimum, "percent")).toEqual(["unresolved_binding"]);
    expect("percent" in underMinimum.props).toBe(false);
  });

  it("stays total over a model whose getter throws", () => {
    const hostile: DataModel = {
      get sales(): unknown {
        throw new Error("hostile getter");
      },
    };
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), total: reference("data", "sales.total") }),
      SPEC,
      hostile,
    );

    expect(issuesFor(resolution, "total")).toEqual(["unresolved_binding"]);
  });
});

describe("resolveProps carries an action reference without acting on it", () => {
  it("hands the component the authored reference text on a string prop", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), action: reference("nav", "details") }),
      SPEC,
      MODEL,
    );

    expect(resolution.issues).toEqual([]);
    expect(resolution.props["action"]).toBe("nav:details");
  });

  it("carries an agent reference the same way", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), action: reference("agent", "refresh") }),
      SPEC,
      MODEL,
    );

    expect(resolution.props["action"]).toBe("agent:refresh");
  });

  it("refuses an action on a prop that is not declared a string", () => {
    const resolution = resolveProps(
      node("Panel", { caption: scalar("x"), total: reference("nav", "details") }),
      SPEC,
      MODEL,
    );

    expect(issuesFor(resolution, "total")).toEqual(["invalid_value"]);
    expect("total" in resolution.props).toBe(false);
  });
});

describe("one hostile prop cannot erase the props that resolved beside it", () => {
  // Totality is not the whole guarantee. A resolution that swallows a throw and
  // returns `{props:{}, issues:[]}` reports **success** — the corrupt-subtree
  // policy downstream sees a clean, issue-free node and mounts a component with
  // no props at all, with the required prop's `missing_required` gone too. So
  // each of these asserts both halves: the sibling that resolved is still there,
  // and the fault is reported rather than discarded.

  it("isolates a prop whose own stored value cannot even be looked up", () => {
    // The live isolation input at the **node** end. A `props` object whose
    // `getOwnPropertyDescriptor` trap throws makes the "is this prop present?"
    // question itself throw, inside the per-prop walk — so it still reaches
    // `resolution_failed`, and the sibling that resolved before it must be
    // untouched. Two of this suite's original inputs no longer reach that path
    // (core absorbs them now, recorded below), which is exactly why the
    // property needs an input that does.
    const stored = {
      caption: scalar("Revenue"),
      total: scalar("7"),
    };
    const hostile = new Proxy(stored as unknown as Record<string, unknown>, {
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        if (key === "total") {
          throw new Error("hostile descriptor");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const resolution = resolveProps(
      { tag: "Panel", props: hostile, children: [] } as unknown as ComponentNode,
      SPEC,
      MODEL,
    );

    expect(resolution.props["caption"]).toBe("Revenue");
    expect(issuesFor(resolution, "total")).toEqual(["resolution_failed"]);
    expect(nodeIssues(resolution)).toEqual([]);
  });

  it("REGRESSION (core): a revoked proxy in the model is rejected, not thrown", () => {
    // Re-aimed, not deleted. This input used to throw out of `resolveBinding`
    // and prove the renderer's per-prop isolation; WU-14 made core total over
    // it, so the throw is gone and `resolution_failed` no longer fires. What is
    // still worth pinning is the pair of outcomes the renderer depends on: core
    // answers with a **structured rejection** rather than an exception, and the
    // sibling resolves normally. If core ever regresses to throwing, this test
    // reports `resolution_failed` again and names the change.
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const resolution = resolveProps(
      node("Panel", { caption: scalar("Revenue"), total: reference("data", "sales.total") }),
      SPEC,
      { sales: revoked.proxy } as unknown as DataModel,
    );

    expect(resolution.props["caption"]).toBe("Revenue");
    expect(issuesFor(resolution, "total")).toEqual(["unresolved_binding"]);
  });

  it("REGRESSION (core): a schema whose `bindable` getter throws reads as not bindable", () => {
    // Re-aimed for the same reason as the revoked proxy above. Core now reads
    // the schema defensively instead of letting the getter throw, so the prop
    // is refused as `binding_not_allowed` — the same answer an ordinary
    // non-bindable prop gets, which is the conservative one — and the sibling
    // resolves. `resolution_failed` firing here again would mean core stopped
    // absorbing it.
    const hostile = { type: "array", guidance: "Bound rows." };
    Object.defineProperty(hostile, "bindable", {
      enumerable: true,
      get(): boolean {
        throw new Error("hostile schema");
      },
    });
    const spec: ComponentSpec = {
      tag: "Panel",
      whenToUse: "A fixture.",
      props: {
        caption: { type: "string", required: true, guidance: "The required one." },
        rows: hostile as unknown as ComponentSpec["props"][string],
      },
      acceptsChildren: false,
    };
    const resolution = resolveProps(
      node("Panel", { caption: scalar("Revenue"), rows: reference("data", "sales.rows") }),
      spec,
      MODEL,
    );

    expect(resolution.props["caption"]).toBe("Revenue");
    expect(issuesFor(resolution, "rows")).toEqual(["binding_not_allowed"]);
  });

  it("isolates an authored scalar whose declared domain throws while being read", () => {
    // The live isolation input at the **schema** end, and it now covers the
    // authored path only. The defaulted half was removed deliberately, not
    // lost: the declared-default path no longer reads `enum`/`minimum`/
    // `maximum` at all, so a hostile domain is never touched there. Only the
    // authored path still reads a declared domain, so only it can still throw.
    const domain: string[] = ["primary"];
    Object.defineProperty(domain, "includes", {
      value: (): boolean => {
        throw new Error("hostile domain");
      },
    });
    const spec: ComponentSpec = {
      tag: "Panel",
      whenToUse: "A fixture.",
      props: {
        caption: { type: "string", required: true, guidance: "The required one." },
        tone: { type: "string", enum: domain, default: "primary", guidance: "A domain." },
      },
      acceptsChildren: false,
    };

    const authored = resolveProps(
      node("Panel", { caption: scalar("Revenue"), tone: scalar("primary") }),
      spec,
      MODEL,
    );

    expect(authored.props["caption"]).toBe("Revenue");
    expect(issuesFor(authored, "tone")).toEqual(["resolution_failed"]);
  });

  it("reports a node-scoped fault, not a clean empty resolution, for a node it cannot read", () => {
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const resolution = resolveProps(revoked.proxy as unknown as ComponentNode, SPEC, MODEL);

    // Nothing could be read, so nothing resolved — and "nothing resolved" must
    // never be reported as "nothing was wrong". The fault belongs to the node,
    // so it is carried by a **discriminated node-scoped issue** rather than by
    // a prop-scoped issue wearing a reserved prop name. `mount-node.tsx` reads
    // any such issue as a corrupt subtree.
    expect(Object.keys(resolution.props)).toEqual([]);
    expect(nodeIssues(resolution)).toEqual(["node_unreadable"]);
  });

  it("reports a node-scoped fault for a spec it cannot read", () => {
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const resolution = resolveProps(
      node("Panel", { caption: scalar("Revenue") }),
      revoked.proxy as unknown as ComponentSpec,
      MODEL,
    );

    expect(nodeIssues(resolution)).toEqual(["spec_unreadable"]);
  });

  it("carries no issue on a reserved or magic prop name", () => {
    // The node-level fault used to be encoded as a prop-scoped issue with an
    // empty prop name. Nothing may reintroduce that: a consumer narrowing on
    // `scope` must be able to trust that a prop-scoped issue names a real prop.
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const resolutions = [
      resolveProps(revoked.proxy as unknown as ComponentNode, SPEC, MODEL),
      resolveProps(node("Panel", {}), revoked.proxy as unknown as ComponentSpec, MODEL),
      resolveProps(node("Panel", { caption: scalar("x"), rows: scalar("[]") }), SPEC, MODEL),
    ];

    for (const resolution of resolutions) {
      for (const issue of resolution.issues) {
        if (issue.scope === "prop") {
          expect(issue.prop).not.toBe("");
          expect(issue.prop.length).toBeGreaterThan(0);
        } else {
          expect(issue.scope).toBe("node");
          expect(Object.prototype.hasOwnProperty.call(issue, "prop")).toBe(false);
        }
      }
    }
  });

  it("keeps a node-scoped fault distinguishable from a resolution with no issues", () => {
    const revoked = Proxy.revocable<Record<string, unknown>>({}, {});
    revoked.revoke();
    const failed = resolveProps(revoked.proxy as unknown as ComponentNode, SPEC, MODEL);
    const clean = resolveProps(node("Panel", { caption: scalar("Revenue") }), SPEC, MODEL);

    // Both have "no usable props" in common. Only one of them is a fault, and a
    // caller must be able to tell which without inspecting the props record.
    expect(failed.issues.length).toBeGreaterThan(0);
    expect(clean.issues).toEqual([]);
    expect(nodeIssues(failed)).not.toEqual([]);
    expect(nodeIssues(clean)).toEqual([]);
  });

  it("scopes every per-prop fault to the prop it belongs to", () => {
    const resolution = resolveProps(
      node("Panel", { rows: scalar("[]"), onClick: scalar("alert(1)") }),
      SPEC,
      MODEL,
    );

    expect(nodeIssues(resolution)).toEqual([]);
    expect(resolution.issues.every((issue) => issue.scope === "prop")).toBe(true);
    expect(issuesFor(resolution, "caption")).toEqual(["missing_required"]);
    expect(issuesFor(resolution, "rows")).toEqual(["invalid_value"]);
    expect(issuesFor(resolution, "onClick")).toEqual(["unknown_prop"]);
  });

  it("never assigns a resolved value through the prototype setter", () => {
    // The catalog refuses a prop named `__proto__` (an identifier starts with a
    // letter), so this is defense in depth against a spec that never went
    // through it: assigning `props["__proto__"]` on an ordinary object literal
    // silently re-points the record's prototype instead of storing a value.
    const spec = {
      tag: "Panel",
      whenToUse: "A fixture.",
      props: { ["__proto__"]: { type: "string", guidance: "Hostile." } },
      acceptsChildren: false,
    } as unknown as ComponentSpec;
    const hostileNode = {
      tag: "Panel",
      props: { ["__proto__"]: scalar("polluted") },
      children: [],
    } as unknown as ComponentNode;

    const resolution = resolveProps(hostileNode, spec, MODEL);

    expect(Object.prototype.hasOwnProperty.call(resolution.props, "__proto__")).toBe(true);
    expect(resolution.props["__proto__"]).toBe("polluted");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("resolveProps is total and observably read-only", () => {
  it("returns a resolution for any node, spec and model of any type", () => {
    const garbage: readonly unknown[] = [
      undefined,
      null,
      0,
      "",
      [],
      { tag: 1 },
      { props: null },
      { props: { a: 1 }, children: 2 },
      new Map(),
    ];

    for (const nodeInput of garbage) {
      for (const specInput of garbage) {
        const resolution = resolveProps(
          nodeInput as ComponentNode,
          specInput as ComponentSpec,
          garbage as unknown as DataModel,
        );
        expect(Array.isArray(resolution.issues)).toBe(true);
        expect(typeof resolution.props).toBe("object");
      }
    }
  });

  it("writes nothing to the node or the model, and repeats byte-identically", () => {
    const source = node("Panel", {
      caption: scalar("Revenue"),
      rows: reference("data", "sales.rows"),
      action: reference("nav", "details"),
    });
    const watchedNode = observed(source);
    const watchedModel = observed(MODEL);
    const before = JSON.stringify([source, MODEL]);

    const first = resolveProps(
      watchedNode.value as ComponentNode,
      SPEC,
      watchedModel.value as DataModel,
    );
    const second = resolveProps(
      watchedNode.value as ComponentNode,
      SPEC,
      watchedModel.value as DataModel,
    );

    expect(watchedNode.writes).toEqual([]);
    expect(watchedModel.writes).toEqual([]);
    expect(JSON.stringify([source, MODEL])).toBe(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("hands back a frozen prop record, so a component cannot write through it", () => {
    const resolution = resolveProps(node("Panel", { caption: scalar("x") }), SPEC, MODEL);

    expect(Object.isFrozen(resolution.props)).toBe(true);
    expect(Object.isFrozen(resolution.issues)).toBe(true);
  });
});

/** What one mounted probe reported on its last render. */
interface Probe {
  readonly renders: number;
  readonly text: string;
}

const PROBES = new Map<string, { renders: number }>();

/**
 * A component that resolves one node's props and prints them, counting its own
 * renders so "the publish refreshed this component" is an observation rather
 * than an inference.
 */
function BoundProbe(props: {
  readonly id: string;
  readonly node: ComponentNode;
  readonly spec: ComponentSpec;
}): ReactNode {
  const resolution = useResolvedProps(props.node, props.spec);
  const counter = PROBES.get(props.id) ?? { renders: 0 };
  counter.renders += 1;
  PROBES.set(props.id, counter);
  return createElement("output", { "data-testid": props.id }, JSON.stringify(resolution.props));
}

function probe(id: string, container: HTMLElement): Probe {
  const element = container.querySelector(`[data-testid="${id}"]`);
  return { renders: PROBES.get(id)?.renders ?? 0, text: element?.textContent ?? "" };
}

afterEach(() => {
  PROBES.clear();
});

describe("an accepted publish refreshes every bound component with no markup rewrite", () => {
  const boundNode = node("Panel", {
    caption: scalar("Revenue"),
    total: reference("data", "sales.total"),
  });
  const alsoBound = node("Panel", {
    caption: scalar("Costs"),
    rows: reference("data", "sales.rows"),
  });
  const unbound = node("Panel", { caption: scalar("Static") });
  const FIXTURE_NODES: readonly ComponentNode[] = [boundNode, alsoBound, unbound];

  /**
   * The three probes over one model.
   *
   * `nodes` is a parameter rather than a closure over the module-level fixtures
   * for one reason: it is the only way the write observer below can actually
   * observe anything. Rendering the fixtures directly while asserting on a
   * separately-wrapped copy would make that assertion unfalsifiable.
   */
  const tree = (model: DataModel, nodes: readonly ComponentNode[] = FIXTURE_NODES): ReactNode =>
    createElement(DataProvider, {
      model,
      children: ["a", "b", "c"].map((id, index) =>
        createElement(BoundProbe, {
          key: id,
          id,
          node: nodes[index] as ComponentNode,
          spec: SPEC,
        }),
      ),
    });

  it("shows the published value and, after a publish, the new one", () => {
    const watched = observed(FIXTURE_NODES);
    const rendered = watched.value as readonly ComponentNode[];
    const documentBefore = JSON.stringify(FIXTURE_NODES);
    const { container, rerender } = render(tree(MODEL, rendered));

    expect(probe("a", container).text).toContain('"total":42');

    const published: DataModel = {
      sales: { ...(MODEL["sales"] as Record<string, unknown>), total: 43 },
    };
    rerender(tree(published, rendered));

    expect(probe("a", container).text).toContain('"total":43');
    expect(probe("a", container).renders).toBe(2);
    expect(watched.writes).toEqual([]);
    expect(JSON.stringify(FIXTURE_NODES)).toBe(documentBefore);
  });

  it("refreshes every affected component, not only the first", () => {
    const { container, rerender } = render(tree(MODEL));

    expect(probe("b", container).text).toContain("north");

    rerender(tree({ sales: { rows: [{ region: "west" }], total: 42 } }));

    expect(probe("b", container).text).toContain("west");
    expect(probe("b", container).text).not.toContain("north");
  });

  it("does not let a resolved value survive the publish that removed its path", () => {
    const { container, rerender } = render(tree(MODEL));

    expect(probe("a", container).text).toContain('"total":42');

    rerender(tree({ sales: { rows: [], label: "Sales" } }));

    expect(probe("a", container).text).not.toContain("42");
    expect(probe("a", container).text).not.toContain('"total"');
  });

  it("keeps a component with no binding byte-identical across a publish", () => {
    const { container, rerender } = render(tree(MODEL));
    const before = probe("c", container).text;

    rerender(tree({ sales: { rows: [], total: 1 } }));

    expect(probe("c", container).text).toBe(before);
  });

  it("requires a new model object per publish — an in-place edit is invisible, by contract", () => {
    // This pins the **caller's** obligation, not a bug: refresh is keyed on the
    // model's identity, so a publish that mutates the committed model in place
    // would leave every bound component frozen at its pre-publish value with no
    // error and no issue — DC-019's failure arriving silently. `writePath` in
    // core already derives a new model and never mutates the prior one, so the
    // obligation is met by construction upstream; this test is here so that a
    // future caller which mutates instead fails *here*, loudly, rather than in
    // a browser. If this test ever fails, the caller broke the contract.
    const mutable: Record<string, unknown> = { sales: { total: 1 } };
    const { container, rerender } = render(tree(mutable as DataModel));

    expect(probe("a", container).text).toContain('"total":1');

    (mutable["sales"] as Record<string, unknown>)["total"] = 999;
    rerender(tree(mutable as DataModel));

    expect(probe("a", container).text).toContain('"total":1');
    expect(probe("a", container).text).not.toContain("999");

    // The same edit published as a new object — what a real publish does — is
    // seen immediately, which is what makes the line above a precondition
    // rather than a defect in the refresh path.
    rerender(tree({ sales: { total: 999 } }));

    expect(probe("a", container).text).toContain('"total":999');
  });

  it("re-resolves rather than caching when only the model changed", () => {
    const { container, rerender } = render(tree(MODEL));

    rerender(tree(MODEL));
    const unchanged = probe("a", container).text;
    rerender(tree({ sales: { total: 7 } }));

    expect(unchanged).toContain('"total":42');
    expect(probe("a", container).text).toContain('"total":7');
  });
});

describe("the Data Model has exactly one source", () => {
  it("is a determinate error to read the model with no provider above", () => {
    function Orphan(): ReactNode {
      useDataModel();
      return null;
    }

    expect(() => render(createElement(Orphan))).toThrow();
  });

  it("hands the provided model through unchanged", () => {
    let seen: DataModel | null = null;
    function Reader(): ReactNode {
      seen = useDataModel();
      return null;
    }
    render(createElement(DataProvider, { model: MODEL, children: createElement(Reader) }));

    expect(seen).toBe(MODEL);
  });
});

describe("the resolved props are the mount contract's props", () => {
  it("is assignable to what a trusted component is handed", () => {
    const resolution = resolveProps(node("Panel", { caption: scalar("x") }), SPEC, MODEL);
    const mounted: ComponentMountProps<ReactNode>["props"] = resolution.props;

    expect(mounted["caption"]).toBe("x");
  });
});
