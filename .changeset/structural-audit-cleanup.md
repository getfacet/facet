---
"@facet/core": patch
"@facet/client": patch
"@facet/server": patch
"@facet/react": patch
"@facet/agent-tools": patch
"@facet/quickstart": patch
"@facet/ag-ui": patch
"@facet/bridge": patch
---

Consolidate shared event, action, component, and browser-view validation paths,
align authoring guidance with Facet's component-first hierarchy, and clean up
package and test boundaries without changing protocol behavior. Core now exports
canonical event normalizers, and client exports a shared `withView` helper.
