import { describe, expect, it } from "vitest";

import { resolveKernelHostConfig } from "../../src/host/config.js";

describe("Kernel Host file environment config", () => {
  it("enables file tools in the host working directory by default", () => {
    expect(resolveKernelHostConfig({}).file).toEqual({ cwd: process.cwd() });
  });

  it("accepts and trims an explicit file cwd", () => {
    expect(resolveKernelHostConfig({ NAVO_FILE_CWD: "  /workspace/project  " }).file)
      .toEqual({ cwd: "/workspace/project" });
  });

  it("rejects a blank explicit file cwd", () => {
    expect(() => resolveKernelHostConfig({ NAVO_FILE_CWD: "   " }))
      .toThrow("NAVO_FILE_CWD must be a non-empty path when provided.");
  });
});
