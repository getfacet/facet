#!/usr/bin/env node
import { register } from "tsx/esm/api";

// Workspace installs expose the source bin before `dist/` exists. Register the
// same TypeScript resolver used by repo scripts, then hand off to the real CLI.
// Published packages override this bin to `dist/cli.js` and never ship this file.
const unregister = register();
try {
  await import("./cli.ts");
} finally {
  unregister();
}
