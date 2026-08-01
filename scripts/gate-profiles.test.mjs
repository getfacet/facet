import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FEATURE_HARD_GATE,
  LIVE_LINK_SURFACES,
  REFACTOR_HARD_GATE,
  VERIFY_COMMANDS,
} from "./gate-profiles.mjs";

function read(path) {
  return readFileSync(path, "utf8");
}

function orderedIndexes(text, values) {
  const indexes = [];
  let offset = 0;
  for (const value of values) {
    const index = text.indexOf(value, offset);
    assert.notEqual(index, -1, `missing ${value}`);
    indexes.push(index);
    offset = index + value.length;
  }
  return indexes;
}

function fencedBashCommands(text) {
  const match = text.match(/```bash\n(?<body>[\s\S]*?)\n```/u);
  assert.ok(match?.groups?.body, "missing bash command fence");
  return match.groups.body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test("package.json verify script follows the canonical command list", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.scripts.verify, VERIFY_COMMANDS.join(" && "));
});

test("verify skills list the canonical commands in exact order", () => {
  for (const path of [".agents/skills/verify/SKILL.md", ".claude/skills/verify/SKILL.md"]) {
    assert.deepEqual(fencedBashCommands(read(path)), VERIFY_COMMANDS, path);
  }
});

test("review rules cite the canonical verify commands in order", () => {
  orderedIndexes(read("docs/REVIEW-RULES.md"), VERIFY_COMMANDS);
});

test("review rules and agent guidance cite the canonical hard gates", () => {
  for (const path of ["AGENTS.md", "docs/REVIEW-RULES.md"]) {
    const text = read(path);
    orderedIndexes(text, FEATURE_HARD_GATE);
    orderedIndexes(text, REFACTOR_HARD_GATE);
  }
});

test("live-link surfaces include every refactor live-test trigger path", () => {
  assert.deepEqual(LIVE_LINK_SURFACES, [
    "packages/tools/quickstart",
    "packages/adapters/server",
    "packages/adapters/client",
    "packages/adapters/agent-client",
    "packages/core/runtime",
    "packages/renderers/react",
    "packages/core/core",
  ]);

  orderedIndexes(read("AGENTS.md"), LIVE_LINK_SURFACES);
});

test("implement and refactor skill summaries do not drift from gate profiles", () => {
  for (const path of [".agents/skills/implement/SKILL.md", ".claude/skills/implement/SKILL.md"]) {
    const text = read(path);
    assert.match(text, /canonical verify command list/u);
    assert.match(text, /package-layout/u);
    assert.match(text, /component-hard-cut/u);
    assert.match(text, /package-smoke\/gate-profile/u);
    assert.doesNotMatch(text, /typecheck \+ test \+ lint \+ format:check \+ build \+ source NUL/u);
  }

  for (const path of [
    ".agents/skills/refactor-audit/SKILL.md",
    ".claude/skills/refactor-audit/SKILL.md",
  ]) {
    const text = read(path);
    assert.doesNotMatch(text, /ChatDock/u);
    for (const surface of LIVE_LINK_SURFACES) {
      assert.match(text, new RegExp(surface.replaceAll("/", "\\/"), "u"), `${path}: ${surface}`);
    }
  }
});
