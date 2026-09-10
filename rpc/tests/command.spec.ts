import { describe, expect, it } from "vitest";
import {
  COMMAND_ARGS_MAX_CHARS,
  createCommandOutputValidator,
  parseCommandEvent,
  parseSessionCommandInput,
} from "../index.js";

const input = { sessionId: "s", commandId: "c", name: "model", args: "" };
const anchor = { kind: "turn" as const, turnId: "t" };
const started = { type: "command-started" as const, sessionId: "s", commandId: "c", name: "model", anchor };
const completed = { ...started, type: "command-completed" as const, summary: "ok" };
const failure = { code: "unknown-command", message: "Unknown command" };

describe("F3 command contract", () => {
  it("accepts a command event sequence with a stable anchor", () => {
    expect(parseSessionCommandInput(input)).toEqual(input);
    expect(parseCommandEvent(started)).toEqual(started);
    const validator = createCommandOutputValidator(input);
    expect(validator.parse(started)).toEqual(started);
    expect(validator.parse(completed)).toEqual(completed);
    expect(() => validator.end()).not.toThrow();
    expect(() => validator.parse(started)).toThrow();
  });

  it("allows failure and cancellation before start or after start", () => {
    for (const type of ["command-failed", "command-cancelled"] as const) {
      for (const running of [false, true]) {
        const validator = createCommandOutputValidator(input);
        if (running) validator.parse(started);
        validator.parse(type === "command-failed"
          ? { ...started, type, failure }
          : { ...started, type });
        expect(() => validator.end()).not.toThrow();
      }
    }
  });

  it("rejects changed identity, premature success, repeated start and EOF", () => {
    for (const key of ["sessionId", "commandId", "name"] as const) {
      const validator = createCommandOutputValidator(input);
      validator.parse(started);
      expect(() => validator.parse({ ...completed, [key]: "other" })).toThrow();
    }
    const changedAnchor = createCommandOutputValidator(input);
    changedAnchor.parse(started);
    expect(() => changedAnchor.parse({ ...completed, anchor: { kind: "session" as const } })).toThrow();
    expect(() => createCommandOutputValidator(input).parse(completed)).toThrow();
    const repeated = createCommandOutputValidator(input);
    repeated.parse(started);
    expect(() => repeated.parse(started)).toThrow();
    const incomplete = createCommandOutputValidator(input);
    incomplete.parse(started);
    expect(() => incomplete.end()).toThrow();
  });

  it("enforces safe input and command event fields", () => {
    for (const candidate of [
      { ...input, name: "/model" }, { ...input, name: "MODEL" }, { ...input, name: "model x" },
      { ...input, args: "x".repeat(COMMAND_ARGS_MAX_CHARS + 1) }, { ...input, args: [] },
      { ...input, commandId: "" },
    ]) expect(() => parseSessionCommandInput(candidate)).toThrow();
    expect(parseSessionCommandInput({ ...input, args: "x".repeat(COMMAND_ARGS_MAX_CHARS) }).args.length)
      .toBe(COMMAND_ARGS_MAX_CHARS);
    expect(() => parseCommandEvent({ ...started, args: "unexpected" })).toThrow();
    expect(() => parseCommandEvent({ ...started, anchor: { kind: "session", turnId: "unexpected" } })).toThrow();
  });
});
