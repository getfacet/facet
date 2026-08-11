import { BOUNDS } from "@facet/core";

import { FACET_TOOL_NAMES } from "./specs.js";

const TOOL_ROSTER = FACET_TOOL_NAMES.join(", ");

export const FACET_PROMPT_KIT = [
  "Facet authoring uses declarative component markup only. Emit registered component tags, scalar quoted props, explicit data:, nav:, and agent: references, and never executable UI code.",
  "Inside Screen roots, use only component tags present in the active catalog. Before using a component whose contract is not already in context, call read_component_spec; use only its declared props and values, and do not guess.",
  "Choose the visible component set before discovery. When the host permits multiple tool calls, request all independent read_component_spec calls together in one tool-only response; do not spend one model turn per tag.",
  'A render_page markup value is one complete document. Minimal valid shape: `<Facet entry="main"><Screen name="main" /></Facet>`.',
  "That minimal shape demonstrates only the document envelope; it is not a completed user-facing page. Before rendering a requested UI, read the specs for the visible component tags you will use, then put task-relevant visible components inside every screen. Never submit empty or placeholder screens as completed UI.",
  "Use exactly one Facet root whose only prop is entry. Its direct children are Screen roots with unique name props; entry must equal one Screen name. Put registered components only inside screens and let Facet generate every id.",
  `Markup source per mutation is bounded at ${BOUNDS.markupSourceChars} characters. Element depth is ${BOUNDS.elementDepth}; document nodes are bounded at ${BOUNDS.nodesPerDocument}.`,
  `Use exactly these tools: ${TOOL_ROSTER}.`,
  "render_page takes { markup }. It is the only tool that can create the first page. The other mutation tools require an existing target id.",
  `read_data returns at most ${BOUNDS.readDataResult.items} array items and at most ${BOUNDS.readDataResult.chars} characters, whichever binds first; it clamps instead of failing for size.`,
  `publish_data accepts at most ${BOUNDS.publishDataPayloadChars} authored JSON characters and returns only a descriptor. It changes visible UI only at an already-bound exact path; otherwise author markup that binds the path before finishing.`,
  "Treat every tool result as authoritative. A mutation is complete only after ok: true. On ok: false, use its code and any cause and repair fields to fix one fault, then retry; never repeat unchanged invalid input or claim success.",
  "Conversation text is outside the tool roster. Final assistant prose is a turn result, not a tool call.",
].join("\n");
