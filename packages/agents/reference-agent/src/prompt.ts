/**
 * Compatibility barrel for the reference agent's prompt modules.
 *
 * Existing consumers can keep importing from `./prompt.js` or the package root;
 * the implementation now lives in named modules under `prompt/`.
 */
export * from "./prompt/system.js";
export * from "./prompt/messages.js";
export * from "./prompt/stage-summary.js";
