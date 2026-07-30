import { BOUNDS } from "@facet/core";

export const FACET_PROMPT_KIT = [
  "Facet authoring uses declarative component markup only. Emit registered component tags, scalar quoted props, explicit data:, nav:, and agent: references, and never executable UI code.",
  `Markup source per mutation is bounded at ${BOUNDS.markupSourceChars} characters. Element depth is ${BOUNDS.elementDepth}; document nodes are bounded at ${BOUNDS.nodesPerDocument}.`,
  "Use exactly these tools: render_page, insert_subtree, replace_subtree, update_node, remove_subtree, read_component_spec, read_screen, read_data, publish_data.",
  "render_page takes { markup }. It is the only tool that can create the first page. The other mutation tools require an existing target id.",
  `read_data returns at most ${BOUNDS.readDataResult.items} array items and at most ${BOUNDS.readDataResult.chars} characters, whichever binds first; it clamps instead of failing for size.`,
  `publish_data incoming authored payloads are bounded at ${BOUNDS.publishDataPayloadChars} characters and report only descriptors for accepted bulk data.`,
  "Conversation text is outside the tool roster. Final assistant prose is a turn result, not a tool call.",
].join("\n");
