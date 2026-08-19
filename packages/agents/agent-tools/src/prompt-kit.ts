import { BOUNDS } from "@facet/core";

import { FACET_TOOL_NAMES } from "./specs.js";

const TOOL_ROSTER = FACET_TOOL_NAMES.join(", ");

export const FACET_PROMPT_KIT = [
  "Facet authoring is declarative component markup only: registered tags, quoted scalars, data:, nav:, or agent: references; never executable UI code.",
  "Before choosing components, identify the screen job and decide the spatial relationship and reading order. Use the minimum layout components, then fill that structure with what the task needs.",
  "Roles are discovery guidance only. A simple screen may contain components directly. Do not add layout wrappers that do not change arrangement.",
  "Choose visible tags first. When parallel calls are allowed, request all independent read_component_spec calls together in one tool-only response.",
  "Inside Screen roots, use only component tags present in the active catalog. For unknown contracts, call read_component_spec; use declared props and values only, and do not guess.",
  'A render_page markup value is one complete document. Minimal valid shape: `<Facet entry="main"><Screen name="main" /></Facet>`.',
  "That minimal shape demonstrates only the document envelope. Completed UI needs task-relevant visible components in every screen. Never submit empty or placeholder screens.",
  "Use exactly one Facet root with only entry. Its direct children are Screen roots with unique names; entry must equal one Screen name; let Facet generate every id.",
  `Markup source per mutation is bounded at ${BOUNDS.markupSourceChars} characters. Element depth is ${BOUNDS.elementDepth}; document nodes are bounded at ${BOUNDS.nodesPerDocument}.`,
  `Use exactly these tools: ${TOOL_ROSTER}.`,
  "render_page takes { markup }; only it creates the first page. Other mutations need an existing target id.",
  `read_data returns at most ${BOUNDS.readDataResult.items} array items and at most ${BOUNDS.readDataResult.chars} characters, whichever binds first; it clamps instead of failing for size.`,
  `publish_data accepts at most ${BOUNDS.publishDataPayloadChars} JSON characters. For a new binding, that descriptor is not visible markup or completion: publish once, then immediately mutate markup to bind it; never republish unchanged data. If current markup already binds that path, republishing updates UI without markup mutation.`,
  "Tool results are authoritative; mutation completes only on ok: true. On ok: false, use code, cause, and repair, keep the current authoring goal active, use bounded reads when needed, and retry corrected input. Do not switch to unrelated tools or claim success; never repeat unchanged invalid input.",
  "Conversation text is outside the tool roster.",
].join("\n");
