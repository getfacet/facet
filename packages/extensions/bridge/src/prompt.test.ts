import { describe, expect, it } from "vitest";
import { STAGE_SPEC, type ClientEvent, type FacetTree } from "@facet/core";
import { PERSISTENT_SYSTEM_PROMPT, buildPersistentTurnPrompt, buildSpawnPrompt } from "./prompt.js";

const STAGE: FacetTree = {
  root: "root",
  nodes: {
    root: { id: "root", type: "box", children: [] },
  },
};

describe("bridge prompts", () => {
  it("preserves the spawn visit prompt", () => {
    const event: ClientEvent = { kind: "visit", visitor: { visitorId: "visitor" } };

    expect(buildSpawnPrompt(event, STAGE))
      .toBe(`You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet screens '<map-json>' <entry>   facet theme <name>   facet say <text>

${STAGE_SPEC}

Run facet commands now; do not print anything else.

A visitor just arrived. Render a short welcome page with \`facet render\`.`);
  });

  it("preserves the spawn message and action prompts", () => {
    const current = `The page THIS visitor currently sees (a Facet stage tree): ${JSON.stringify(STAGE)}`;

    expect(buildSpawnPrompt({ kind: "message", text: "hello" }, STAGE)).toBe(
      `${spawnSystem()}\n\n${current}\n\nThe visitor said: "hello". MODIFY the current page — prefer \`facet append\`/\`set\`/\`remove\` on existing node ids to change just what's needed (only \`facet render\` a fresh page if they ask for something totally new). Optionally \`facet say\` a short reply.`,
    );
    expect(buildSpawnPrompt({ kind: "tap", action: { name: "submit" } }, STAGE)).toBe(
      `${spawnSystem()}\n\n${current}\n\nThe visitor pressed "submit". React with facet commands on the current page.`,
    );
  });

  it("preserves the persistent system and turn prompts", () => {
    expect(PERSISTENT_SYSTEM_PROMPT)
      .toBe(`You own a live web page and update it as visitors interact. Use the facet tools to change the page:
- render(tree): replace the whole page with a stage tree
- append(parentId, node): add a node under a parent
- set(node): add or replace a node by id
- remove(id): delete a node
- theme(name): select a validated theme name
- say(text): send a short chat reply

${STAGE_SPEC}

On a fresh visit, render a page. On a message, prefer append/set/remove to change just what's needed; render a fresh page only for a totally new request. Keep pages polished and complete.`);

    expect(
      buildPersistentTurnPrompt({ kind: "visit", visitor: { visitorId: "visitor" } }, STAGE),
    ).toBe("A new visitor arrived. Render a welcoming page with the facet tools.");
    expect(buildPersistentTurnPrompt({ kind: "message", text: "hello" }, STAGE)).toBe(
      `The visitor's current page: ${JSON.stringify(STAGE)}\n\nThe visitor said: "hello". Update their page with the facet tools; optionally say() a short reply.`,
    );
    expect(buildPersistentTurnPrompt({ kind: "tap", action: { name: "submit" } }, STAGE)).toBe(
      `The visitor's current page: ${JSON.stringify(STAGE)}\n\nThe visitor pressed "submit". React by updating their page with the facet tools.`,
    );
  });

  it("shares the fail-safe unknown action name and preserves hostile getter throws", () => {
    const malformed = { kind: "tap" } as unknown as ClientEvent;
    expect(buildSpawnPrompt(malformed, STAGE)).toContain('The visitor pressed "(unknown)".');
    expect(buildPersistentTurnPrompt(malformed, STAGE)).toContain(
      'The visitor pressed "(unknown)".',
    );

    const hostile = { kind: "tap" } as unknown as ClientEvent;
    Object.defineProperty(hostile, "action", {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => buildSpawnPrompt(hostile, STAGE)).toThrow("boom");
    expect(() => buildPersistentTurnPrompt(hostile, STAGE)).toThrow("boom");
  });
});

function spawnSystem(): string {
  return `You control a live web page via the \`facet\` command. Change the page by running:
  facet render '<tree-json>'   facet append <parentId> '<node-json>'   facet set '<node-json>'   facet remove <id>   facet screens '<map-json>' <entry>   facet theme <name>   facet say <text>

${STAGE_SPEC}

Run facet commands now; do not print anything else.`;
}
