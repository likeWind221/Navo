import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveKernelHostConfig } from "../../src/host/config.js";

describe("Kernel Host file environment config", () => {
  it("enables file tools in the host working directory by default", () => {
    expect(resolveKernelHostConfig({}).file).toEqual({
      cwd: process.cwd(),
      shellJobDir: join(homedir(), ".navo", "cache", "shell"),
    });
  });

  it("accepts and trims an explicit file cwd", () => {
    expect(resolveKernelHostConfig({ NAVO_FILE_CWD: "  /workspace/project  " }).file?.cwd)
      .toBe("/workspace/project");
  });

  it("keeps the shell job helper cache under NAVO_HOME", () => {
    expect(resolveKernelHostConfig({ NAVO_HOME: "  /data/navo  " }).file?.shellJobDir)
      .toBe(join(resolve("/data/navo"), "cache", "shell"));
  });

  it("rejects a blank explicit file cwd", () => {
    expect(() => resolveKernelHostConfig({ NAVO_FILE_CWD: "   " }))
      .toThrow("NAVO_FILE_CWD must be a non-empty path when provided.");
  });
});
