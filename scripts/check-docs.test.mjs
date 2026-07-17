import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("./check-docs.mjs", import.meta.url));

async function makeFixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "facet-docs-"));
  t.after(async () => rm(cwd, { force: true, recursive: true }));
  return cwd;
}

async function writeFixture(cwd, relativePath, contents) {
  const absolutePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function writeReactJsxFixture(cwd) {
  await writeFixture(
    cwd,
    "node_modules/react/package.json",
    JSON.stringify({
      name: "react",
      version: "1.0.0",
      exports: { "./jsx-runtime": { types: "./jsx-runtime.d.ts" } },
    }),
  );
  await writeFixture(
    cwd,
    "node_modules/react/jsx-runtime.d.ts",
    [
      "export namespace JSX {",
      "  interface Element {}",
      "  interface IntrinsicElements { div: Record<string, unknown>; }",
      "}",
      "",
    ].join("\n"),
  );
}

function runCheck(cwd, files = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...files], {
    cwd,
    encoding: "utf8",
  });
}

test("accepts repository-relative links, anchors, and canonical GitHub links", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "[Local guide](docs/GUIDE.md#details)",
      "[Canonical guide](https://github.com/getfacet/facet/blob/main/docs/GUIDE.md#details)",
      "[External guide](https://example.com/missing.md#no-check)",
      "",
    ].join("\n"),
  );
  await writeFixture(cwd, "docs/GUIDE.md", "# Guide\n\n## Details\n");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[docs\] PASS/);
  assert.match(result.stdout, /2 Markdown files/);
});

test("reports broken local paths and missing anchors with source locations", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    ["# Fixture", "", "[Missing file](docs/MISSING.md)", "[Missing anchor](#not-here)", ""].join(
      "\n",
    ),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:3:\d+ \[link\] target does not exist: docs\/MISSING\.md/);
  assert.match(result.stderr, /README\.md:4:\d+ \[anchor\] anchor does not exist: #not-here/);
});

test("maps broken canonical GitHub document links back to the repository", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    "# Fixture\n\n[Missing](https://github.com/getfacet/facet/blob/main/docs/MISSING.md)\n",
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:3:\d+ \[link\] target does not exist: docs\/MISSING\.md/);
});

test("typechecks only explicitly marked TypeScript and TSX fences", async (t) => {
  const cwd = await makeFixture(t);
  await writeReactJsxFixture(cwd);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "```ts",
      'const unchecked: number = "pseudocode";',
      "```",
      "",
      "```ts check-docs",
      "const checked: number = 1;",
      "```",
      "",
      "```tsx check-docs",
      "const element = <div>valid</div>;",
      "void element;",
      "```",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 checked snippets/);
});

test("resolves peer types installed inside a workspace package", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "```tsx check-docs",
      'import { useMemo } from "react";',
      "const value = useMemo(() => 1, []);",
      "void value;",
      "```",
      "",
    ].join("\n"),
  );
  await writeFixture(
    cwd,
    "packages/renderers/react/package.json",
    '{"name":"@fixture/react-renderer","private":true}',
  );
  await writeFixture(
    cwd,
    "packages/renderers/react/node_modules/@types/react/package.json",
    '{"name":"@types/react","version":"1.0.0","types":"index.d.ts"}',
  );
  await writeFixture(
    cwd,
    "packages/renderers/react/node_modules/@types/react/index.d.ts",
    "export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;\n",
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked snippet/);
});

test("reports TypeScript errors in opted-in snippets at Markdown lines", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "docs/code.md",
    ["# Code", "", "```ts check-docs", 'const count: number = "wrong";', "```", ""].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/code\.md:4:\d+ \[typescript TS2322\]/);
  assert.match(result.stderr, /Type 'string' is not assignable to type 'number'/);
});

test("excludes archived spec bodies but checks specs README", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n");
  await writeFixture(cwd, "specs/completed/old.md", "[Historical broken link](missing.md)\n");

  let result = runCheck(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 Markdown file,/);

  await writeFixture(cwd, "specs/README.md", "# Specs\n\n[Current broken link](missing.md)\n");
  result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /specs\/README\.md:3:\d+ \[link\]/);
  assert.doesNotMatch(result.stderr, /specs\/completed\/old\.md/);
});

test("supports checking an explicit scope without scanning other Markdown", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\n[Broken](missing.md)\n");
  await writeFixture(cwd, "docs/good.md", "# Good\n");

  const scoped = runCheck(cwd, ["--files", "docs/good.md"]);
  assert.equal(scoped.status, 0, scoped.stderr);
  assert.match(scoped.stdout, /1 Markdown file,/);

  const broken = runCheck(cwd, ["README.md"]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /README\.md:3:\d+ \[link\]/);
});

