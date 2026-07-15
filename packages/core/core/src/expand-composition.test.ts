import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ISSUES_SUPPRESSED, MAX_ISSUES } from "./issues.js";
import { MAX_FIELD_VALUE_CHARS } from "./protocol.js";
import { expandComposition } from "./expand-composition.js";
import { SLOT_MARKER_RE, type FacetComposition } from "./validate.js";

// The registry entries are authored as loose document literals (like the first
// `expandComposition` argument, which is `unknown`); they are re-validated by
// `validateComposition` when a reference targets them, so this cast only relaxes
// the compile-time shape for the strict `compositions` option.
const asRegistry = (comps: readonly unknown[]): readonly FacetComposition[] =>
  comps as unknown as readonly FacetComposition[];

const EXPECTED_TYPE_EXPORTS = [
  "CompositionParams",
  "ExpandAt",
  "UseCompositionResult",
  "ExpandCompositionResult",
  "ExpandCompositionOptions",
] as const;

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((item) => item.kind === kind) ?? false)
  );
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function mintFrom(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    index += 1;
    if (id === undefined) throw new Error("mint exhausted");
    return id;
  };
}

function textComposition(value = "Hello") {
  return {
    name: "single",
    root: "text",
    nodes: { text: { id: "text", type: "text", value } },
  };
}

function expectNoOp(result: ReturnType<typeof expandComposition>): void {
  expect(result.root).toBeUndefined();
  expect(result.nodes).toEqual({});
  expect(result.slots).toEqual({});
  expect(result.ids).toEqual({});
}

