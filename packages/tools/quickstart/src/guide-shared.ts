export const QUICKSTART_NAV_ITEMS = [
  { label: "What is Facet?", to: "what" },
  { label: "Runtime Loop", to: "structure" },
  { label: "Component Catalog", to: "system" },
  { label: "Use Cases", to: "usecases" },
] as const;

function attr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Builds one markup navigation row for the quickstart's four seeded screens. */
export function quickstartNavigationMarkup(): string {
  const buttons = QUICKSTART_NAV_ITEMS.map(
    (item) => `<Button label="${attr(item.label)}" action="nav:${attr(item.to)}" />`,
  ).join("\n      ");
  return `<Row gap="sm">
      ${buttons}
    </Row>`;
}

/** Builds a small explanatory card without reintroducing the retired seed model. */
export function quickstartCardMarkup(
  title: string,
  body: string,
  tone: "neutral" | "accent" | "success" | "warning" | "danger" = "neutral",
): string {
  return `<Card title="${attr(title)}" tone="${tone}">
      <Text value="${attr(body)}" />
    </Card>`;
}
