/* global console, process */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracked = spawnSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z", "--", "*.ts", "*.tsx"],
  {
    cwd: repoRoot,
    encoding: "buffer",
  },
);

if (tracked.error !== undefined) throw tracked.error;
if (tracked.status !== 0) {
  process.stderr.write(tracked.stderr);
  process.exit(tracked.status ?? 1);
}

const paths = tracked.stdout
  .toString("utf8")
  .split("\0")
  .filter((path) => path.length > 0 && existsSync(resolve(repoRoot, path)));
const contaminated = paths.filter((path) => readFileSync(resolve(repoRoot, path)).includes(0));

if (contaminated.length > 0) {
  console.error(`Source files contain NUL bytes:\n${contaminated.join("\n")}`);
  process.exit(1);
}

console.log(`[source-nuls] PASS (${String(paths.length)} TypeScript files)`);