function throwingMessage(sentinel: string): object {
  const hostile = Object.create(null) as object;
  Object.defineProperty(hostile, "message", {
    get() {
      throw new Error(sentinel);
    },
  });
  return hostile;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

describe("expandComposition", () => {
  it("exports exactly the canonical expansion surface", () => {
    const path = new URL("./expand-composition.ts", import.meta.url);
    const source = ts.createSourceFile(
      path.pathname,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const typeExports: string[] = [];
    const valueExports: string[] = [];
    const forbidden: string[] = [];

    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement)) {
        forbidden.push("export assignment/default export");
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        forbidden.push(
          statement.exportClause === undefined ? "export star" : "explicit re-export declaration",
        );
        continue;
      }
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) forbidden.push("default modifier");

      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        typeExports.push(statement.name.text);
      } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
        valueExports.push(statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        valueExports.push(
          ...statement.declarationList.declarations.flatMap((declaration) =>
            bindingNames(declaration.name),
          ),
        );
      } else {
        forbidden.push(`unsupported exported ${ts.SyntaxKind[statement.kind] ?? "declaration"}`);
      }
    }

    expect(typeExports.sort()).toEqual([...EXPECTED_TYPE_EXPORTS].sort());
    expect(valueExports).toEqual(["expandComposition"]);
    expect(forbidden).toEqual([]);
  });

  describe("bounds hostile expansion work", () => {
    it("accepts 1023 reachable nodes and refuses 1024 without minting", () => {
      const documentWith = (count: number) => {
        const children = Array.from({ length: count - 1 }, (_, index) => `n${String(index + 1)}`);
        const nodes: Record<string, unknown> = {
          root: { id: "root", type: "box", children },
        };
        for (const child of children) {
          nodes[child] = { id: child, type: "text", value: child };
        }
        return { name: `nodes-${String(count)}`, root: "root", nodes };
      };

      let acceptedMints = 0;
      const accepted = expandComposition(
        documentWith(1023),
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => `fresh-${String((acceptedMints += 1))}`,
        },
      );
      expect(Object.keys(accepted.nodes)).toHaveLength(1023);
      expect(acceptedMints).toBe(1023);

      let refusedMints = 0;
      const refused = expandComposition(
        documentWith(1024),
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => `unused-${String((refusedMints += 1))}`,
        },
      );
      expectNoOp(refused);
      expect(refusedMints).toBe(0);
      expect(refused.issues.some((issue) => issue.includes("1023") && issue.includes("cap"))).toBe(
        true,
      );
      expect(refused.issues.length).toBeLessThanOrEqual(MAX_ISSUES + 1);
    });

    it("caps yielded existing ids, malformed entries, and infinite iterables", () => {
      function* exactExistingIds(): Generator<string> {
        yield "page";
        for (let index = 1; index < 5000; index += 1) yield `known-${String(index)}`;
      }
      const accepted = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: exactExistingIds(),
          mintId: () => "fresh-text",
        },
      );
      expect(accepted.root).toBe("fresh-text");

      let overObserved = 0;
      function* overCap(): Generator<string> {
        for (let index = 0; index < 6000; index += 1) {
          overObserved += 1;
          yield index === 0 ? "page" : `known-${String(index)}`;
        }
      }
      let overMints = 0;
      const over = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: overCap(),
          mintId: () => `unused-${String((overMints += 1))}`,
        },
      );
      expectNoOp(over);
      expect(overObserved).toBe(5001);
      expect(overMints).toBe(0);

      let infiniteObserved = 0;
      let infiniteClosed = false;
      function* infinite(): Generator<string> {
        try {
          yield "page";
          while (true) {
            infiniteObserved += 1;
            yield `repeat-${String(infiniteObserved)}`;
          }
        } finally {
          infiniteClosed = true;
        }
      }
      const infiniteResult = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: infinite(),
          mintId: () => "unused",
        },
      );
      expectNoOp(infiniteResult);
      expect(infiniteObserved).toBe(5000);
      expect(infiniteClosed).toBe(true);

      const malformedIterable = {
        *[Symbol.iterator]() {
          yield "page";
          yield 42;
        },
      } as unknown as Iterable<string>;
      const malformed = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: malformedIterable,
          mintId: () => "unused",
        },
      );
      expectNoOp(malformed);
      expect(malformed.issues.some((issue) => issue.includes("malformed"))).toBe(true);

      const sentinel = "EXISTING_ITERATOR_SENTINEL";
      function* throwingIterable(): Generator<string> {
        yield "page";
        throw throwingMessage(sentinel);
      }
      const throwing = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: throwingIterable(),
          mintId: () => "unused",
        },
      );
      expectNoOp(throwing);
      expect(throwing.issues.join("\n")).toContain("unknown error");
      expect(throwing.issues.join("\n")).not.toContain(sentinel);
      expect(containsControlCharacter(throwing.issues.join("\n"))).toBe(false);
    });

    it("shares one 4096-attempt mint budget and fails atomically", () => {
      let boundaryCalls = 0;
      const boundary = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => {
            boundaryCalls += 1;
            return boundaryCalls === 4096 ? "fresh-text" : "page";
          },
        },
      );
      expect(boundary.root).toBe("fresh-text");
      expect(boundaryCalls).toBe(4096);

      let overCalls = 0;
      const over = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => {
            overCalls += 1;
            return "page";
          },
        },
      );
      expectNoOp(over);
      expect(overCalls).toBe(4096);
      expect(over.issues.some((issue) => issue.includes("4096") && issue.includes("cap"))).toBe(
        true,
      );
    });

    it("hides hostile caught details and leaves no partial allocation", () => {
      const sentinel = "HOSTILE_MESSAGE_GETTER_SENTINEL";
      const hostile = throwingMessage(sentinel);
      const existing = new Set(["page"]);
      const before = [...existing];
      let mintCalls = 0;
      const partial = expandComposition(
        {
          name: "two-nodes",
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["child"] },
            child: { id: "child", type: "text", value: "child" },
          },
        },
        {},
        { parent: "page" },
        {
          existingIds: existing,
          mintId: () => {
            mintCalls += 1;
            if (mintCalls === 1) return "fresh-root";
            throw hostile;
          },
        },
      );
      expectNoOp(partial);
      expect(mintCalls).toBe(2);
      expect([...existing]).toEqual(before);
      expect(partial.issues.join("\n")).toContain("unknown error");
      expect(partial.issues.join("\n")).not.toContain(sentinel);
      expect(containsControlCharacter(partial.issues.join("\n"))).toBe(false);

      const hostileAt = Object.create(null) as object;
      Object.defineProperty(hostileAt, "parent", {
        get() {
          throw hostile;
        },
      });
      const outer = expandComposition(textComposition(), {}, hostileAt as { parent: string }, {
        existingIds: existing,
        mintId: () => "unused",
      });
      expectNoOp(outer);
      expect(outer.issues.join("\n")).toContain("unknown error");
      expect(outer.issues.join("\n")).not.toContain(sentinel);

      const validAfterFailure = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: existing,
          mintId: () => "fresh-after-failure",
        },
      );
      expect(validAfterFailure.root).toBe("fresh-after-failure");
      expect([...existing]).toEqual(before);
    });

    it("removes controls before capping caught detail and bounds issue arrays", () => {
      const rawDetail = `${"A".repeat(200)}\u0000\u001b\u007f\u0085\u009b${"B".repeat(100)}`;
      const controlled = expandComposition(
        textComposition(),
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => {
            throw rawDetail;
          },
        },
      );
      expectNoOp(controlled);
      const issue = controlled.issues.find((item) =>
        item.startsWith("composition expansion mintId"),
      );
      expect(issue).toBeDefined();
      const detail = issue?.slice("composition expansion mintId failed: ".length) ?? "";
      expect(detail).toHaveLength(256);
      expect(containsControlCharacter(detail)).toBe(false);
      expect(detail).toBe(`${"A".repeat(200)}${"B".repeat(56)}`);

      const children = Array.from({ length: 70 }, (_, index) => `slot-${String(index)}`);
      const nodes: Record<string, unknown> = {
        root: { id: "root", type: "box", children },
      };
      const params: Record<string, unknown> = {};
      for (let index = 0; index < children.length; index += 1) {
        const id = children[index];
        if (id === undefined) continue;
        nodes[id] = { id, type: "text", value: `{{p${String(index)}}}` };
        params[`p${String(index)}`] = index;
      }
      let mintIndex = 0;
      const issueFlood = expandComposition(
        { name: "issue-flood", root: "root", nodes },
        params,
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: () => `issue-node-${String((mintIndex += 1))}`,
        },
      );
      expect(issueFlood.root).toBeDefined();
      expect(issueFlood.issues).toHaveLength(MAX_ISSUES + 1);
      expect(issueFlood.issues.at(-1)).toBe(ISSUES_SUPPRESSED);
    });
  });

  it("fills params and defaults, remaps every node id, and returns slot ids", () => {
    const result = expandComposition(
      {
        name: "card",
        slots: { title: "Default title", body: "Default body" },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["title", "body"] },
          title: { id: "title", type: "text", value: "{{title}}" },
          body: { id: "body", type: "text", value: "{{body}}" },
        },
      },
      { title: "Custom title" },
      { parent: "root" },
      {
        existingIds: new Set(["root"]),
        mintId: mintFrom(["fresh-card", "fresh-title", "fresh-body"]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-card");
    expect(result.ids).toEqual({
      card: "fresh-card",
      title: "fresh-title",
      body: "fresh-body",
    });
    expect(result.slots).toEqual({ title: "fresh-title", body: "fresh-body" });
    expect(result.nodes["fresh-card"]).toMatchObject({
      id: "fresh-card",
      type: "box",
      children: ["fresh-title", "fresh-body"],
    });
    expect(result.nodes["fresh-title"]).toMatchObject({ value: "Custom title" });
    expect(result.nodes["fresh-body"]).toMatchObject({ value: "Default body" });
  });

  it("keeps repeated expansions disjoint from existing ids and from each other", () => {
    const known = new Set(["root", "fresh-card"]);
    const composition = {
      name: "hero",
      root: "hero",
      nodes: {
        hero: { id: "hero", type: "box", children: ["title"] },
        title: { id: "title", type: "text", value: "Hello" },
      },
    };

    const first = expandComposition(
      composition,
      {},
      { parent: "root" },
      {
        existingIds: known,
        mintId: mintFrom(["root", "fresh-card", "hero-1", "title-1"]),
      },
    );
    for (const id of Object.values(first.ids)) known.add(id);
    const second = expandComposition(
      composition,
      {},
      { parent: "root" },
      {
        existingIds: known,
        mintId: mintFrom(["hero-1", "title-1", "hero-2", "title-2"]),
      },
    );

    expect(Object.values(first.ids)).toEqual(["hero-1", "title-1"]);
    expect(Object.values(second.ids)).toEqual(["hero-2", "title-2"]);
    expect(new Set([...Object.values(first.ids), ...Object.values(second.ids)]).size).toBe(4);
  });

  it("sanitizes bad params, validates filled output, and never emits invalid bricks", () => {
    const result = expandComposition(
      {
        name: "media_card",
        slots: {
          image: "https://example.com/default.png",
          alt: "fallback",
          title: "Fallback",
        },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["image", "title"] },
          image: { id: "image", type: "media", src: "{{image}}", alt: "{{alt}}" },
          title: { id: "title", type: "text", value: "{{title}}" },
        },
      },
      {
        image: "javascript:alert(1)",
        alt: 42,
        title: "t".repeat(MAX_FIELD_VALUE_CHARS + 5),
      },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["card-1", "title-1"]) },
    );

    expect(result.root).toBe("card-1");
    expect(
      Object.values(result.nodes).every((node) =>
        ["box", "text", "media", "input"].includes(node.type),
      ),
    ).toBe(true);
    expect(Object.values(result.nodes).some((node) => node.type === "media")).toBe(false);
    expect(result.nodes["title-1"]).toMatchObject({
      type: "text",
      value: "t".repeat(MAX_FIELD_VALUE_CHARS),
    });
    expect(
      result.issues.some((issue) => issue.includes("param") && issue.includes("not a string")),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.includes("truncated"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("unsafe media src"))).toBe(true);
  });

  it("fills media poster slots after validating the marker", () => {
    const result = expandComposition(
      {
        name: "video",
        slots: { poster: "https://example.com/default.jpg" },
        root: "video",
        nodes: {
          video: {
            id: "video",
            type: "media",
            kind: "video",
            src: "https://example.com/movie.mp4",
            poster: "{{poster}}",
          },
        },
      },
      { poster: "https://example.com/custom.jpg" },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-video"]) },
    );

    expect(result.root).toBe("fresh-video");
    expect(result.slots).toEqual({ poster: "fresh-video" });
    expect(result.nodes["fresh-video"]).toMatchObject({
      type: "media",
      poster: "https://example.com/custom.jpg",
    });
  });

  it("drops unreachable composition nodes before remapping or emitting", () => {
    const result = expandComposition(
      {
        name: "clean",
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["visible"] },
          visible: { id: "visible", type: "text", value: "Visible" },
          orphan: { id: "orphan", type: "box", children: ["orphan-child"] },
          "orphan-child": { id: "orphan-child", type: "text", value: "Hidden" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-root", "fresh-visible"]) },
    );

    expect(result.root).toBe("fresh-root");
    expect(Object.keys(result.nodes).sort()).toEqual(["fresh-root", "fresh-visible"]);
    expect(result.ids).toEqual({ root: "fresh-root", visible: "fresh-visible" });
    expect(result.issues.some((issue) => issue.includes("unreachable"))).toBe(true);
  });

  it("remaps component section and card child refs while preserving metadata", () => {
    const result = expandComposition(
      {
        name: "dashboard-summary",
        description: "Dashboard summary",
        metadata: {
          category: "dashboard",
          variants: ["compact"],
          preferredParent: "section",
        },
        slots: { title: "Revenue" },
        root: "section",
        nodes: {
          section: {
            id: "section",
            type: "section",
            title: "{{title}}",
            children: ["card", "panel"],
          },
          card: {
            id: "card",
            type: "card",
            title: "MRR",
            children: ["stat"],
            onPress: { kind: "toggle", target: "panel" },
          },
          stat: { id: "stat", type: "stat", label: "MRR", value: "$42k" },
          panel: { id: "panel", type: "box", children: [] },
        },
      },
      { title: "Revenue now" },
      { parent: "root" },
      {
        existingIds: new Set(["root"]),
        mintId: mintFrom(["fresh-section", "fresh-card", "fresh-stat", "fresh-panel"]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-section");
    expect(result.slots).toEqual({ title: "fresh-section" });
    expect(result.nodes["fresh-section"]).toMatchObject({
      id: "fresh-section",
      type: "section",
      title: "Revenue now",
      children: ["fresh-card", "fresh-panel"],
    });
    expect(result.nodes["fresh-card"]).toMatchObject({
      id: "fresh-card",
      type: "card",
      children: ["fresh-stat"],
      onPress: { kind: "toggle", target: "fresh-panel" },
    });
  });

  it("fills every component string surface and remaps component actions", () => {
    const result = expandComposition(
      {
        name: "component-slots",
        slots: {
          title: "Default title",
          submit: "Submit",
          navLabel: "Overview",
          navTo: "overview",
          metricLabel: "Revenue",
          metricValue: "$42k",
          metricDelta: "+8%",
          key: "mrr",
          keyLabel: "MRR",
          keyValue: "$42k",
          searchName: "query",
          searchLabel: "Search",
          searchPlaceholder: "Find",
          filterName: "status",
          filterLabel: "Status",
          filterOption: "Active",
          filterValue: "Active",
          emptyTitle: "Nothing here",
          emptyBody: "Try again",
          emptyAction: "Refresh",
          loadingLabel: "Loading",
        },
        root: "form",
        nodes: {
          form: {
            id: "form",
            type: "form",
            title: "{{title}}",
            submitLabel: "{{submit}}",
            children: ["nav", "metric", "kv", "search", "filters", "empty", "loading"],
            onSubmit: { kind: "agent", name: "submit", collect: "metric" },
          },
          nav: {
            id: "nav",
            type: "nav",
            items: [{ label: "{{navLabel}}", to: "{{navTo}}" }],
          },
          metric: {
            id: "metric",
            type: "metric",
            label: "{{metricLabel}}",
            value: "{{metricValue}}",
            delta: "{{metricDelta}}",
          },
          kv: {
            id: "kv",
            type: "keyValue",
            items: [{ key: "{{key}}", label: "{{keyLabel}}", value: "{{keyValue}}" }],
          },
          search: {
            id: "search",
            type: "input",
            name: "{{searchName}}",
            input: "search",
            label: "{{searchLabel}}",
            placeholder: "{{searchPlaceholder}}",
          },
          filters: {
            id: "filters",
            type: "filterBar",
            filters: [
              {
                name: "{{filterName}}",
                label: "{{filterLabel}}",
                options: ["{{filterOption}}"],
                value: "{{filterValue}}",
              },
            ],
            onChange: { kind: "agent", name: "filter", collect: "metric" },
          },
          empty: {
            id: "empty",
            type: "emptyState",
            title: "{{emptyTitle}}",
            body: "{{emptyBody}}",
            actionLabel: "{{emptyAction}}",
            onPress: { kind: "agent", name: "refresh", collect: "page" },
          },
          loading: { id: "loading", type: "loading", label: "{{loadingLabel}}" },
        },
      },
      { title: "Custom title", metricValue: "$50k" },
      { parent: "page" },
      {
        existingIds: new Set(["page"]),
        mintId: mintFrom([
          "fresh-form",
          "fresh-nav",
          "fresh-metric",
          "fresh-kv",
          "fresh-search",
          "fresh-filters",
          "fresh-empty",
          "fresh-loading",
        ]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.nodes["fresh-form"]).toMatchObject({
      type: "form",
      title: "Custom title",
      submitLabel: "Submit",
      children: [
        "fresh-nav",
        "fresh-metric",
        "fresh-kv",
        "fresh-search",
        "fresh-filters",
        "fresh-empty",
        "fresh-loading",
      ],
      onSubmit: { kind: "agent", name: "submit", collect: "fresh-metric" },
    });
    expect(result.nodes["fresh-nav"]).toMatchObject({
      items: [{ label: "Overview", to: "overview" }],
    });
    expect(result.nodes["fresh-metric"]).toMatchObject({
      label: "Revenue",
      value: "$50k",
      delta: "+8%",
    });
    expect(result.nodes["fresh-kv"]).toMatchObject({
      items: [{ key: "mrr", label: "MRR", value: "$42k" }],
    });
    expect(result.nodes["fresh-search"]).toMatchObject({
      type: "input",
      name: "query",
      input: "search",
      label: "Search",
      placeholder: "Find",
    });
    expect(result.nodes["fresh-filters"]).toMatchObject({
      filters: [{ name: "status", label: "Status", options: ["Active"], value: "Active" }],
      onChange: { kind: "agent", name: "filter", collect: "fresh-metric" },
    });
    expect(result.nodes["fresh-empty"]).toMatchObject({
      title: "Nothing here",
      body: "Try again",
      actionLabel: "Refresh",
      onPress: { kind: "agent", name: "refresh" },
    });
    expect(result.nodes["fresh-empty"]).not.toHaveProperty("onPress.collect");
    expect(result.nodes["fresh-loading"]).toMatchObject({ label: "Loading" });
    expect(result.slots).toMatchObject({
      title: "fresh-form",
      navLabel: "fresh-nav",
      metricValue: "fresh-metric",
      keyValue: "fresh-kv",
      searchName: "fresh-search",
      filterValue: "fresh-filters",
      emptyAction: "fresh-empty",
      loadingLabel: "fresh-loading",
    });
  });

  it("fills tabs item labels/targets, keeps nav targets literal, and remaps a targeting action", () => {
    const result = expandComposition(
      {
        name: "tabbed-shell",
        slots: { firstLabel: "Overview", firstTo: "overview" },
        root: "shell",
        nodes: {
          shell: {
            id: "shell",
            type: "box",
            children: ["tabs"],
            onPress: { kind: "toggle", target: "tabs" },
          },
          tabs: {
            id: "tabs",
            type: "tabs",
            variant: "underline",
            items: [
              { label: "{{firstLabel}}", to: "{{firstTo}}" },
              { label: "Reports", to: "tabs" },
            ],
          },
        },
      },
      { firstLabel: "Home" },
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-shell", "fresh-tabs"]) },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-shell");
    expect(result.ids).toEqual({ shell: "fresh-shell", tabs: "fresh-tabs" });
    // Both slot names live only on the tabs node (one in a label, one in a `to`).
    expect(result.slots).toEqual({ firstLabel: "fresh-tabs", firstTo: "fresh-tabs" });
    // The set param fills the label; the unset {{firstTo}} falls back to its slot default,
    // and the second item's `to: "tabs"` — colliding with a composition id — stays verbatim
    // because a tab target is a navigation string, not a remapped node reference.
    expect(result.nodes["fresh-tabs"]).toEqual({
      id: "fresh-tabs",
      type: "tabs",
      variant: "underline",
      items: [
        { label: "Home", to: "overview" },
        { label: "Reports", to: "tabs" },
      ],
    });
    // A box action that targets the tabs node IS remapped to the tabs node's fresh id.
    expect(result.nodes["fresh-shell"]).toMatchObject({
      children: ["fresh-tabs"],
      onPress: { kind: "toggle", target: "fresh-tabs" },
    });
  });

  it("fills card title/body slots, preserves tone and variant, and remaps a targeting action", () => {
    const result = expandComposition(
      {
        name: "notice",
        slots: { heading: "Heads up", detail: "Something happened" },
        root: "wrap",
        nodes: {
          wrap: {
            id: "wrap",
            type: "box",
            children: ["notice"],
            onPress: { kind: "toggle", target: "notice" },
          },
          notice: {
            id: "notice",
            type: "card",
            title: "{{heading}}",
            body: "{{detail}}",
            tone: "warning",
            variant: "outline",
            children: [],
          },
        },
      },
      { detail: "Disk almost full" },
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-wrap", "fresh-notice"]) },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.root).toBe("fresh-wrap");
    expect(result.ids).toEqual({ wrap: "fresh-wrap", notice: "fresh-notice" });
    expect(result.slots).toEqual({ heading: "fresh-notice", detail: "fresh-notice" });
    // toEqual (not toMatchObject) pins the exact shape: body from the param, title from the
    // slot default, tone/variant preserved untouched, and no spurious fields introduced.
    expect(result.nodes["fresh-notice"]).toEqual({
      id: "fresh-notice",
      type: "card",
      body: "Disk almost full",
      title: "Heads up",
      tone: "warning",
      variant: "outline",
      children: [],
    });
    expect(result.nodes["fresh-wrap"]).toMatchObject({
      children: ["fresh-notice"],
      onPress: { kind: "toggle", target: "fresh-notice" },
    });
  });

  it("fills a leaf value slot and passes a bare leaf through with only an id remap", () => {
    const result = expandComposition(
      {
        name: "sectioned",
        slots: { sep: "Details" },
        root: "wrap",
        nodes: {
          wrap: { id: "wrap", type: "box", children: ["labeled", "bare"] },
          labeled: { id: "labeled", type: "text", value: "{{sep}}", variant: "inset" },
          bare: { id: "bare", type: "loading" },
        },
      },
      { sep: "More" },
      { parent: "page" },
      {
        existingIds: new Set(["page"]),
        mintId: mintFrom(["fresh-wrap", "fresh-labeled", "fresh-bare"]),
      },
    );

    expect(result.issues).toHaveLength(0);
    expect(result.ids).toEqual({
      wrap: "fresh-wrap",
      labeled: "fresh-labeled",
      bare: "fresh-bare",
    });
    // Only the value-bearing leaf contributes a slot; the bare leaf adds none.
    expect(result.slots).toEqual({ sep: "fresh-labeled" });
    expect(result.nodes["fresh-labeled"]).toEqual({
      id: "fresh-labeled",
      type: "text",
      value: "More",
      variant: "inset",
      // Post-fill validateComposition normalizes a text node's style to an object.
      style: {},
    });
    // A leaf with no slot-bearing fields passes through intact: fresh id only, no value
    // materialized and no other fields invented.
    expect(result.nodes["fresh-bare"]).toEqual({ id: "fresh-bare", type: "loading" });
  });

  it("bounds untrusted node ids echoed in expansion issues", () => {
    const longId = "x".repeat(80);
    const unreachable = expandComposition(
      {
        name: "clean",
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: [] },
          [longId]: { id: longId, type: "text", value: "Hidden" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: mintFrom(["fresh-root"]) },
    );
    const mintFailed = expandComposition(
      {
        name: "clean",
        root: longId,
        nodes: {
          [longId]: { id: longId, type: "text", value: "Visible" },
        },
      },
      {},
      { parent: "page" },
      { existingIds: new Set(["page"]), mintId: () => "page" },
    );

    expect(unreachable.issues.join("\n")).toContain("<key too long>");
    expect(unreachable.issues.join("\n")).not.toContain(longId);
    expect(mintFailed.issues.join("\n")).toContain("<key too long>");
    expect(mintFailed.issues.join("\n")).not.toContain(longId);
  });

  it("uses validateComposition's exported slot marker rule", () => {
    expect(SLOT_MARKER_RE.exec("{{title}}")?.[1]).toBe("title");
    expect(SLOT_MARKER_RE.test("{{bad space}}")).toBe(false);
  });

  it("treats a marker-echoing param as missing and substitutes the slot default", () => {
    const result = expandComposition(
      {
        name: "echo",
        slots: { title: "Safe default" },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["title"] },
          title: { id: "title", type: "text", value: "{{title}}" },
        },
      },
      { title: "{{title}}" },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-card", "fresh-title"]) },
    );

    expect(result.root).toBe("fresh-card");
    expect(result.nodes["fresh-title"]).toMatchObject({ value: "Safe default" });
    expect(result.issues).toContain(
      'composition param "title" echoed the slot marker; using default',
    );
  });

  it("refuses expansion when a slot marker survives fill instead of shipping a doomed node", () => {
    // A marker-shaped slot DEFAULT keeps the marker alive through fill; the
    // shared fold would drop the node, so the expansion must fail atomically.
    const result = expandComposition(
      {
        name: "survivor",
        slots: { img: "{{img}}" },
        root: "card",
        nodes: {
          card: { id: "card", type: "box", children: ["pic"] },
          pic: { id: "pic", type: "media", kind: "image", src: "{{img}}" },
        },
      },
      { img: "{{img}}" },
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-card", "fresh-pic"]) },
    );

    expectNoOp(result);
    expect(result.issues).toContain('composition slot "img" was not filled; expansion refused');
  });

  it("fills prototype-member slot names as empty strings when no slots are declared", () => {
    // With no `slots` record the defaults map must not resolve inherited
    // Object.prototype members — {{constructor}} fills "" like any unknown slot.
    const result = expandComposition(
      {
        name: "proto",
        root: "wrap",
        nodes: {
          wrap: { id: "wrap", type: "box", children: ["t"] },
          t: { id: "t", type: "text", value: "{{constructor}}" },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-wrap", "fresh-t"]) },
    );

    expect(result.root).toBe("fresh-wrap");
    expect(result.nodes["fresh-t"]).toMatchObject({ value: "" });
    expect(result.issues).toHaveLength(0);
  });

  it("fills slot markers inside action strings and reports their slot source", () => {
    const result = expandComposition(
      {
        name: "nav-slot",
        slots: { url: "overview" },
        root: "cta",
        nodes: {
          cta: {
            id: "cta",
            type: "button",
            label: "Go",
            onPress: { kind: "navigate", to: "{{url}}" },
          },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-cta"]) },
    );

    expect(result.root).toBe("fresh-cta");
    expect(result.nodes["fresh-cta"]).toMatchObject({
      onPress: { kind: "navigate", to: "overview" },
    });
    expect(result.slots).toEqual({ url: "fresh-cta" });
    expect(result.issues).toHaveLength(0);
  });

  it("refuses expansion when a marker survives in a non-fillable action reference", () => {
    // toggle.target is a node-id reference, never param-filled — a marker there
    // must refuse the expansion instead of shipping a broken interaction.
    const result = expandComposition(
      {
        name: "toggle-slot",
        root: "cta",
        nodes: {
          cta: {
            id: "cta",
            type: "button",
            label: "Go",
            onPress: { kind: "toggle", target: "{{x}}" },
          },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-cta"]) },
    );

    expectNoOp(result);
    expect(result.issues).toContain('composition slot "x" was not filled; expansion refused');
  });

  it("drops actions that target nodes outside the composed subtree", () => {
    const result = expandComposition(
      {
        name: "button",
        root: "button",
        nodes: {
          button: {
            id: "button",
            type: "box",
            children: [],
            onPress: { kind: "toggle", target: "root" },
            onHold: { kind: "agent", name: "submit", collect: "root" },
          },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-button"]) },
    );

    expect(result.root).toBe("fresh-button");
    expect(result.nodes["fresh-button"]).toEqual({
      id: "fresh-button",
      type: "box",
      style: {},
      children: [],
      onHold: { kind: "agent", name: "submit" },
    });
  });

  it("never splices prototype-inherited values into action targets or collect refs", () => {
    // "constructor"/"toString" are not composition node ids, so the remap table
    // must treat them as unknown — an inherited Object.prototype value must
    // never become an action target.
    const result = expandComposition(
      {
        name: "proto-action",
        root: "wrap",
        nodes: {
          wrap: { id: "wrap", type: "box", children: ["go"] },
          go: {
            id: "go",
            type: "button",
            label: "Go",
            onPress: { kind: "toggle", target: "constructor" },
            onHold: { kind: "agent", name: "submit", collect: "toString" },
          },
        },
      },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["fresh-wrap", "fresh-go"]) },
    );

    expect(result.root).toBe("fresh-wrap");
    const button = result.nodes["fresh-go"];
    expect(button).toMatchObject({ type: "button", onHold: { kind: "agent", name: "submit" } });
    expect(button).not.toHaveProperty("onPress");
    expect((button as { onHold?: { collect?: unknown } }).onHold?.collect).toBeUndefined();
    for (const node of Object.values(result.nodes)) {
      expect(JSON.stringify(node)).toBe(JSON.stringify(JSON.parse(JSON.stringify(node))));
    }
  });

  it("returns a no-op result for malformed input or an unknown parent", () => {
    const malformed = expandComposition(
      { name: "bad", root: "missing", nodes: { x: { id: "x", type: "text", value: "x" } } },
      {},
      { parent: "root" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["x"]) },
    );
    const unknownParent = expandComposition(
      {
        name: "ok",
        root: "t",
        nodes: { t: { id: "t", type: "text", value: "x" } },
      },
      {},
      { parent: "ghost" },
      { existingIds: new Set(["root"]), mintId: mintFrom(["t-1"]) },
    );

    expect(malformed.root).toBeUndefined();
    expect(malformed.nodes).toEqual({});
    expect(malformed.issues.length).toBeGreaterThan(0);
    expect(unknownParent.root).toBeUndefined();
    expect(unknownParent.nodes).toEqual({});
    expect(unknownParent.issues.some((issue) => issue.includes("parent"))).toBe(true);
  });

  describe("nested composition", () => {
    // A reusable single-node child composition whose slot fills a text primitive,
    // so a reference to it splices that text primitive directly into the parent.
    const badge = {
      name: "badge",
      slots: { label: "Default label" },
      root: "text",
      nodes: {
        text: { id: "text", type: "text", value: "{{label}}" },
      },
    };

    const counterMint = () => {
      let index = 0;
      return () => `fresh-${String((index += 1))}`;
    };

    const childrenOf = (result: ReturnType<typeof expandComposition>): readonly string[] => {
      const root = result.nodes[result.root ?? ""] as { children?: string[] } | undefined;
      return root?.children ?? [];
    };

    const noReferenceSurvives = (result: ReturnType<typeof expandComposition>): boolean =>
      Object.values(result.nodes).every((node) => "type" in node && !("use" in node));

    it("resolves a reference to the target's primitives with the slot filled inline", () => {
      const result = expandComposition(
        {
          name: "outer",
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["ref"] },
            ref: { use: "badge", slots: { label: "Hi" } },
          },
        },
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: counterMint(),
          compositions: asRegistry([badge]),
        },
      );

      expect(result.issues).toHaveLength(0);
      expect(noReferenceSurvives(result)).toBe(true);
      expect(result.nodes[result.root ?? ""]).toMatchObject({ type: "box" });
      const kids = childrenOf(result);
      expect(kids).toHaveLength(1);
      // The reference position now holds the child composition's expanded text
      // primitive, with the reference's slot value filled in.
      expect(result.nodes[kids[0] ?? ""]).toMatchObject({ type: "text", value: "Hi" });
    });

    it("threads an outer marker through a reference slot before the child expands", () => {
      const result = expandComposition(
        {
          name: "outer",
          slots: { status: "Ready" },
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["ref"] },
            ref: { use: "badge", slots: { label: "{{status}}" } },
          },
        },
        { status: "Live" },
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: counterMint(),
          compositions: asRegistry([badge]),
        },
      );

      expect(noReferenceSurvives(result)).toBe(true);
      const texts = Object.values(result.nodes)
        .filter((node) => node.type === "text")
        .map((node) => (node as { value: string }).value);
      // {{status}} in the reference slot resolved against the OUTER param first.
      expect(texts).toContain("Live");
    });

    it("drops an unresolvable reference and never throws", () => {
      const result = expandComposition(
        {
          name: "outer",
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["ref"] },
            ref: { use: "ghost", slots: {} },
          },
        },
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: counterMint(),
          compositions: asRegistry([badge]),
        },
      );

      expect(result.root).toBeDefined();
      expect(noReferenceSurvives(result)).toBe(true);
      // The dropped reference leaves the container with no dangling child pointer.
      expect(childrenOf(result)).toEqual([]);
      expect(result.issues.some((issue) => issue.includes("ghost"))).toBe(true);
    });

    it("drops a reference when no registry is supplied and never throws", () => {
      const result = expandComposition(
        {
          name: "outer",
          root: "root",
          nodes: {
            root: { id: "root", type: "box", children: ["ref"] },
            ref: { use: "badge", slots: { label: "Hi" } },
          },
        },
        {},
        { parent: "page" },
        { existingIds: new Set(["page"]), mintId: counterMint() },
      );

      expect(result.root).toBeDefined();
      expect(noReferenceSurvives(result)).toBe(true);
      expect(childrenOf(result)).toEqual([]);
    });

    it("terminates a self-referential cycle with a bounded issue, never throwing", () => {
      const loop = {
        name: "loop",
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["ref"] },
          ref: { use: "loop", slots: {} },
        },
      };
      const result = expandComposition(
        loop,
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: counterMint(),
          compositions: asRegistry([loop]),
        },
      );

      expect(noReferenceSurvives(result)).toBe(true);
      expect(result.issues.some((issue) => issue.includes("cycle"))).toBe(true);
    });

    it("terminates a deep reference chain at the nesting cap without throwing", () => {
      // A 12-deep chain c0 -> c1 -> ... exceeds MAX_COMPOSITION_NEST_DEPTH (8).
      const chain = Array.from({ length: 12 }, (_, i) => ({
        name: `c${String(i)}`,
        root: "root",
        nodes: {
          root: { id: "root", type: "box", children: ["ref"] },
          ref: { use: `c${String(i + 1)}`, slots: {} },
        },
      }));
      const result = expandComposition(
        chain[0],
        {},
        { parent: "page" },
        {
          existingIds: new Set(["page"]),
          mintId: counterMint(),
          compositions: asRegistry(chain),
        },
      );

      expect(noReferenceSurvives(result)).toBe(true);
      expect(
        result.issues.some((issue) => issue.includes("nesting") || issue.includes("cycle")),
      ).toBe(true);
    });
  });
});
