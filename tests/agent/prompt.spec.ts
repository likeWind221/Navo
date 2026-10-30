import { describe, expect, it } from "vitest";

import { CORE_AGENT_PROMPT, composeSystemPrompt } from "../../src/agent/prompt.js";

describe("composeSystemPrompt", () => {
  it("keeps the caller prompt first and appends the core rules", () => {
    const composed = composeSystemPrompt("You are Navo's Node Agent.");
    expect(composed.startsWith("You are Navo's Node Agent.\n")).toBe(true);
    expect(composed.endsWith(CORE_AGENT_PROMPT)).toBe(true);
  });

  it("returns the core rules when the caller supplies nothing", () => {
    expect(composeSystemPrompt(undefined)).toBe(CORE_AGENT_PROMPT);
    expect(composeSystemPrompt("   ")).toBe(CORE_AGENT_PROMPT);
  });

  it("does not duplicate the core rules when the caller already carries them", () => {
    const composed = composeSystemPrompt(`caller\n${CORE_AGENT_PROMPT}`);
    expect(composed).toBe(`caller\n${CORE_AGENT_PROMPT}`);
    expect(composed.split("Never claim an operation succeeded").length).toBe(2);
  });

  it("states verification, delivery and honesty obligations without surface-specific wording", () => {
    expect(CORE_AGENT_PROMPT).toContain("invalid and boundary inputs");
    expect(CORE_AGENT_PROMPT).toContain("omits a required section");
    expect(CORE_AGENT_PROMPT).toContain("exit code");
    expect(CORE_AGENT_PROMPT).not.toMatch(/resource|roadmap|node|project/i);
  });
});
