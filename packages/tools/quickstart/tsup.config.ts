import { defineConfig } from "tsup";

export default defineConfig([
  // Node entries: the public barrel + the `facet-quickstart` bin.
  {
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
  },
  // Browser page bundle: self-contained IIFE served as /app.js by the
  // quickstart server. Everything (react, react-dom, @facet/*, including the
  // @facet/assets/react default registry subpath) is inlined — visitors get
  // one static file, no CDN, no install-time react dependency.
  {
    entry: { "page/app": "src/page/main.tsx" },
    outDir: "dist",
    format: ["iife"],
    platform: "browser",
    noExternal: ["@facet/assets/react", /.*/],
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    // Emit dist/page/app.js (tsup's iife default would be app.global.js).
    outExtension: () => ({ js: ".js" }),
    clean: false,
  },
  // Browser page mount module: overlay-specific bundles import this from the
  // published package so custom registries and the page renderer share React.
  {
    entry: { "page/main": "src/page/main.tsx" },
    outDir: "dist",
    format: ["esm"],
    platform: "browser",
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    noExternal: [
      "@facet/assets",
      "@facet/assets/react",
      "@facet/client",
      "@facet/core",
      "@facet/react",
    ],
    define: { "process.env.NODE_ENV": '"production"' },
    minify: false,
    splitting: false,
    clean: false,
  },
]);
