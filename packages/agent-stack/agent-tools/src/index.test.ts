import { describe, expect, it } from "vitest";
import { formatAgentToolObservation, parseAgentToolObservation } from "./index.js";

describe("agent-tools barrel exports", () => {
  it("exports the agent tool observation helpers", () => {
    const observation = formatAgentToolObservation({
      tool: "say",
      status: "ok",
      outcome: "no_stage_change",
      message: "Sent a chat message.",
    });

    expect(parseAgentToolObservation(observation.text)).toMatchObject({
      tool: "say",
      outcome: "no_stage_change",
      applied: false,
    });
  });
});
