export const QUICKSTART_NAV_ITEMS = [
  { label: "What is Facet?", to: "what" },
  { label: "What can it build?", to: "build" },
  { label: "Design System", to: "system" },
  { label: "Try It Live", to: "try" },
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
  const items = QUICKSTART_NAV_ITEMS.map(
    (item) =>
      `<NavigationItem slot="items" label="${attr(item.label)}" action="nav:${attr(item.to)}" />`,
  ).join("\n      ");
  return `<Navigation label="Quickstart" orientation="horizontal">
      <Text slot="brand" value="Facet" variant="heading" />
      ${items}
    </Navigation>`;
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
