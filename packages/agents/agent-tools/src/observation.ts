import { deriveComponentContentClass, describeDataValue, serializeScreen } from "@facet/core";
import type {
  ComponentDocument,
  ComponentNode,
  FacetToolSession,
  SerializeIssue,
} from "@facet/core";

import type {
  CatalogIndex,
  CatalogIndexEntry,
  DataSummaryEntry,
  TurnObservation,
} from "./types.js";

const CONTENT_CLASSES = ["Leaf", "Container", "Structured"] as const;

function scalarText(prop: ComponentNode["props"][string] | undefined): string | null {
  return prop?.kind === "scalar" ? prop.value : null;
}

function screenNames(document: ComponentDocument): readonly string[] {
  const names: string[] = [];
  for (const id of document.screens) {
    const name = scalarText(document.nodes[id]?.props["name"]);
    if (name !== null) {
      names.push(name);
    }
  }
  return Object.freeze(names);
}

function issueText(issue: SerializeIssue): string {
  return issue.prop === undefined
    ? `${issue.reason}:${issue.at}`
    : `${issue.reason}:${issue.at}.${issue.prop}`;
}

function dataSummary(data: FacetToolSession["data"]): readonly DataSummaryEntry[] {
  return Object.freeze(
    Object.keys(data)
      .sort()
      .map((path) => describeDataValue(path, data[path], { count: "presence" })),
  );
}

function currentScreen(document: ComponentDocument | null): TurnObservation["currentScreen"] {
  if (document === null) {
    return null;
  }
  const serialized = serializeScreen(document, document.entry);
  return Object.freeze({
    name: document.entry,
    markup: serialized.text,
    issues: Object.freeze(serialized.issues.map(issueText)),
  });
}

export function buildTurnObservation(session: FacetToolSession): TurnObservation {
  const document = session.document;
  const screen = currentScreen(document);
  return Object.freeze({
    stageRevision: session.stageRevision,
    currentScreen: screen,
    screens: document === null ? Object.freeze([]) : screenNames(document),
    components: Object.freeze(
      session.catalog.components.map((spec) => {
        const entry: CatalogIndexEntry = {
          tag: spec.tag,
          whenToUse: spec.whenToUse,
          contentClass: deriveComponentContentClass(spec.content),
        };
        return Object.freeze(entry);
      }),
    ),
    data: dataSummary(session.data),
    issues: screen === null ? Object.freeze(["no_current_screen"]) : screen.issues,
  });
}

/** Formats the compact catalog index by the class derived from each content contract. */
export function formatCatalogIndex(components: CatalogIndex): string {
  if (components.length === 0) {
    return "- (none)";
  }

  const lines: string[] = [];
  for (const contentClass of CONTENT_CLASSES) {
    const entries = components.filter((component) => component.contentClass === contentClass);
    if (entries.length === 0) {
      continue;
    }
    lines.push(`${contentClass}:`);
    lines.push(...entries.map((component) => `- ${component.tag}: ${component.whenToUse}`));
  }
  return lines.join("\n");
}
