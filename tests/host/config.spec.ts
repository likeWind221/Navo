import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveKernelHostConfig } from "../../src/host/config.js";

describe("Kernel Host storage config", () => {
  it("stores Navo state under the user home by default", () => {
    expect(resolveKernelHostConfig({}).storage).toEqual({ path: join(homedir(), ".navo", "navo.db") });
  });

  it("accepts a trimmed NAVO_HOME override and rejects a blank one", () => {
    expect(resolveKernelHostConfig({ NAVO_HOME: "  relative-home  " }).storage)
      .toEqual({ path: join(resolve("relative-home"), "navo.db") });
    expect(() => resolveKernelHostConfig({ NAVO_HOME: "  " }))
      .toThrow("NAVO_HOME must be a non-empty path when provided.");
  });
});
