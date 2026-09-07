import { describe, expect, it } from "vitest";
import { COMMAND_ARGS_MAX_CHARS, createCommandOutputValidator, parseSessionCommandInput,
  parseSessionNotification, parseCommandNotification } from "../index.js";

const input = { sessionId: "s", commandId: "c", name: "model", args: "" };
const notice = { type: "notification", sessionId: "s", commandId: "c", id: "n", message: "working", status: "running" };
const failure = { code: "unknown-command", message: "Unknown command" };

describe("F3 command contract", () => {
  it("accepts a standalone command without Turn and updates the same notification", () => {
    expect(parseSessionCommandInput(input)).toEqual(input);
    const v = createCommandOutputValidator(input);
    expect(v.parse(notice)).toEqual(notice);
    v.parse({ ...notice, status: "succeeded", message: "changed" });
    expect(() => v.end()).not.toThrow();
    expect(() => v.parse(notice)).toThrow();
  });

  it.each(["failed", "cancelled"])("allows %s before admission and after running", status => {
    for (const running of [false, true]) {
      const v = createCommandOutputValidator(input);
      if (running) v.parse(notice);
      v.parse({ ...notice, status, failure });
      expect(() => v.end()).not.toThrow();
    }
  });

  it.each(["sessionId", "commandId", "id"])("rejects changed %s", key => {
    const v = createCommandOutputValidator(input);
    v.parse(notice);
    expect(() => v.parse({ ...notice, status: "succeeded", [key]: "other" })).toThrow();
    expect(() => v.end()).toThrow();
  });

  it("rejects wrong first identity, premature success, repeated running and EOF", () => {
    expect(() => createCommandOutputValidator(input).parse({ ...notice, commandId: "other" })).toThrow();
    expect(() => createCommandOutputValidator(input).parse({ ...notice, status: "succeeded" })).toThrow();
    const v = createCommandOutputValidator(input);
    v.parse(notice);
    expect(() => v.parse(notice)).toThrow();
    const incomplete = createCommandOutputValidator(input);
    incomplete.parse(notice);
    expect(() => incomplete.end()).toThrow();
    expect(() => incomplete.parse({ ...notice, status: "succeeded" })).toThrow();
  });

  it("enforces safe failures, exact fields and command size and name grammar", () => {
    for (const candidate of [
      { ...input, name: "/model" }, { ...input, name: "MODEL" }, { ...input, name: "model x" },
      { ...input, args: "x".repeat(COMMAND_ARGS_MAX_CHARS + 1) }, { ...input, args: [] },
      { ...input, requestId: "r" }, { ...input, commandId: "" },
    ]) expect(() => parseSessionCommandInput(candidate)).toThrow();
    expect(parseSessionCommandInput({ ...input, args: "x".repeat(COMMAND_ARGS_MAX_CHARS) }).args.length).toBe(COMMAND_ARGS_MAX_CHARS);
    expect(() => parseSessionNotification({ ...notice, status: "failed" })).toThrow();
    expect(() => parseSessionNotification({ ...notice, status: "failed", failure: { ...failure, stack: "private" } })).toThrow();
    expect(() => parseSessionNotification({ ...notice, message: "x".repeat(4097) })).toThrow();
  });
});
