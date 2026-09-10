import { describe, expect, it } from "vitest";

import { parseCommand } from "../command.js";

describe("parseCommand", () => {
  it("leaves ordinary text on the turn path", () => {
    expect(parseCommand("read this file")).toBeNull();
  });

  it("splits a slash command name and arguments", () => {
    expect(parseCommand("  /hello   now  ")).toEqual({ name: "hello", args: "now" });
    expect(parseCommand("/hello")).toEqual({ name: "hello", args: "" });
  });

  it("returns a local failure for malformed slash commands", () => {
    expect(parseCommand("/")).toMatchObject({
      name: "command",
      failure: { code: "invalid-command" },
    });
    expect(parseCommand("/Hello")).toMatchObject({
      name: "Hello",
      failure: { code: "invalid-command" },
    });
  });
});
