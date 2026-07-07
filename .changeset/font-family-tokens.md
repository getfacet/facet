---
"@facet/core": minor
"@facet/assets": minor
"@facet/react": minor
---

Add font family tokens to the Facet style system. Agents can now set
`TextStyle.family` to `sans`, `serif`, or `mono`; theme documents may provide a
validated `fontFamily` token map; the default assets include the built-in font
stacks; and the React renderer resolves the token to CSS with `sans` as the
default fallback.
