import { describe, expect, it } from "vitest";
import { parseSessionNotification, parseCommandNotification } from "../../index.js";

describe("Session notification contract", () => {
  it("keeps general notifications independent from command-owned streams", () => {
    const general = { type: "notification", sessionId: "s", id: "n", message: "ready", status: "succeeded" };
    expect(parseSessionNotification(general)).toEqual(general);
    expect(() => parseCommandNotification(general)).toThrow("commandId");
    expect(() => parseSessionNotification({ ...general, turnId: "t" })).toThrow();
    expect(() => parseSessionNotification({ ...general, commandId: undefined })).toThrow();
  });

});
