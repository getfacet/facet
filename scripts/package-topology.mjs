const packageRows = [
  {
    name: "@facet/core",
    path: "packages/core/core",
    dependencies: [],
  },
  {
    name: "@facet/runtime",
    path: "packages/core/runtime",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/assets",
    path: "packages/core/assets",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/react",
    path: "packages/renderers/react",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/agent-tools",
    path: "packages/agents/agent-tools",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/agent",
    path: "packages/agents/agent",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/reference-agent",
    path: "packages/agents/reference-agent",
    dependencies: ["@facet/agent", "@facet/agent-tools", "@facet/core", "@facet/runtime"],
  },
  {
    name: "@facet/server",
    path: "packages/adapters/server",
    dependencies: ["@facet/core", "@facet/runtime"],
  },
  {
    name: "@facet/client",
    path: "packages/adapters/client",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/agent-client",
    path: "packages/adapters/agent-client",
    dependencies: ["@facet/core"],
  },
  {
    name: "@facet/quickstart",
    path: "packages/tools/quickstart",
    dependencies: [
      "@facet/agent",
      "@facet/assets",
      "@facet/core",
      "@facet/reference-agent",
      "@facet/runtime",
      "@facet/server",
    ],
  },
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function freezeRecord(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

function groupName(path) {
  return path.split("/")[1] ?? "";
}

function childName(path) {
  return path.split("/")[2] ?? "";
}

export const PUBLIC_PACKAGE_TOPOLOGY = Object.freeze(
  packageRows.map((row) =>
    Object.freeze({
      name: row.name,
      path: row.path,
      dependencies: Object.freeze([...row.dependencies]),
    }),
  ),
);

export const PACKAGE_ROLE_ROOTS = Object.freeze([
  "packages/core",
  "packages/renderers",
  "packages/agents",
  "packages/adapters",
  "packages/tools",
]);

export const EXPECTED_PACKAGES = freezeRecord(
  PUBLIC_PACKAGE_TOPOLOGY.map((row) => [row.name, row.path]),
);

export const EXPECTED_GROUPS = Object.freeze(
  sorted(new Set(PUBLIC_PACKAGE_TOPOLOGY.map((row) => groupName(row.path)))),
);

export const EXPECTED_GROUP_CHILDREN = freezeRecord(
  EXPECTED_GROUPS.map((group) => [
    group,
    Object.freeze(
      sorted(
        PUBLIC_PACKAGE_TOPOLOGY.filter((row) => groupName(row.path) === group).map((row) =>
          childName(row.path),
        ),
      ),
    ),
  ]),
);

export const EXPECTED_WORKSPACES = freezeRecord([
  ["facet", "."],
  ...Object.entries(EXPECTED_PACKAGES),
]);

export const EXPECTED_DEPENDENCIES = freezeRecord(
  PUBLIC_PACKAGE_TOPOLOGY.map((row) => [row.name, Object.freeze([...row.dependencies])]),
);

export const NODE_FREE_ROOT_ENTRY_PACKAGES = Object.freeze([
  "@facet/core",
  "@facet/react",
  "@facet/assets",
  "@facet/client",
  "@facet/runtime",
]);

export const PUBLIC_PACKAGE_COUNT = PUBLIC_PACKAGE_TOPOLOGY.length;
export const WORKSPACE_COUNT = Object.keys(EXPECTED_WORKSPACES).length;
