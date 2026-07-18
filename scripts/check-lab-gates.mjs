#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LAB_GATE_MODES = Object.freeze([
  "deterministic",
  "required-provider",
  "optional-visual",
]);

const COMMANDS = Object.freeze({
  deterministic: Object.freeze(["pnpm", "--filter", "@facet/lab", "test:e2e:deterministic"]),
  "required-provider": Object.freeze(["pnpm", "--filter", "@facet/lab", "test:e2e:live"]),
  "optional-visual": Object.freeze(["pnpm", "--filter", "@facet/lab", "test:e2e:live"]),
});

function hasProviderKey(environment) {
  return Boolean(environment.OPENAI_API_KEY?.trim() || environment.ANTHROPIC_API_KEY?.trim());
}

function gateRoot(environment) {
  const configured = environment.FACET_LAB_GATE_ROOT?.trim();
  const candidate = configured || join(tmpdir(), `facet-lab-gates-${String(process.pid)}`);
  return resolve(candidate);
}

export function planLabGate(mode, environment = process.env) {
  if (!LAB_GATE_MODES.includes(mode)) {
    throw new Error(`unknown Lab gate mode: ${String(mode)}`);
  }
  const root = gateRoot(environment);
  if (!isAbsolute(root)) throw new Error("Lab gate root must resolve to an absolute path");
  const paths = Object.freeze({
    root,
    data: join(root, mode, "data"),
    artifacts: join(root, mode, "artifacts"),
  });
  const providerKeyPresent = hasProviderKey(environment);
  if (mode === "required-provider" && !providerKeyPresent) {
    return Object.freeze({
      mode,
      disposition: "fail",
      reason: "required-provider-key-missing",
      paths,
    });
  }
  if (mode === "optional-visual" && !providerKeyPresent) {
    return Object.freeze({
      mode,
      disposition: "skip",
      reason: "optional-visual-key-missing",
      paths,
    });
  }
  return Object.freeze({
    mode,
    disposition: "run",
    reason: null,
    command: COMMANDS[mode],
    paths,
  });
}

function childEnvironment(mode, paths, environment) {
  const { OPENAI_API_KEY, ANTHROPIC_API_KEY, ...withoutProviderKeys } = environment;
  const providerEnvironment =
    mode === "deterministic"
      ? withoutProviderKeys
      : {
          ...withoutProviderKeys,
          ...(OPENAI_API_KEY === undefined ? {} : { OPENAI_API_KEY }),
          ...(ANTHROPIC_API_KEY === undefined ? {} : { ANTHROPIC_API_KEY }),
        };
  return {
    ...providerEnvironment,
    FACET_LAB_DATA_DIR: paths.data,
    FACET_LAB_ARTIFACTS_DIR: paths.artifacts,
    ...(mode === "required-provider" ? { FACET_LAB_LIVE_REQUIRED: "1" } : {}),
    ...(mode === "optional-visual" ? { FACET_LAB_OPTIONAL_VISUAL: "1" } : {}),
  };
}

function defaultExecute(command, options) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export function runLabGate({
  mode,
  environment = process.env,
  cwd = process.cwd(),
  execute = defaultExecute,
}) {
  const plan = planLabGate(mode, environment);
  if (plan.disposition !== "run") {
    return Object.freeze({
      mode,
      verdict: plan.disposition === "skip" ? "SKIP" : "FAIL",
      reason: plan.reason,
      paths: plan.paths,
    });
  }
  mkdirSync(plan.paths.data, { recursive: true, mode: 0o700 });
  mkdirSync(plan.paths.artifacts, { recursive: true, mode: 0o700 });
  const status = execute(plan.command, {
    cwd,
    env: childEnvironment(mode, plan.paths, environment),
  });
  if (mode === "optional-visual" && status === 0) {
    return Object.freeze({
      mode,
      verdict: "SKIP",
      reason: "visual-judge-unavailable",
      paths: plan.paths,
    });
  }
  return Object.freeze({
    mode,
    verdict: status === 0 ? "PASS" : "FAIL",
    reason: status === 0 ? null : "command-failed",
    paths: plan.paths,
  });
}

function readMode(argv) {
  const index = argv.indexOf("--mode");
  const mode = index < 0 ? undefined : argv[index + 1];
  if (mode === undefined || !LAB_GATE_MODES.includes(mode)) {
    throw new Error(`--mode must be one of: ${LAB_GATE_MODES.join(", ")}`);
  }
  return mode;
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMain()) {
  try {
    const result = runLabGate({ mode: readMode(process.argv.slice(2)) });
    process.stdout.write(
      `[facet-lab-gate] ${result.mode}: ${result.verdict}${result.reason === null ? "" : ` (${result.reason})`}\n`,
    );
    process.stdout.write(`[facet-lab-gate] artifacts: ${result.paths.artifacts}\n`);
    process.exitCode = result.verdict === "FAIL" ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `[facet-lab-gate] FAIL: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