test("checks indented opt-in fences and rejects an unclosed opt-in fence", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "  ```ts check-docs",
      '  const count: number = "wrong";',
      "  ```",
      "",
      "```ts check-docs",
      "const unfinished: number = 1;",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[typescript TS2322\]/);
  assert.match(result.stderr, /\[fence\] opt-in code fence is not closed/);
});

test("does not provide a catch-all JSX intrinsic-element type", async (t) => {
  const cwd = await makeFixture(t);
  await writeReactJsxFixture(cwd);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "```tsx check-docs",
      "const element = <dib />;",
      "void element;",
      "```",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[typescript TS2339\]/);
});

test("rejects links that escape the repository lexically or through a symlink", async (t) => {
  const cwd = await makeFixture(t);
  const outsidePath = `${cwd}-outside.md`;
  t.after(async () => rm(outsidePath, { force: true }));
  await writeFile(outsidePath, "# Outside\n", "utf8");
  await symlink(outsidePath, path.join(cwd, "linked-outside.md"));
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      `[Parent](../${path.basename(outsidePath)})`,
      "[Symlink](linked-outside.md)",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:3:\d+ \[link\] target is outside the repository/);
  assert.match(result.stderr, /README\.md:4:\d+ \[link\] target resolves outside the repository/);
});

test("masks variable-length fenced and inline code without inventing links", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "``[inline code](missing-inline.md)``",
      "",
      "````markdown",
      "```ts",
      "```",
      "[fenced code](missing-fenced.md)",
      "````",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 checked links/);
});

test("accepts a balanced parenthesis in an inline link destination", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\n[Guide](docs/a_(b).md)\n");
  await writeFixture(cwd, "docs/a_(b).md", "# Guide\n");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked link/);
});

test("matches GitHub heading anchors that contain underscores", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\n[Section](#hello_world)\n\n## hello_world\n");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked link/);
});

test("uses the opening fence length while collecting heading anchors", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\n[Real section](docs/GUIDE.md#real)\n");
  await writeFixture(
    cwd,
    "docs/GUIDE.md",
    ["# Guide", "", "````markdown", "```ts", "```", "## hidden", "````", "", "## Real", ""].join(
      "\n",
    ),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked link/);
});

test("does not treat an unmatched closing label as an inline link", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\nfoo](missing.md)\n");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 checked links/);
});

test("honors CommonMark punctuation escapes in link destinations", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(cwd, "README.md", "# Fixture\n\n[Guide](docs/a\\_b.md)\n");
  await writeFixture(cwd, "docs/a_b.md", "# Guide\n");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked link/);
});

test("treats scheme-relative and arbitrary URI schemes as external", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "[Scheme relative](//example.com/page)",
      "[FTP](ftp://example.com/file.md)",
      "[App](app://open/page)",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 checked links/);
});

test("ignores links and definitions inside indented code blocks", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "    [not a link](missing-inline.md)",
      "    [not-a-definition]: missing-definition.md",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 checked links/);
});

test("uses rendered heading text, Setext headings, and GitHub slug collisions", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "[Emphasis](#hello)",
      "[Setext](#hello-world)",
      "[Collision](#foo-1-1)",
      "",
      "## _Hello_",
      "",
      "Hello world",
      "---",
      "",
      "## foo",
      "## foo",
      "## foo-1",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 checked links/);
});

test("typechecks a closed opt-in fence in a CRLF document", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    ["# Fixture", "", "```ts check-docs", "const count: number = 1;", "```", ""].join("\r\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 checked snippet/);
});

test("typechecks an opt-in fence after a UTF-8 BOM", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    '\uFEFF```ts check-docs\nconst count: number = "wrong";\n```\n',
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[typescript TS2322\]/);
});

test("typechecks opt-in fences nested in quotes and list items", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    [
      "# Fixture",
      "",
      "> ```ts check-docs",
      "> const quoted: number = 1;",
      "> ```",
      "",
      "- ```ts check-docs",
      '  const listed: number = "wrong";',
      "  ```",
      "",
    ].join("\n"),
  );

  const result = runCheck(cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[typescript TS2322\]/);
  assert.match(result.stderr, /2 checked snippets/);
});

test("uses reference-image alt text in GitHub heading anchors", async (t) => {
  const cwd = await makeFixture(t);
  await writeFixture(
    cwd,
    "README.md",
    ["# Fixture", "", "[Image section](#cat)", "", "## ![cat][img]", "", "[img]: cat.png", ""].join(
      "\n",
    ),
  );
  await writeFixture(cwd, "cat.png", "not-an-image");

  const result = runCheck(cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 checked links/);
});
